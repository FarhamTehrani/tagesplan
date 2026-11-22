import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChanges, rowsToPush, mergeRemote, normalizeItem, normalizeTombstones } from "../lib.js";

const A = (o) => normalizeItem({ type: "aufgabe", ...o });
const iso = (ms) => new Date(ms).toISOString();

test("normalizeItem behält updatedAt, sonst 0", () => {
  assert.equal(A({ id: "a", title: "x", updatedAt: 5 }).updatedAt, 5);
  assert.equal(A({ id: "a", title: "x", updatedAt: "5" }).updatedAt, 0);
  assert.deepEqual(normalizeTombstones({ a: 1, b: "x", c: -1 }), { a: 1 });
  assert.deepEqual(normalizeTombstones([1]), {});
});

test("applyChanges stempelt nur geänderte Einträge und legt Löschmarken an", () => {
  const a = A({ id: "a", title: "A", updatedAt: 100 });
  const b = A({ id: "b", title: "B", updatedAt: 100 });
  const c = A({ id: "c", title: "C", updatedAt: 100 });
  const bNeu = { ...b, title: "B2" };
  const res = applyChanges([a, b, c], [a, bNeu, A({ id: "d", title: "D" })], {}, 1000);
  assert.equal(res.items[0], a); // unverändert, gleiches Objekt
  assert.equal(res.items[1].updatedAt, 1000);
  assert.equal(res.items[2].updatedAt, 1000);
  assert.deepEqual(res.tombstones, { c: 1000 });
  assert.deepEqual(res.changed.sort(), ["b", "c", "d"]);
});

test("applyChanges: Zeitstempel steigt auch bei nachgehender Uhr", () => {
  const a = A({ id: "a", title: "A", updatedAt: 5000 });
  const res = applyChanges([a], [{ ...a, title: "neu" }], {}, 1000);
  assert.equal(res.items[0].updatedAt, 5001);
  const del = applyChanges([a], [], {}, 1000);
  assert.equal(del.tombstones.a, 5001);
});

test("applyChanges: Wiederherstellen entfernt die Löschmarke", () => {
  const a = A({ id: "a", title: "A", updatedAt: 100 });
  const del = applyChanges([a], [], {}, 200);
  const undo = applyChanges(del.items, [a], del.tombstones, 300);
  assert.deepEqual(undo.tombstones, {});
  assert.ok(undo.items[0].updatedAt > 200);
});

test("rowsToPush baut Zeilen für Einträge und Löschungen", () => {
  const a = A({ id: "a", title: "A", updatedAt: 1000 });
  const rows = rowsToPush([a], { b: 2000 }, ["a", "b", "x"], "u1");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    user_id: "u1", id: "a", updated_at: iso(1000), deleted: false,
    data: { type: "aufgabe", title: "A", date: null, start: null, end: null, note: "", done: false, doneOn: null },
  });
  assert.deepEqual(rows[1], { user_id: "u1", id: "b", data: {}, updated_at: iso(2000), deleted: true });
});

test("mergeRemote: neuere Server-Version gewinnt, ältere wird ignoriert", () => {
  const local = {
    items: [A({ id: "a", title: "lokal", updatedAt: 1000 }), A({ id: "b", title: "lokal", updatedAt: 3000 })],
    tombstones: {}, pending: new Set(["b"]), cursor: null,
  };
  const rows = [
    { id: "a", data: { type: "aufgabe", title: "remote" }, updated_at: iso(2000), deleted: false, synced_at: "2026-11-22T10:00:00.000001+00:00" },
    { id: "b", data: { type: "aufgabe", title: "remote" }, updated_at: iso(2500), deleted: false, synced_at: "2026-11-22T10:00:01+00:00" },
    { id: "c", data: { type: "aufgabe", title: "neu" }, updated_at: iso(1000), deleted: false, synced_at: "2026-11-22T09:00:00+00:00" },
  ];
  const m = mergeRemote(local, rows);
  const byId = Object.fromEntries(m.items.map((i) => [i.id, i]));
  assert.equal(byId.a.title, "remote");
  assert.equal(byId.a.updatedAt, 2000);
  assert.equal(byId.b.title, "lokal");
  assert.equal(byId.c.title, "neu");
  assert.ok(m.pending.has("b"));
  assert.equal(m.cursor, "2026-11-22T10:00:01+00:00");
  assert.equal(m.changed, true);
});

test("mergeRemote: Löschungen kommen an und werden nicht wiederbelebt", () => {
  const local = { items: [A({ id: "a", title: "A", updatedAt: 1000 })], tombstones: { b: 5000 }, pending: new Set(["a"]), cursor: null };
  const m = mergeRemote(local, [
    { id: "a", data: {}, updated_at: iso(2000), deleted: true, synced_at: iso(1) },
    { id: "b", data: { type: "aufgabe", title: "alt" }, updated_at: iso(4000), deleted: false, synced_at: iso(2) },
  ]);
  assert.deepEqual(m.items, []);
  assert.deepEqual(m.tombstones, { a: 2000, b: 5000 });
  assert.equal(m.pending.has("a"), false);
});

test("mergeRemote: gleicher Stand ändert nichts, ungültige Zeilen werden übersprungen", () => {
  const a = A({ id: "a", title: "A", updatedAt: 1000 });
  const m = mergeRemote({ items: [a], tombstones: {}, pending: new Set(), cursor: null }, [
    { id: "a", data: { type: "aufgabe", title: "A" }, updated_at: iso(1000), deleted: false },
    { id: "z", data: { type: "aufgabe" }, updated_at: iso(1000), deleted: false },
    { id: "y", data: {}, updated_at: "kaputt", deleted: false },
  ]);
  assert.equal(m.changed, false);
  assert.equal(m.items[0], a);
});
