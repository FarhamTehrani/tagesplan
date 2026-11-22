import {
  STORAGE_KEY, todayKey, addDays, weekDays, formatLong, formatShort, formatWeekday, fromKey,
  relativeLabel, normalizeItems, normalizeItem, dayView, nowAndNext, dayMarkers, toggleDone,
  toMinutes, newId, normalizeTombstones, applyChanges, rowsToPush, mergeRemote,
  normalizeAppleEvents, appleForDay, describeAppleTime,
} from "./lib.js";
import { createCloud, AuthError, NetworkError, ServerError } from "./cloud.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);

const state = {
  items: [],
  today: todayKey(),
  day: todayKey(),
  // Abgleich mit dem Konto
  accountId: null, // Konto, zu dem die Einträge auf diesem Gerät gehören
  tombstones: {}, // gelöschte Einträge: { id: Zeitpunkt }
  pending: new Set(), // IDs, die noch nicht zum Server übertragen wurden
  cursor: null, // neuester bekannter Server-Zeitpunkt (synced_at)
  lastSyncAt: null,
  // Apple-Kalender (vom Kurzbefehl übertragen, nur lesbar)
  apple: emptyApple(),
};

function emptyApple() {
  return { connected: null, lastImport: null, lastCount: null, events: [], error: null };
}

const cloud = SUPABASE_URL && SUPABASE_KEY ? createCloud({ url: SUPABASE_URL, key: SUPABASE_KEY }) : null;

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
    const data = JSON.parse(raw);
    state.items = normalizeItems(data.items);
    if (data.version === 2) {
      state.accountId = typeof data.accountId === "string" ? data.accountId : null;
      state.tombstones = normalizeTombstones(data.tombstones);
      state.pending = new Set(Array.isArray(data.pending) ? data.pending.filter((id) => typeof id === "string") : []);
      state.cursor = typeof data.cursor === "string" ? data.cursor : null;
      state.lastSyncAt = Number.isFinite(data.lastSyncAt) ? data.lastSyncAt : null;
      const a = data.apple;
      if (a && typeof a === "object") {
        state.apple = {
          ...emptyApple(),
          connected: typeof a.connected === "boolean" ? a.connected : null,
          lastImport: typeof a.lastImport === "string" ? a.lastImport : null,
          lastCount: Number.isFinite(a.lastCount) ? a.lastCount : null,
          events: normalizeAppleEvents(a.events),
        };
      }
    }
  } catch {
    showToast("Gespeicherte Daten konnten nicht gelesen werden.");
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      items: state.items,
      accountId: state.accountId,
      tombstones: state.tombstones,
      pending: [...state.pending],
      cursor: state.cursor,
      lastSyncAt: state.lastSyncAt,
      apple: {
        connected: state.apple.connected,
        lastImport: state.apple.lastImport,
        lastCount: state.apple.lastCount,
        events: state.apple.events,
      },
    }));
  } catch {
    showToast("Speichern fehlgeschlagen. Ist der Speicher voll oder privat?");
  }
}

function commit(next, toast) {
  const before = state.items;
  const result = applyChanges(before, next, state.tombstones, Date.now());
  state.items = result.items;
  if (state.accountId) {
    state.tombstones = result.tombstones;
    for (const id of result.changed) state.pending.add(id);
  }
  save();
  render();
  scheduleSync();
  if (toast) showToast(toast, "Rückgängig", () => commit(before));
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

  const view = dayView(items, day, today, appleForDay(state.apple.events, day));
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
      const apple = appleForDay(state.apple.events, key).length;
      m.termine += apple;
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
        h("span", { class: "dots" },
          m.termine > apple ? h("i", { class: "t" }) : null,
          apple ? h("i", { class: "p" }) : null,
          m.aufgaben ? h("i", { class: "a" }) : null)));
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
      const apple = t.source === "apple";
      const sub = [
        t.end ? `bis ${t.end}` : null,
        apple && t.calendar ? h("span", { class: "cal-tag" }, t.calendar) : null,
        apple ? (t.location ? firstLine(t.location) : null) : t.note ? firstLine(t.note) : null,
      ].filter(Boolean);
      return h("li", { class: `termin${apple ? " apple" : ""}${past ? " past" : ""}` },
        h("div", { class: "row" },
          h("button", { type: "button", class: "row-main", onclick: () => (apple ? openAppleInfo(t.event) : openEditor(t)) },
            h("span", { class: "time" }, t.start ?? h("small", {}, "ganzt.")),
            h("span", { class: "row-text" },
              h("span", { class: "row-title" }, t.title,
                t.id === current ? h("span", { class: "badge now" }, "Jetzt") : null,
                t.id === next ? h("span", { class: "badge next" }, "Als Nächstes") : null),
              sub.length ? h("span", { class: "row-sub" }, sub.flatMap((x, i) => (i ? [" · ", x] : [x]))) : null))));
    }),
  );
}

function openAppleInfo(ev) {
  $("apple-info-title").textContent = ev.title;
  $("apple-info-time").textContent = describeAppleTime(ev);
  $("apple-info-cal").textContent = ev.calendar;
  $("apple-info-cal-row").hidden = !ev.calendar;
  $("apple-info-loc").textContent = ev.location;
  $("apple-info-loc-row").hidden = !ev.location;
  $("apple-info").showModal();
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

/* ---------- Konto & Abgleich ---------- */

const sync = { state: "idle", message: "", promise: null, again: false, timer: null };

function scheduleSync(delay = 1500) {
  if (!cloud?.user) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, delay);
}

function runSync() {
  clearTimeout(sync.timer);
  if (!cloud?.user) return Promise.resolve();
  if (sync.promise) {
    sync.again = true; // läuft schon – danach noch einmal
    return sync.promise;
  }
  sync.promise = (async () => {
    do {
      sync.again = false;
      await syncOnce();
    } while (sync.again && cloud.user);
  })().finally(() => {
    sync.promise = null;
  });
  return sync.promise;
}

function currentStamp(id) {
  const item = state.items.find((i) => i.id === id);
  return item ? item.updatedAt : state.tombstones[id];
}

async function syncOnce() {
  setSyncState("syncing");
  try {
    // 1. Eigene Änderungen hochladen
    const ids = [...state.pending];
    const rows = rowsToPush(state.items, state.tombstones, ids, cloud.user.id);
    if (rows.length) await cloud.push(rows);
    const pushed = new Map(rows.map((r) => [r.id, Date.parse(r.updated_at)]));
    for (const id of ids) {
      // Nur als gesichert markieren, wenn der Eintrag während des Uploads nicht erneut geändert wurde.
      if (!pushed.has(id) || currentStamp(id) === pushed.get(id)) state.pending.delete(id);
    }

    // 2. Änderungen anderer Geräte holen (mit etwas Überlappung, doppelt Geholtes ist harmlos)
    const since = state.cursor ? new Date(Date.parse(state.cursor) - 60_000).toISOString() : null;
    const remote = await cloud.pull(since);
    const merged = mergeRemote(state, remote);
    state.items = merged.items;
    state.tombstones = merged.tombstones;
    state.pending = merged.pending;
    state.cursor = merged.cursor;
    state.lastSyncAt = Date.now();

    // 3. Termine aus dem Apple-Kalender holen (Fehler hier stören den Abgleich der Einträge nicht)
    await fetchApple();

    save();
    render();
    setSyncState(state.pending.size ? "pending" : "ok");
  } catch (e) {
    save();
    if (e instanceof AuthError) setSyncState("auth", e.message);
    else if (e instanceof NetworkError) setSyncState("offline");
    else setSyncState("error", e.message);
  }
}

async function fetchApple() {
  try {
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const [status, events] = await Promise.all([
      cloud.get("/calendar_tokens?select=last_used_at,last_count"),
      cloud.get(`/calendar_events?select=id,title,start_at,end_at,all_day,calendar,location&end_at=gte.${encodeURIComponent(since)}&order=start_at.asc&limit=5000`),
    ]);
    state.apple = {
      connected: status.length > 0,
      lastImport: status[0]?.last_used_at ?? null,
      lastCount: status[0]?.last_count ?? null,
      events: normalizeAppleEvents(events),
      error: null,
    };
  } catch (e) {
    if (e instanceof AuthError || e instanceof NetworkError) throw e;
    // Tabelle fehlt → kalender.sql wurde noch nicht ausgeführt
    state.apple.error = e instanceof ServerError && (e.code === "PGRST205" || e.code === "42P01" || e.status === 404) ? "missing" : e.message;
  }
}

function setSyncState(s, message = "") {
  sync.state = s;
  sync.message = message;
  renderAccount();
}

const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

function syncStatusText() {
  const n = state.pending.size;
  const open = n === 1 ? "1 Änderung" : `${n} Änderungen`;
  switch (sync.state) {
    case "syncing": return "Wird abgeglichen …";
    case "offline": return n ? `Offline – ${open} ${n === 1 ? "wird" : "werden"} gesichert, sobald du online bist.` : "Offline.";
    case "error": return `Abgleich fehlgeschlagen: ${sync.message}`;
    case "pending": return `${open} noch nicht gesichert.`;
    default: {
      if (!state.lastSyncAt) return "Noch nicht abgeglichen.";
      const d = new Date(state.lastSyncAt);
      const when = todayKey(d) === state.today ? `heute um ${timeFmt.format(d)}` : `${formatShort(todayKey(d))} um ${timeFmt.format(d)}`;
      return `Alles gesichert, ${when}.`;
    }
  }
}

function renderAccount() {
  if (!cloud) return;
  const user = cloud.user;
  $("account").hidden = false;
  $("login-form").hidden = !!user;
  $("account-info").hidden = !user;
  $("backup-hint").textContent = user
    ? "Zusätzlich zum Konto kannst du eine Sicherung als Datei aufbewahren."
    : "Ohne Anmeldung werden deine Einträge nur auf diesem Gerät gespeichert. Sichere sie ab und zu als Datei.";

  if (user) {
    $("account-email").textContent = user.email;
    const status = $("sync-status");
    status.textContent = syncStatusText();
    status.dataset.state = sync.state;
    $("sync-btn").disabled = sync.state === "syncing";
  } else if (sync.state === "auth" && sync.message) {
    const err = $("login-error");
    err.textContent = sync.message;
    err.hidden = false;
  }
  renderApple();
  // Roter Punkt am Menü: Anmeldung abgelaufen oder Abgleich kaputt
  $("menu-dot").hidden = !(sync.state === "error" || (sync.state === "auth" && state.accountId));
}

function appleStatusText() {
  const a = state.apple;
  if (a.error === "missing") return "Noch nicht verfügbar: Im Supabase-Dashboard muss zuerst supabase/kalender.sql ausgeführt werden.";
  if (a.error) return `Fehler: ${a.error}`;
  if (!a.connected) return "Übertrage Termine aus deinem iPhone-Kalender mit einem Kurzbefehl.";
  if (!a.lastImport) return "Schlüssel erzeugt. Der Kurzbefehl hat noch keine Termine übertragen.";
  const d = new Date(a.lastImport);
  const when = todayKey(d) === state.today ? `heute um ${timeFmt.format(d)}` : `${formatShort(todayKey(d))} um ${timeFmt.format(d)}`;
  const n = a.lastCount ?? a.events.length;
  return `Zuletzt übertragen ${when} (${n === 1 ? "1 Termin" : `${n} Termine`}).`;
}

function renderApple() {
  const user = cloud?.user;
  $("apple-section").hidden = !user;
  if (!user) return;
  const status = $("apple-status");
  status.textContent = appleStatusText();
  status.dataset.state = state.apple.error ? "error" : "";
  $("apple-setup-btn").textContent = state.apple.connected ? "Anleitung & neuer Schlüssel" : "Kurzbefehl einrichten";
  $("apple-setup-btn").disabled = state.apple.error === "missing";
  $("apple-remove-btn").hidden = !state.apple.connected;
}

const shortcutDialog = $("shortcut");

$("apple-setup-btn").addEventListener("click", () => {
  $("sc-url").textContent = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/import_calendar`;
  $("sc-key").textContent = SUPABASE_KEY;
  $("token-row").hidden = true;
  $("token-hint").hidden = true;
  $("token-error").hidden = true;
  $("token-btn").textContent = state.apple.connected ? "Neuen Schlüssel erzeugen" : "Schlüssel erzeugen";
  shortcutDialog.showModal();
});

$("token-btn").addEventListener("click", async () => {
  if (state.apple.connected && !confirm("Neuen Schlüssel erzeugen? Der bisherige Kurzbefehl funktioniert dann erst wieder, wenn du dort den neuen Schlüssel einträgst.")) return;
  const btn = $("token-btn");
  btn.disabled = true;
  $("token-error").hidden = true;
  try {
    const token = await cloud.rpc("create_calendar_token");
    $("token-value").textContent = token;
    $("token-row").hidden = false;
    $("token-hint").hidden = false;
    btn.textContent = "Neuen Schlüssel erzeugen";
    state.apple = { ...state.apple, connected: true, lastImport: null, lastCount: null, error: null };
    save();
    renderApple();
  } catch (e) {
    $("token-error").textContent = e instanceof NetworkError ? "Keine Verbindung. Bist du online?" : e.message;
    $("token-error").hidden = false;
    if (e instanceof AuthError) setSyncState("auth", e.message);
  } finally {
    btn.disabled = false;
  }
});

for (const btn of document.querySelectorAll("[data-copy]")) {
  btn.addEventListener("click", async () => {
    const el = $(btn.dataset.copy);
    try {
      await navigator.clipboard.writeText(el.textContent);
      btn.textContent = "Kopiert ✓";
      setTimeout(() => (btn.textContent = "Kopieren"), 1500);
    } catch {
      // Ohne Zwischenablage-Zugriff: Text markieren, damit er von Hand kopiert werden kann.
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      showToast("Bitte den markierten Text kopieren.");
    }
  });
}

$("apple-remove-btn").addEventListener("click", async () => {
  if (!confirm("Verbindung zum Apple-Kalender trennen? Die übertragenen Termine werden entfernt und der Kurzbefehl funktioniert nicht mehr.")) return;
  try {
    await cloud.rpc("remove_calendar");
    state.apple = { ...emptyApple(), connected: false };
    save();
    render();
    renderApple();
    showToast("Apple-Kalender getrennt.");
  } catch (e) {
    showToast(e instanceof NetworkError ? "Keine Verbindung. Bist du online?" : `Fehler: ${e.message}`);
  }
});

/** Verknüpft die Einträge auf diesem Gerät mit dem angemeldeten Konto. */
function linkAccount(userId) {
  if (state.accountId !== userId) {
    // Erstes Mal (oder anderes Konto): alles Lokale hochladen, Server-Stand komplett holen.
    state.accountId = userId;
    state.cursor = null;
    state.tombstones = {};
    state.pending = new Set(state.items.map((i) => i.id));
  }
  save();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const email = f.email.value.trim();
  const password = f.password.value;
  const err = $("login-error");
  if (!email || !password) {
    err.textContent = "Bitte E-Mail und Passwort eingeben.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const btn = $("login-btn");
  btn.disabled = true;
  btn.textContent = "Anmelden …";
  try {
    const user = await cloud.signIn(email, password);
    if (state.accountId && state.accountId !== user.id) {
      const ok = confirm("Die Einträge auf diesem Gerät gehören zu einem anderen Konto. Sollen sie mit diesem Konto zusammengeführt werden?");
      if (!ok) {
        await cloud.signOut();
        return;
      }
    }
    f.password.value = "";
    linkAccount(user.id);
    setSyncState("idle");
    await runSync();
    if (sync.state === "ok") showToast("Angemeldet – deine Einträge sind gesichert.");
  } catch (ex) {
    err.textContent = ex instanceof NetworkError ? "Keine Verbindung. Bist du online?" : ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Anmelden";
    renderAccount();
  }
});

$("sync-btn").addEventListener("click", () => runSync());

$("logout-btn").addEventListener("click", async () => {
  await runSync();
  const n = state.pending.size;
  const question = n
    ? `${n === 1 ? "1 Änderung ist" : `${n} Änderungen sind`} noch nicht gesichert und ${n === 1 ? "geht" : "gehen"} beim Abmelden verloren. Trotzdem abmelden?`
    : "Abmelden? Deine Einträge werden von diesem Gerät entfernt und bleiben in deinem Konto gespeichert.";
  if (!confirm(question)) return;
  await cloud.signOut();
  Object.assign(state, { items: [], accountId: null, tombstones: {}, pending: new Set(), cursor: null, lastSyncAt: null, apple: emptyApple() });
  save();
  setSyncState("idle");
  render();
  showToast("Abgemeldet.");
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

const dialogs = [editor, menu, $("apple-info"), shortcutDialog];
for (const dlg of dialogs) {
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
  if (!dialogs.some((d) => d.open)) render();
}
setInterval(tick, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  tick();
  // Beim Zurückkehren in die App: Änderungen anderer Geräte holen (höchstens alle 30 s).
  if (!state.lastSyncAt || Date.now() - state.lastSyncAt > 30_000) scheduleSync(0);
});
window.addEventListener("online", () => scheduleSync(0));
setInterval(() => {
  if (document.visibilityState === "visible") scheduleSync(0);
}, 5 * 60_000);

if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
  $("install-hint").hidden = true;
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

load();
if (cloud?.user) {
  linkAccount(cloud.user.id);
} else if (cloud && state.accountId) {
  // Früher angemeldet, Anmeldung aber weg: Änderungen werden weiter gesammelt und nach dem Anmelden übertragen.
  sync.state = "auth";
  sync.message = "Bitte melde dich erneut an, damit deine Einträge gesichert werden.";
}
render();
renderAccount();
scheduleSync(0);
