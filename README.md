# Tagesplan

Eine Web-App fürs Handy: Was steht heute an? Termine mit Uhrzeit und Aufgaben zum Abhaken, auf einen Blick.

## Funktionen

- **Tagesansicht** mit Terminen (ganztägig zuerst, dann nach Uhrzeit). Am heutigen Tag sind vergangene Termine ausgegraut, dazu gibt es „Jetzt“ und „Als Nächstes“.
- **Aufgaben** mit oder ohne Datum. Am heutigen Tag erscheinen zusätzlich:
  - **Überfällig**: offene Aufgaben von früheren Tagen
  - **Irgendwann**: Aufgaben ohne Datum
- **Wochenleiste** mit Punkten für Tage mit Terminen (blau) oder offenen Aufgaben (grün). Wischen nach links/rechts wechselt den Tag.
- **Rückgängig** nach dem Löschen.
- **Sicherung** als JSON-Datei herunterladen und wiederherstellen (Menü „…“).
- Funktioniert **offline** und lässt sich zum Home-Bildschirm hinzufügen.
- Heller und dunkler Modus folgen der Systemeinstellung.

## Auf dem iPhone installieren

1. Die Seite in **Safari** öffnen: <https://farhamtehrani.github.io/tagesplan/>
2. Auf **Teilen** → **Zum Home-Bildschirm** tippen.

## Wo liegen die Daten?

Immer zuerst im Browser des Geräts (`localStorage`), damit die App auch offline funktioniert. Nie in diesem Repo.

Mit **Konto** (Menü „…“ → Anmelden) werden die Einträge zusätzlich in einer Supabase-Datenbank gesichert und zwischen Geräten abgeglichen: nach jeder Änderung, beim Öffnen der App und sobald das Gerät wieder online ist. Wird derselbe Eintrag auf zwei Geräten geändert, gewinnt die spätere Änderung. Gelöschte Einträge bleiben als Löschmarke gespeichert, damit sie auf anderen Geräten nicht wieder auftauchen. Beim Abmelden werden die Einträge vom Gerät entfernt; im Konto bleiben sie erhalten.

Ohne Konto bleiben die Daten nur auf dem Gerät. Dann ab und zu über „…“ → „Sicherung herunterladen“ sichern.

## Konto einrichten (Supabase, einmalig)

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen, Region **Central EU (Frankfurt)**.
2. **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**. Das legt die Tabelle `items` an. Jeder Nutzer darf nur seine eigenen Zeilen lesen und ändern (Row Level Security).
3. **Authentication → Users → Add user → Create new user**: E-Mail und Passwort eintragen, **Auto Confirm User** anhaken.
4. **Authentication → Sign In / Providers**: **Allow new users to sign up** ausschalten. So kann sich niemand sonst registrieren.
5. **Project Settings → API Keys**: Die **Project URL** und den **Publishable key** (oder den alten `anon`-Key) in [`config.js`](config.js) eintragen. Beide Werte sind öffentlich. Den `secret`- bzw. `service_role`-Schlüssel niemals eintragen.

Ein neues Passwort setzt du im Supabase-Dashboard unter *Authentication → Users*.

## Entwicklung

Kein Build-Schritt, keine Abhängigkeiten. Node.js 20+ für die Tests.

```sh
npm start      # lokaler Server auf http://localhost:4173
npm test       # Tests für Logik, Abgleich und Supabase-Client
npm run icons  # PNG-Icons neu erzeugen
```

| Datei | Inhalt |
| --- | --- |
| `lib.js` | Reine Logik: Datumsrechnung, Tagesansicht, Prüfung gespeicherter Daten |
| `app.js` | Oberfläche, Speicher, Editor, Sicherung, Konto und Abgleich |
| `cloud.js` | Anmeldung und Datenzugriff bei Supabase über `fetch` (ohne Bibliothek) |
| `config.js` | Project URL und öffentlicher Schlüssel des Supabase-Projekts |
| `supabase/schema.sql` | Tabelle, Zugriffsregeln und „neuere Änderung gewinnt“-Trigger |
| `sw.js` | Service Worker für Offline-Betrieb (Netzwerk zuerst, sonst Cache) |

Veröffentlicht wird über GitHub Pages direkt aus dem Branch `main`.

## Ideen für später

- Termine aus dem iCloud-Kalender übernehmen (öffentlicher Kalender-Link, abgerufen über eine GitHub Action oder einen kleinen Proxy)
- Wiederkehrende Termine und Aufgaben
- Erinnerungen per Benachrichtigung
