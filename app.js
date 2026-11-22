import {
  STORAGE_KEY, todayKey, addDays, weekDays, formatLong, formatShort, formatWeekday, fromKey,
  relativeLabel, normalizeItems, normalizeItem, dayView, nowAndNext, dayMarkers, toggleDone,
  toMinutes, newId,
} from "./lib.js";

const $ = (id) => document.getElementById(id);

const state = {
  items: [],
  today: todayKey(),
  day: todayKey(),
};

/* ---------- Speicher ---------- */

function load() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    showToast("Speicher ist nicht verfügbar – Einträge werden nicht gesichert.");
    return;
  }
  if (!raw) return;
  try {
    state.items = normalizeItems(JSON.parse(raw).items);
  } catch {
    showToast("Gespeicherte Daten konnten nicht gelesen werden.");
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items: state.items }));
  } catch {
    showToast("Speichern fehlgeschlagen. Ist der Speicher voll oder privat?");
  }
}

function commit(items, toast) {
  const before = state.items;
  state.items = items;
  save();
  render();
  if (toast) {
    showToast(toast, "Rückgängig", () => {
      state.items = before;
      save();
      render();
    });
  }
}

/* ---------- Rendering ---------- */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (markup) => {
  const t = document.createElement("template");
  t.innerHTML = markup;
  return t.content.firstChild;
};
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function render() {
  const { day, today, items } = state;
  const isToday = day === today;

  $("relative").textContent = relativeLabel(day, today) ?? "";
  $("day-title").textContent = formatLong(day);
  document.title = isToday ? "Tagesplan – Heute" : `Tagesplan – ${formatShort(day)}`;
  $("today-btn").hidden = isToday;

  renderWeek();

  const view = dayView(items, day, today);
  renderTermine(view.termine, isToday);
  renderAufgaben(view);

  // Zusammenfassung
  const open = view.overdue.length + view.due.length + view.undated.length;
  const total = open + view.done.length;
  const parts = [];
  parts.push(view.termine.length === 1 ? "1 Termin" : `${view.termine.length} Termine`);
  if (total) parts.push(`${view.done.length} von ${total} Aufgaben erledigt`);
  else parts.push("keine Aufgaben");
  $("summary").textContent = parts.join(" · ");
  $("progress").hidden = total === 0;
  $("progress-bar").style.width = total ? `${(view.done.length / total) * 100}%` : "0";
}

function renderWeek() {
  const list = $("week-days");
  list.replaceChildren(
    ...weekDays(state.day).map((key) => {
      const m = dayMarkers(state.items, key);
      const label = `${formatLong(key)}${m.termine ? `, ${m.termine} Termine` : ""}${m.aufgaben ? `, ${m.aufgaben} offene Aufgaben` : ""}`;
      return h("li", {},
        h("button", {
          type: "button",
          class: `day-btn${key === state.today ? " today" : ""}`,
          "aria-current": key === state.day ? "date" : null,
          "aria-label": label,
          onclick: () => setDay(key),
        },
        h("span", { class: "wd" }, formatWeekday(key)),
        h("span", { class: "num" }, fromKey(key).getDate()),
        h("span", { class: "dots" }, m.termine ? h("i", { class: "t" }) : null, m.aufgaben ? h("i", { class: "a" }) : null)));
    }),
  );
}

function renderTermine(termine, isToday) {
  const list = $("termine");
  const empty = $("termine-empty") ?? h("p", { class: "empty", id: "termine-empty" });
  if (!termine.length) {
    list.replaceChildren();
    empty.textContent = "Keine Termine.";
    list.after(empty);
    return;
  }
  empty.remove();

  const mins = nowMinutes();
  const { current, next } = isToday ? nowAndNext(termine, mins) : {};
  list.replaceChildren(
    ...termine.map((t) => {
      const endMin = t.start ? (t.end ? toMinutes(t.end) : toMinutes(t.start) + 60) : null;
      const past = isToday && endMin != null && endMin <= mins;
      const sub = [t.end ? `bis ${t.end}` : null, t.note ? firstLine(t.note) : null].filter(Boolean).join(" · ");
      return h("li", { class: `termin${past ? " past" : ""}` },
        h("div", { class: "row" },
          h("button", { type: "button", class: "row-main", onclick: () => openEditor(t) },
            h("span", { class: "time" }, t.start ?? h("small", {}, "ganzt.")),
            h("span", { class: "row-text" },
              h("span", { class: "row-title" }, t.title,
                t.id === current ? h("span", { class: "badge now" }, "Jetzt") : null,
                t.id === next ? h("span", { class: "badge next" }, "Als Nächstes") : null),
              sub ? h("span", { class: "row-sub" }, sub) : null))));
    }),
  );
}

function renderAufgaben(view) {
  const list = $("aufgaben");
  const empty = $("aufgaben-empty") ?? h("p", { class: "empty", id: "aufgaben-empty" });
  const rows = [];
  if (view.overdue.length) {
    rows.push(h("li", { class: "group-label warn" }, "Überfällig"));
    rows.push(...view.overdue.map((t) => taskRow(t, `seit ${formatShort(t.date)}`, true)));
  }
  if (view.due.length) {
    if (rows.length) rows.push(h("li", { class: "group-label" }, "Heute"));
    rows.push(...view.due.map((t) => taskRow(t)));
  }
  if (view.undated.length) {
    rows.push(h("li", { class: "group-label" }, "Irgendwann"));
    rows.push(...view.undated.map((t) => taskRow(t)));
  }
  if (view.done.length) {
    rows.push(h("li", { class: "group-label" }, "Erledigt"));
    rows.push(...view.done.map((t) => taskRow(t)));
  }
  list.replaceChildren(...rows);
  if (rows.length) {
    empty.remove();
  } else {
    empty.textContent = "Keine Aufgaben. Tippe auf +, um eine hinzuzufügen.";
    list.after(empty);
  }
}

function taskRow(t, extra, overdue = false) {
  const sub = [extra, t.note ? firstLine(t.note) : null].filter(Boolean).join(" · ");
  return h("li", { class: `aufgabe${t.done ? " done" : ""}${overdue ? " overdue" : ""}` },
    h("div", { class: "row" },
      h("button", {
        type: "button",
        class: "check",
        role: "checkbox",
        "aria-checked": t.done ? "true" : "false",
        "aria-label": `${t.title} erledigt`,
        onclick: () => toggle(t.id),
      }, h("span", {}, svg(CHECK))),
      h("button", { type: "button", class: "row-main", onclick: () => openEditor(t) },
        h("span", { class: "row-text" },
          h("span", { class: "row-title" }, t.title),
          sub ? h("span", { class: `row-sub${overdue ? " warn" : ""}` }, sub) : null))));
}

const firstLine = (s) => s.split("\n")[0].slice(0, 80);

/* ---------- Aktionen ---------- */

function setDay(key) {
  state.day = key;
  render();
}

function toggle(id) {
  commit(state.items.map((i) => (i.id === id ? toggleDone(i, state.today) : i)));
}

/* ---------- Editor ---------- */

const editor = $("editor");
const form = $("editor-form");
let editingId = null;

function currentType() {
  return form.elements.type.value;
}

function syncTypeFields() {
  const type = currentType();
  for (const el of form.querySelectorAll("[data-for]")) el.hidden = el.dataset.for !== type;
  if (type === "termin") $("time-error").hidden = true;
}

function openEditor(item = null) {
  editingId = item?.id ?? null;
  form.reset();
  for (const id of ["title-error", "date-error", "time-error"]) $(id).hidden = true;

  $("editor-title").textContent = item ? (item.type === "termin" ? "Termin bearbeiten" : "Aufgabe bearbeiten") : "Neu";
  form.elements.type.value = item?.type ?? "aufgabe";
  form.elements.title.value = item?.title ?? "";
  form.elements.date.value = item ? item.date ?? "" : state.day;
  form.elements.start.value = item?.start ?? "";
  form.elements.end.value = item?.end ?? "";
  form.elements.note.value = item?.note ?? "";
  $("delete-btn").hidden = !item;
  syncTypeFields();

  editor.showModal();
  if (!item) form.elements.title.focus();
}

form.addEventListener("change", (e) => {
  if (e.target.name === "type") syncTypeFields();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = form.elements;
  const type = currentType();
  const title = f.title.value.trim();
  const date = f.date.value || null;
  const start = type === "termin" ? f.start.value || null : null;
  const end = type === "termin" && start ? f.end.value || null : null;

  $("title-error").hidden = !!title;
  $("date-error").hidden = !(type === "termin" && !date);
  const badTime = !!(start && end && toMinutes(end) <= toMinutes(start));
  $("time-error").hidden = !badTime;
  if (!title || (type === "termin" && !date) || badTime) {
    (!title ? f.title : !date ? f.date : f.end).focus();
    return;
  }

  const existing = state.items.find((i) => i.id === editingId);
  const item = normalizeItem({
    id: editingId ?? newId(),
    type,
    title,
    date,
    start,
    end,
    note: f.note.value.trim(),
    done: existing?.type === "aufgabe" && type === "aufgabe" ? existing.done : false,
    doneOn: existing?.doneOn ?? null,
  });
  if (!item) return;

  const items = existing ? state.items.map((i) => (i.id === item.id ? item : i)) : [...state.items, item];
  editor.close();
  commit(items);
  if (item.date && item.date !== state.day && !existing) {
    showToast(`Gespeichert für ${formatShort(item.date)}.`, "Anzeigen", () => setDay(item.date));
  }
});

$("delete-btn").addEventListener("click", () => {
  const item = state.items.find((i) => i.id === editingId);
  if (!item) return;
  editor.close();
  commit(state.items.filter((i) => i.id !== editingId), `„${item.title}“ gelöscht.`);
});

/* ---------- Menü: Sicherung ---------- */

const menu = $("menu");

$("export-btn").addEventListener("click", () => {
  const data = JSON.stringify({ app: "tagesplan", version: 1, exportedAt: new Date().toISOString(), items: state.items }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const a = h("a", { href: url, download: `tagesplan-${state.today}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("import-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  let items;
  try {
    const parsed = JSON.parse(await file.text());
    items = normalizeItems(Array.isArray(parsed) ? parsed : parsed?.items);
  } catch {
    showToast("Die Datei ist keine gültige Sicherung.");
    return;
  }
  if (!items.length) {
    showToast("In der Datei wurden keine Einträge gefunden.");
    return;
  }
  if (!confirm(`${items.length} Einträge wiederherstellen? Deine aktuellen ${state.items.length} Einträge werden ersetzt.`)) return;
  menu.close();
  commit(items, `${items.length} Einträge wiederhergestellt.`);
});

$("clear-done-btn").addEventListener("click", () => {
  const remaining = state.items.filter((i) => !(i.type === "aufgabe" && i.done));
  const removed = state.items.length - remaining.length;
  menu.close();
  if (!removed) {
    showToast("Keine erledigten Aufgaben vorhanden.");
    return;
  }
  commit(remaining, removed === 1 ? "1 erledigte Aufgabe entfernt." : `${removed} erledigte Aufgaben entfernt.`);
});

/* ---------- Toast ---------- */

let toastTimer;
function showToast(text, actionLabel, action) {
  const toast = $("toast");
  const btn = $("toast-action");
  $("toast-text").textContent = text;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel ?? "";
  btn.onclick = () => {
    toast.hidden = true;
    action?.();
  };
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), actionLabel ? 5000 : 3500);
}

/* ---------- Verdrahtung ---------- */

$("add-btn").addEventListener("click", () => openEditor());
$("menu-btn").addEventListener("click", () => menu.showModal());
$("prev-week").addEventListener("click", () => setDay(addDays(state.day, -7)));
$("next-week").addEventListener("click", () => setDay(addDays(state.day, 7)));
$("today-btn").addEventListener("click", () => setDay(state.today));

for (const dlg of [editor, menu]) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close(); // Tipp auf den Hintergrund
  });
  for (const btn of dlg.querySelectorAll("[data-close]")) btn.addEventListener("click", () => dlg.close());
}

// Wischen nach links/rechts wechselt den Tag.
let touch = null;
$("main").addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  touch = { x: t.clientX, y: t.clientY };
}, { passive: true });
$("main").addEventListener("touchend", (e) => {
  if (!touch) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 40) setDay(addDays(state.day, dx < 0 ? 1 : -1));
}, { passive: true });

// Datum wechselt um Mitternacht, "Jetzt"-Markierung jede Minute aktualisieren.
function tick() {
  const t = todayKey();
  if (t !== state.today) {
    const wasToday = state.day === state.today;
    state.today = t;
    if (wasToday) state.day = t;
  }
  if (!editor.open && !menu.open) render();
}
setInterval(tick, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tick();
});

if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
  $("install-hint").hidden = true;
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

load();
render();
