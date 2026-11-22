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

## Apple-Kalender (über einen Kurzbefehl)

Ein Kurzbefehl auf dem iPhone liest die Termine von heute bis 14 Tage voraus und schickt sie an die Datenbankfunktion `import_calendar`. In Tagesplan erscheinen sie rot markiert und nur lesbar. Ein öffentlicher Kalender-Link oder ein Apple-Passwort ist dafür nicht nötig.

1. Im Supabase-Dashboard unter **SQL Editor** den Inhalt von [`supabase/kalender.sql`](supabase/kalender.sql) ausführen.
2. In Tagesplan: **„…“ → Apple-Kalender → Kurzbefehl einrichten**. Die Anleitung dort führt Schritt für Schritt durch den Kurzbefehl und hat Kopier-Buttons für URL, Schlüssel und `apikey`.

Funktionsweise:

- Der Kurzbefehl sendet eine Zeile pro Termin: `Startdatum | Enddatum | Ist ganztägig | Kalender | Ort | Titel` (Daten im Format ISO 8601).
- Er weist sich mit einem eigenen Schlüssel aus, den die App erzeugt. In der Datenbank liegt nur dessen SHA-256-Hash. Ein neuer Schlüssel oder „Verbindung trennen“ macht den alten sofort ungültig.
- Jeder Lauf ersetzt alle Termine ab heute. Vergangene Termine bleiben 60 Tage zum Zurückblättern erhalten.

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
| `supabase/kalender.sql` | Tabellen und Funktionen für Termine aus dem Apple-Kalender |
| `sw.js` | Service Worker für Offline-Betrieb (Netzwerk zuerst, sonst Cache) |

Veröffentlicht wird über GitHub Pages direkt aus dem Branch `main`.

## Ideen für später

- Wiederkehrende Termine und Aufgaben
- Erinnerungen per Benachrichtigung
