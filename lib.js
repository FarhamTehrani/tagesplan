// Reine Logik ohne DOM – wird von app.js und den Tests genutzt.

export const STORAGE_KEY = "tagesplan.v1";

const pad = (n) => String(n).padStart(2, "0");
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Datum → "YYYY-MM-DD" in lokaler Zeit. */
export function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isValidKey(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) return false;
  return toKey(fromKey(key)) === key;
}

export function isValidTime(t) {
  return typeof t === "string" && TIME_RE.test(t);
}

export function todayKey(now = new Date()) {
  return toKey(now);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Montag der Woche, in der `key` liegt. */
export function weekStart(key) {
  const day = fromKey(key).getDay(); // 0 = Sonntag
  return addDays(key, -((day + 6) % 7));
}

export function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const fmtLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

export const formatLong = (key) => fmtLong.format(fromKey(key));
export const formatShort = (key) => fmtShort.format(fromKey(key));
export const formatWeekday = (key) => fmtWeekday.format(fromKey(key)).replace(".", "");

/** Relative Bezeichnung für einen Tag, z. B. "Heute", "Morgen". */
export function relativeLabel(key, today) {
  const diff = Math.round((fromKey(key) - fromKey(today)) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  return null;
}

/** Prüft und bereinigt einen gespeicherten/importierten Eintrag. Gibt null zurück, wenn ungültig. */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type === "termin" || raw.type === "aufgabe" ? raw.type : null;
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
  if (!type || !title || typeof raw.id !== "string" || !raw.id) return null;

  const date = isValidKey(raw.date) ? raw.date : null;
  if (type === "termin" && !date) return null;

  const start = isValidTime(raw.start) ? raw.start : null;
  let end = start && isValidTime(raw.end) ? raw.end : null;
  if (end && toMinutes(end) <= toMinutes(start)) end = null;

  const item = {
    id: raw.id,
    type,
    title,
    date,
    start: type === "termin" ? start : null,
    end: type === "termin" ? end : null,
    note: typeof raw.note === "string" ? raw.note.slice(0, 2000) : "",
  };
  if (type === "aufgabe") {
    item.done = raw.done === true;
    item.doneOn = item.done && isValidKey(raw.doneOn) ? raw.doneOn : null;
  }
  return item;
}

export function normalizeItems(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const item = normalizeItem(raw);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function compareTermine(a, b) {
  // Ganztägige zuerst, dann nach Startzeit, dann Titel.
  if (!a.start !== !b.start) return a.start ? 1 : -1;
  if (a.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.title.localeCompare(b.title, "de");
}

const byDateThenTitle = (a, b) =>
  (a.date || "").localeCompare(b.date || "") || a.title.localeCompare(b.title, "de");

/**
 * Alles, was an einem Tag angezeigt wird.
 * Offene Aufgaben aus der Vergangenheit und Aufgaben ohne Datum erscheinen nur am heutigen Tag.
 */
export function dayView(items, day, today) {
  const isToday = day === today;
  const termine = items.filter((i) => i.type === "termin" && i.date === day).sort(compareTermine);

  const tasks = items.filter((i) => i.type === "aufgabe");
  const overdue = isToday ? tasks.filter((t) => !t.done && t.date && t.date < today).sort(byDateThenTitle) : [];
  const due = tasks.filter((t) => !t.done && t.date === day).sort(byDateThenTitle);
  const undated = isToday ? tasks.filter((t) => !t.done && !t.date).sort(byDateThenTitle) : [];
  // Erledigt an diesem Tag: geplant für den Tag, oder an diesem Tag abgehakt.
  const done = tasks
    .filter((t) => t.done && (t.date === day || (t.doneOn === day && t.date !== day && isToday)))
    .sort(byDateThenTitle);

  return { termine, overdue, due, undated, done };
}

/** Laufender und nächster Termin (nur sinnvoll für heute). */
export function nowAndNext(termine, nowMinutes) {
  let current = null;
  let next = null;
  for (const t of termine) {
    if (!t.start) continue;
    const s = toMinutes(t.start);
    const e = t.end ? toMinutes(t.end) : s + 60;
    if (s <= nowMinutes && nowMinutes < e && !current) current = t.id;
    if (s > nowMinutes && !next) next = t.id;
  }
  return { current, next };
}

/** Anzahl Termine und offene Aufgaben pro Tag – für die Punkte in der Wochenleiste. */
export function dayMarkers(items, day) {
  let termine = 0;
  let aufgaben = 0;
  for (const i of items) {
    if (i.date !== day) continue;
    if (i.type === "termin") termine++;
    else if (!i.done) aufgaben++;
  }
  return { termine, aufgaben };
}

export function toggleDone(item, today) {
  const done = !item.done;
  return { ...item, done, doneOn: done ? today : null };
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
