import { test } from "node:test";
import assert from "node:assert/strict";
import { createCloud, AuthError, NetworkError, AUTH_KEY } from "../cloud.js";

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tokenBody = (n) => ({ access_token: `at${n}`, refresh_token: `rt${n}`, expires_in: 3600, user: { id: "u1", email: "a@b.de" } });

function setup(handler, { session, now = 1_000_000 } = {}) {
  const calls = [];
  const storage = memoryStorage(session ? { [AUTH_KEY]: JSON.stringify(session) } : {});
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  const cloud = createCloud({ url: "https://x.supabase.co/", key: "pk", storage, fetchFn, now: () => now });
  return { cloud, calls, storage };
}

const validSession = { access_token: "at0", refresh_token: "rt0", expires_at: 9_000_000, user: { id: "u1", email: "a@b.de" } };

test("signIn speichert die Sitzung", async () => {
  const { cloud, calls, storage } = setup(() => json(200, tokenBody(1)));
  const user = await cloud.signIn("a@b.de", "pw");
  assert.deepEqual(user, { id: "u1", email: "a@b.de" });
  assert.equal(calls[0].url, "https://x.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(calls[0].init.headers.apikey, "pk");
  assert.equal(JSON.parse(storage.getItem(AUTH_KEY)).refresh_token, "rt1");
});

test("signIn mit falschem Passwort gibt verständliche Meldung", async () => {
  const { cloud } = setup(() => json(400, { error_code: "invalid_credentials" }));
  await assert.rejects(cloud.signIn("a@b.de", "x"), (e) => e instanceof AuthError && e.message === "E-Mail oder Passwort ist falsch.");
  assert.equal(cloud.user, null);
});

test("offline → NetworkError", async () => {
  const { cloud } = setup(() => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(cloud.signIn("a", "b"), NetworkError);
});

test("abgelaufenes Token wird vor der Anfrage erneuert", async () => {
  const { cloud, calls } = setup((url) => (url.includes("refresh_token") ? json(200, tokenBody(2)) : json(200, [])), {
    session: { ...validSession, expires_at: 1_000_000 },
  });
  await cloud.pull(null);
  assert.match(calls[0].url, /grant_type=refresh_token/);
  assert.equal(JSON.parse(calls[0].init.body).refresh_token, "rt0");
  assert.equal(calls[1].init.headers.Authorization, "Bearer at2");
});

test("401 → einmal erneuern und wiederholen", async () => {
  const { cloud, calls } = setup((url, init, n) => {
    if (url.includes("refresh_token")) return json(200, tokenBody(3));
    return n === 1 ? json(401, {}) : json(200, []);
  }, { session: validSession });
  assert.deepEqual(await cloud.pull(null), []);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.headers.Authorization, "Bearer at3");
});

test("ungültiges Refresh-Token meldet ab", async () => {
  const { cloud, storage } = setup(() => json(400, { error_code: "refresh_token_not_found" }), {
    session: { ...validSession, expires_at: 0 },
  });
  await assert.rejects(cloud.pull(null), AuthError);
  assert.equal(cloud.user, null);
  assert.equal(storage.getItem(AUTH_KEY), null);
});

test("Serverfehler beim Erneuern meldet nicht ab", async () => {
  const { cloud } = setup(() => json(503, {}), { session: { ...validSession, expires_at: 0 } });
  await assert.rejects(cloud.pull(null), (e) => !(e instanceof AuthError));
  assert.ok(cloud.user);
});

test("gleichzeitige Anfragen erneuern das Token nur einmal", async () => {
  let refreshes = 0;
  const { cloud } = setup((url) => {
    if (url.includes("refresh_token")) { refreshes++; return json(200, tokenBody(4)); }
    return json(200, []);
  }, { session: { ...validSession, expires_at: 0 } });
  await Promise.all([cloud.pull(null), cloud.pull(null)]);
  assert.equal(refreshes, 1);
});

test("pull blättert durch Seiten und filtert nach Zeitpunkt", async () => {
  const { cloud, calls } = setup((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    return json(200, offset === 0 ? [{ id: "1" }, { id: "2" }] : [{ id: "3" }]);
  }, { session: validSession });
  const rows = await cloud.pull("2026-11-22T10:00:00.000Z", 2);
  assert.deepEqual(rows.map((r) => r.id), ["1", "2", "3"]);
  assert.equal(new URL(calls[0].url).searchParams.get("synced_at"), "gt.2026-11-22T10:00:00.000Z");
});

test("push sendet Upsert in Blöcken", async () => {
  const { cloud, calls } = setup(() => json(201, null), { session: validSession });
  await cloud.push([{ id: "1" }, { id: "2" }, { id: "3" }], 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/items?on_conflict=user_id,id");
  assert.match(calls[0].init.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(JSON.parse(calls[1].init.body).length, 1);
});

test("signOut löscht die Sitzung auch offline", async () => {
  const { cloud, storage } = setup(() => { throw new TypeError("offline"); }, { session: validSession });
  await cloud.signOut();
  assert.equal(cloud.user, null);
  assert.equal(storage.getItem(AUTH_KEY), null);
});
