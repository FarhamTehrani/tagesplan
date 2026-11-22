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

Nur im Browser des Geräts (`localStorage`), nicht auf einem Server und nicht in diesem Repo. Es gibt keine Synchronisierung zwischen Geräten. Wenn die Website-Daten gelöscht werden, sind die Einträge weg; deshalb ab und zu über „…“ → „Sicherung herunterladen“ sichern.

## Entwicklung

Kein Build-Schritt, keine Abhängigkeiten. Node.js 20+ für die Tests.

```sh
npm start      # lokaler Server auf http://localhost:4173
npm test       # Tests der Logik in lib.js
npm run icons  # PNG-Icons neu erzeugen
```

| Datei | Inhalt |
| --- | --- |
| `lib.js` | Reine Logik: Datumsrechnung, Tagesansicht, Prüfung gespeicherter Daten |
| `app.js` | Oberfläche, Speicher, Editor, Sicherung |
| `sw.js` | Service Worker für Offline-Betrieb (Netzwerk zuerst, sonst Cache) |

Veröffentlicht wird über GitHub Pages direkt aus dem Branch `main`.

## Ideen für später

- Termine aus dem iCloud-Kalender übernehmen (öffentlicher Kalender-Link, abgerufen über eine GitHub Action oder einen kleinen Proxy)
- Wiederkehrende Termine und Aufgaben
- Erinnerungen per Benachrichtigung
