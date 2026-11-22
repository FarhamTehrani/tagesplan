// Schlanker Client für Supabase (Auth + Tabelle `items`) über fetch – ohne zusätzliche Bibliothek.

export const AUTH_KEY = "tagesplan.auth";

/** Anmeldung fehlt oder ist abgelaufen. */
export class AuthError extends Error {}
/** Server nicht erreichbar (offline). */
export class NetworkError extends Error {}

function authMessage(status, body) {
  const code = body?.error_code || body?.error;
  if (code === "invalid_credentials" || code === "invalid_grant") return "E-Mail oder Passwort ist falsch.";
  if (code === "email_not_confirmed") return "Die E-Mail-Adresse ist noch nicht bestätigt.";
  if (status === 429) return "Zu viele Versuche. Bitte warte einen Moment.";
  return `Anmeldung fehlgeschlagen (${status}).`;
}

export function createCloud({
  url,
  key,
  storage = globalThis.localStorage,
  fetchFn = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
}) {
  const base = url.replace(/\/+$/, "");
  let session = readSession();
  let refreshing = null;

  function readSession() {
    try {
      const s = JSON.parse(storage.getItem(AUTH_KEY));
      return s?.access_token && s?.refresh_token && s?.user?.id ? s : null;
    } catch {
      return null;
    }
  }

  function writeSession(s) {
    session = s;
    try {
      if (s) storage.setItem(AUTH_KEY, JSON.stringify(s));
      else storage.removeItem(AUTH_KEY);
    } catch {
      // Ohne Speicher bleibt die Anmeldung nur bis zum Schließen der App.
    }
  }

  async function call(path, init) {
    try {
      return await fetchFn(base + path, init);
    } catch {
      throw new NetworkError("Keine Verbindung zum Server.");
    }
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  function toSession(body) {
    if (!body?.access_token || !body?.refresh_token || !body?.user?.id) throw new Error("Unerwartete Antwort vom Server.");
    const expiresAt = Number.isFinite(body.expires_at) ? body.expires_at * 1000 : now() + (body.expires_in ?? 3600) * 1000;
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: expiresAt,
      user: { id: body.user.id, email: body.user.email ?? "" },
    };
  }

  async function authRequest(grant, payload) {
    const res = await call(`/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, body: await readJson(res) };
  }

  async function signIn(email, password) {
    const { res, body } = await authRequest("password", { email, password });
    if (!res.ok) throw new AuthError(authMessage(res.status, body));
    writeSession(toSession(body));
    return session.user;
  }

  function refresh() {
    if (!refreshing) {
      const token = session?.refresh_token;
      refreshing = (async () => {
        if (!token) throw new AuthError("Nicht angemeldet.");
        const { res, body } = await authRequest("refresh_token", { refresh_token: token });
        if (res.ok) {
          writeSession(toSession(body));
          return;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          writeSession(null);
          throw new AuthError("Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.");
        }
        throw new Error(`Serverfehler (${res.status}).`);
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function accessToken(force) {
    if (!session) throw new AuthError("Nicht angemeldet.");
    if (force || session.expires_at - 60_000 <= now()) await refresh();
    return session.access_token;
  }

  async function rest(path, init = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken(attempt > 0);
      const res = await call(`/rest/v1${path}`, {
        ...init,
        headers: { ...init.headers, apikey: key, Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && attempt === 0) continue; // Token abgelaufen → einmal erneuern
      if (res.status === 401) {
        writeSession(null);
        throw new AuthError("Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.");
      }
      if (!res.ok) {
        const body = await readJson(res);
        throw new Error(body?.message ? `${body.message} (${res.status})` : `Serverfehler (${res.status}).`);
      }
      return res;
    }
  }

  /** Alle Zeilen, die seit `since` (ISO-Zeitpunkt) auf dem Server geändert wurden. */
  async function pull(since, pageSize = 1000) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      let q = `/items?select=id,data,updated_at,deleted,synced_at&order=synced_at.asc,id.asc&limit=${pageSize}&offset=${offset}`;
      if (since) q += `&synced_at=gt.${encodeURIComponent(since)}`;
      const batch = await (await rest(q)).json();
      if (!Array.isArray(batch)) throw new Error("Unerwartete Antwort vom Server.");
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }

  /** Legt Zeilen an oder aktualisiert sie. Ältere Stände ignoriert der Server (siehe schema.sql). */
  async function push(rows, chunkSize = 500) {
    for (let i = 0; i < rows.length; i += chunkSize) {
      await rest("/items?on_conflict=user_id,id", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows.slice(i, i + chunkSize)),
      });
    }
  }

  async function signOut() {
    const s = session;
    writeSession(null);
    if (!s) return;
    try {
      await fetchFn(`${base}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${s.access_token}` },
      });
    } catch {
      // Offline abmelden ist in Ordnung; das Token läuft von selbst ab.
    }
  }

  return {
    get user() {
      return session?.user ?? null;
    },
    signIn,
    signOut,
    pull,
    push,
  };
}
