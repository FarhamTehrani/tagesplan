import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, weekStart, weekDays, isValidKey, relativeLabel, normalizeItem, normalizeItems,
  dayView, nowAndNext, dayMarkers, toggleDone,
} from "../lib.js";

const T = (o) => ({ id: o.title, type: "aufgabe", date: null, note: "", done: false, doneOn: null, ...o });
const E = (o) => ({ id: o.title, type: "termin", start: null, end: null, note: "", ...o });

test("Datumsrechnung über Monats-, Jahres- und Zeitumstellungsgrenzen", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30"); // Sommerzeit
  assert.equal(addDays("2026-10-25", -1), "2026-10-24"); // Winterzeit
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // Sonntag → Montag davor
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.deepEqual(weekDays("2026-11-18").at(-1), "2026-11-22");
});

test("isValidKey und relativeLabel", () => {
  assert.ok(isValidKey("2026-02-28"));
  assert.ok(!isValidKey("2026-02-30"));
  assert.ok(!isValidKey("22.11.2026"));
  assert.equal(relativeLabel("2026-11-22", "2026-11-22"), "Heute");
  assert.equal(relativeLabel("2026-11-23", "2026-11-22"), "Morgen");
  assert.equal(relativeLabel("2026-11-21", "2026-11-22"), "Gestern");
  assert.equal(relativeLabel("2026-11-25", "2026-11-22"), null);
});

test("normalizeItem verwirft Ungültiges und bereinigt Felder", () => {
  assert.equal(normalizeItem({ id: "1", type: "termin", title: "X" }), null); // Termin ohne Datum
  assert.equal(normalizeItem({ id: "1", type: "aufgabe", title: "   " }), null);
  assert.equal(normalizeItem({ id: "1", type: "foo", title: "X" }), null);
  const t = normalizeItem({ id: "1", type: "termin", title: " Arzt ", date: "2026-11-22", start: "10:00", end: "09:00" });
  assert.equal(t.title, "Arzt");
  assert.equal(t.end, null); // Ende vor Beginn
  const a = normalizeItem({ id: "2", type: "aufgabe", title: "Mails", start: "10:00", done: true, doneOn: "kaputt" });
  assert.equal(a.start, null);
  assert.equal(a.doneOn, null);
  assert.equal(normalizeItems([{ id: "a", type: "aufgabe", title: "x" }, { id: "a", type: "aufgabe", title: "y" }, null]).length, 1);
  assert.deepEqual(normalizeItems("nope"), []);
});

test("dayView: heute mit überfälligen, undatierten und erledigten Aufgaben", () => {
  const today = "2026-11-22";
  const items = [
    E({ title: "Meeting", date: today, start: "14:00" }),
    E({ title: "Geburtstag", date: today }),
    E({ title: "Morgen-Termin", date: "2026-11-23", start: "09:00" }),
    T({ title: "Alt", date: "2026-11-20" }),
    T({ title: "Heute", date: today }),
    T({ title: "Irgendwann" }),
    T({ title: "Gestern erledigt", date: "2026-11-21", done: true, doneOn: "2026-11-21" }),
    T({ title: "Nachgeholt", date: "2026-11-19", done: true, doneOn: today }),
  ];
  const v = dayView(items, today, today);
  assert.deepEqual(v.termine.map((t) => t.title), ["Geburtstag", "Meeting"]);
  assert.deepEqual(v.overdue.map((t) => t.title), ["Alt"]);
  assert.deepEqual(v.due.map((t) => t.title), ["Heute"]);
  assert.deepEqual(v.undated.map((t) => t.title), ["Irgendwann"]);
  assert.deepEqual(v.done.map((t) => t.title), ["Nachgeholt"]);
});

test("dayView: anderer Tag zeigt keine überfälligen oder undatierten Aufgaben", () => {
  const items = [T({ title: "Alt", date: "2026-11-20" }), T({ title: "Irgendwann" }), T({ title: "Morgen", date: "2026-11-23" })];
  const v = dayView(items, "2026-11-23", "2026-11-22");
  assert.deepEqual(v.overdue, []);
  assert.deepEqual(v.undated, []);
  assert.deepEqual(v.due.map((t) => t.title), ["Morgen"]);
});

test("nowAndNext findet laufenden und nächsten Termin", () => {
  const termine = [E({ title: "A", start: "09:00", end: "10:30" }), E({ title: "B", start: "11:00" }), E({ title: "Ganztags" })];
  assert.deepEqual(nowAndNext(termine, 9 * 60 + 30), { current: "A", next: "B" });
  assert.deepEqual(nowAndNext(termine, 11 * 60 + 59), { current: "B", next: null }); // ohne Ende: 1 Stunde
  assert.deepEqual(nowAndNext(termine, 8 * 60), { current: null, next: "A" });
});

test("dayMarkers und toggleDone", () => {
  const items = [E({ title: "A", date: "2026-11-22" }), T({ title: "B", date: "2026-11-22" }), T({ title: "C", date: "2026-11-22", done: true })];
  assert.deepEqual(dayMarkers(items, "2026-11-22"), { termine: 1, aufgaben: 1 });
  const done = toggleDone(items[1], "2026-11-22");
  assert.equal(done.done, true);
  assert.equal(done.doneOn, "2026-11-22");
  assert.equal(toggleDone(done, "2026-11-22").doneOn, null);
});
