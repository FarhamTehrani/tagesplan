import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAppleEvents, appleForDay, describeAppleTime, dayView } from "../lib.js";

const at = (d, h = 0, m = 0, s = 0) => new Date(2026, 10, d, h, m, s).getTime(); // November 2026, lokale Zeit
const ev = (o) => ({ id: o.title, calendar: "Privat", location: "", allDay: false, ...o });

test("normalizeAppleEvents liest Serverzeilen und verwirft Ungültiges", () => {
  const list = normalizeAppleEvents([
    { id: "a", title: "A", start_at: "2026-11-22T09:00:00+01:00", end_at: "2026-11-22T10:00:00+01:00", all_day: false, calendar: "Arbeit", location: "Büro" },
    { id: "b", title: "B", start_at: "kaputt", end_at: "2026-11-22T10:00:00+01:00" },
    { title: "ohne id", start_at: "2026-11-22T09:00:00+01:00", end_at: "2026-11-22T10:00:00+01:00" },
    null,
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, Date.parse("2026-11-22T09:00:00+01:00"));
  assert.equal(list[0].calendar, "Arbeit");
  // Bereits normalisierte Daten (aus dem lokalen Speicher) bleiben gleich
  assert.deepEqual(normalizeAppleEvents(list), list);
});

test("appleForDay: normaler Termin, ganztägig und mehrtägig", () => {
  const events = [
    ev({ title: "Meeting", start: at(22, 9, 30), end: at(22, 10) }),
    ev({ title: "Geburtstag", allDay: true, start: at(22), end: at(22, 23, 59, 59) }),
    ev({ title: "Urlaub", allDay: true, start: at(21), end: at(24, 23, 59, 59) }),
    ev({ title: "Nachtschicht", start: at(22, 22), end: at(23, 6) }),
    ev({ title: "Morgen", start: at(23, 8), end: at(23, 9) }),
  ];
  const d22 = appleForDay(events, "2026-11-22");
  assert.deepEqual(d22.map((e) => [e.title, e.start, e.end]), [
    ["Meeting", "09:30", "10:00"],
    ["Geburtstag", null, null],
    ["Urlaub", null, null],
    ["Nachtschicht", "22:00", null],
  ]);
  assert.ok(d22.every((e) => e.source === "apple" && e.id.startsWith("apple:")));
  const d23 = appleForDay(events, "2026-11-23");
  assert.deepEqual(d23.map((e) => [e.title, e.start]), [["Urlaub", null], ["Nachtschicht", null], ["Morgen", "08:00"]]);
  assert.deepEqual(appleForDay(events, "2026-11-25"), []);
});

test("appleForDay: Termin ohne Dauer und Ende genau um Mitternacht", () => {
  const events = [
    ev({ title: "Erinnerung", start: at(22, 12), end: at(22, 12) }),
    ev({ title: "Bis Mitternacht", start: at(22, 20), end: at(23, 0) }),
  ];
  assert.deepEqual(appleForDay(events, "2026-11-22").map((e) => e.title), ["Erinnerung", "Bis Mitternacht"]);
  assert.deepEqual(appleForDay(events, "2026-11-23"), []);
});

test("dayView mischt Apple-Termine sortiert unter die eigenen", () => {
  const own = [{ id: "x", type: "termin", title: "Eigener", date: "2026-11-22", start: "10:00", end: null, note: "", updatedAt: 0 }];
  const apple = appleForDay([ev({ title: "Apple früh", start: at(22, 8), end: at(22, 9) }), ev({ title: "Apple ganztags", allDay: true, start: at(22), end: at(22, 23, 59) })], "2026-11-22");
  const v = dayView(own, "2026-11-22", "2026-11-22", apple);
  assert.deepEqual(v.termine.map((t) => t.title), ["Apple ganztags", "Apple früh", "Eigener"]);
});

test("describeAppleTime", () => {
  assert.equal(describeAppleTime(ev({ start: at(22, 9, 30), end: at(22, 10) })), "Sonntag, 22. November, 09:30–10:00");
  assert.equal(describeAppleTime(ev({ allDay: true, start: at(22), end: at(22, 23, 59, 59) })), "Sonntag, 22. November, ganztägig");
  assert.equal(describeAppleTime(ev({ allDay: true, start: at(21), end: at(24, 23, 59, 59) })), "Sa., 21.11. – Di., 24.11., ganztägig");
  assert.equal(describeAppleTime(ev({ start: at(22, 22), end: at(23, 6) })), "So., 22.11., 22:00 – Mo., 23.11., 06:00");
});
