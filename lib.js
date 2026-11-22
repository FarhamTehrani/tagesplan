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
    // Zeitpunkt der letzten Änderung (ms) – entscheidet beim Abgleich, welche Version gewinnt.
    updatedAt: Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0 ? raw.updatedAt : 0,
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
 * Alles, was an einem Tag angezeigt wird. `external` sind zusätzliche Termine (z. B. aus dem Apple-Kalender).
 * Offene Aufgaben aus der Vergangenheit und Aufgaben ohne Datum erscheinen nur am heutigen Tag.
 */
export function dayView(items, day, today, external = []) {
  const isToday = day === today;
  const termine = [...items.filter((i) => i.type === "termin" && i.date === day), ...external].sort(compareTermine);

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

/* ---------- Abgleich mit dem Konto ---------- */

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Löschmarken: { id: Zeitpunkt der Löschung in ms } */
export function normalizeTombstones(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, ts] of Object.entries(raw)) if (id && Number.isFinite(ts) && ts >= 0) out[id] = ts;
  return out;
}

/**
 * Vergleicht alte und neue Eintragsliste (nach Objekt-Identität), stempelt geänderte Einträge
 * mit einem Änderungszeitpunkt und legt Löschmarken für entfernte Einträge an.
 * Der Zeitpunkt liegt immer nach dem vorherigen, auch wenn die Geräteuhr nachgeht.
 */
export function applyChanges(prev, next, tombstones, now) {
  const prevById = new Map(prev.map((i) => [i.id, i]));
  const nextIds = new Set();
  const tomb = { ...tombstones };
  const changed = [];

  const items = next.map((item) => {
    nextIds.add(item.id);
    const old = prevById.get(item.id);
    if (old === item) return item;
    changed.push(item.id);
    delete tomb[item.id];
    const floor = Math.max(old?.updatedAt ?? 0, item.updatedAt ?? 0, tombstones[item.id] ?? 0);
    return { ...item, updatedAt: Math.max(now, floor + 1) };
  });

  for (const old of prev) {
    if (nextIds.has(old.id)) continue;
    tomb[old.id] = Math.max(now, (old.updatedAt ?? 0) + 1);
    changed.push(old.id);
  }
  return { items, tombstones: tomb, changed };
}

/** Zeilen für die Tabelle `items` aus den noch nicht gesicherten Einträgen. */
export function rowsToPush(items, tombstones, pendingIds, userId) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = [];
  for (const id of pendingIds) {
    const item = byId.get(id);
    if (item) {
      const { id: _id, updatedAt, ...data } = item;
      rows.push({ user_id: userId, id, data, updated_at: new Date(updatedAt).toISOString(), deleted: false });
    } else if (hasOwn(tombstones, id)) {
      rows.push({ user_id: userId, id, data: {}, updated_at: new Date(tombstones[id]).toISOString(), deleted: true });
    }
  }
  return rows;
}

/**
 * Übernimmt Zeilen vom Server. Pro Eintrag gewinnt die neuere Änderung;
 * gleich alte oder ältere Server-Versionen werden ignoriert.
 */
export function mergeRemote(local, rows) {
  const byId = new Map(local.items.map((i) => [i.id, i]));
  const tomb = { ...local.tombstones };
  const pending = new Set(local.pending);
  let cursor = local.cursor ?? null;
  let changed = false;

  for (const row of rows) {
    if (row.synced_at && (!cursor || Date.parse(row.synced_at) > Date.parse(cursor))) cursor = row.synced_at;
    if (typeof row.id !== "string" || !row.id) continue;
    const remoteTs = Date.parse(row.updated_at);
    if (!Number.isFinite(remoteTs)) continue;

    const mine = byId.get(row.id);
    const localTs = mine ? mine.updatedAt : hasOwn(tomb, row.id) ? tomb[row.id] : -Infinity;
    if (remoteTs <= localTs) continue;

    if (row.deleted) {
      if (mine) {
        byId.delete(row.id);
        changed = true;
      }
      tomb[row.id] = remoteTs;
    } else {
      const item = normalizeItem({ ...row.data, id: row.id, updatedAt: remoteTs });
      if (!item) continue;
      byId.set(row.id, item);
      delete tomb[row.id];
      changed = true;
    }
    pending.delete(row.id);
  }

  return { items: [...byId.values()], tombstones: tomb, pending, cursor, changed };
}

/* ---------- Apple-Kalender (über Kurzbefehl übertragen) ---------- */

/** Zeilen der Tabelle calendar_events prüfen → { id, title, start, end (ms), allDay, calendar, location } */
export function normalizeAppleEvents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const start = typeof r.start === "number" ? r.start : Date.parse(r.start_at);
    const end = typeof r.end === "number" ? r.end : Date.parse(r.end_at);
    if (typeof r.id !== "string" || !r.id || typeof r.title !== "string" || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({
      id: r.id,
      title: r.title.slice(0, 200),
      start,
      end: Math.max(start, end),
      allDay: r.allDay === true || r.all_day === true,
      calendar: typeof r.calendar === "string" ? r.calendar : "",
      location: typeof r.location === "string" ? r.location : "",
    });
  }
  return out;
}

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Apple-Termine, die einen Tag berühren, im Format der eigenen Termine (nur lesbar).
 * Mehrtägige Termine erscheinen an jedem Tag; an Folgetagen ohne Uhrzeit.
 */
export function appleForDay(events, day) {
  const dayStart = fromKey(day).getTime();
  const dayEnd = fromKey(addDays(day, 1)).getTime();
  const out = [];
  for (const ev of events) {
    const touches = ev.start < dayEnd && (ev.end > dayStart || (ev.end === ev.start && ev.start >= dayStart));
    if (!touches) continue;
    const startsToday = ev.start >= dayStart;
    const timed = !ev.allDay && startsToday;
    out.push({
      id: `apple:${ev.id}`,
      type: "termin",
      source: "apple",
      title: ev.title,
      date: day,
      start: timed ? hhmm(ev.start) : null,
      end: timed && ev.end > ev.start && ev.end < dayEnd ? hhmm(ev.end) : null,
      note: "",
      calendar: ev.calendar,
      location: ev.location,
      event: ev,
    });
  }
  return out;
}

/** Beschreibung von Datum/Zeit eines Apple-Termins für die Detailansicht. */
export function describeAppleTime(ev) {
  const startKey = toKey(new Date(ev.start));
  // Ganztägige Termine enden um 23:59:59 bzw. 0:00 des Folgetags.
  const endKey = toKey(new Date(ev.allDay ? Math.max(ev.start, ev.end - 1) : ev.end));
  if (ev.allDay) {
    return startKey === endKey ? `${formatLong(startKey)}, ganztägig` : `${formatShort(startKey)} – ${formatShort(endKey)}, ganztägig`;
  }
  if (startKey === endKey) {
    return ev.end > ev.start ? `${formatLong(startKey)}, ${hhmm(ev.start)}–${hhmm(ev.end)}` : `${formatLong(startKey)}, ${hhmm(ev.start)}`;
  }
  return `${formatShort(startKey)}, ${hhmm(ev.start)} – ${formatShort(endKey)}, ${hhmm(ev.end)}`;
}
