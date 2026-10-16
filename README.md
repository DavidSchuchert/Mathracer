# MathRacer

Multiplayer-Kopfrechnen im Stil von typer.io: Alle im Raum bekommen dieselben Aufgaben, wer zuerst durch ist, gewinnt.

## Starten

```bash
npm install
npm start
```

Dann `http://localhost:3000` öffnen. Einen Raum erstellen (Code leer lassen), den Code oder den Link an Mitspieler schicken. Der Host wählt Schwierigkeit und Anzahl der Aufgaben und startet das Rennen. Zum Alleine-Testen gibt es Bots.

## Aufbau

- `server.js` – HTTP-Server für die statischen Dateien plus WebSocket-Spiellogik (Räume, Countdown, Aufgaben, Antwortprüfung, Bots, Ergebnisse).
- `public/` – Client (HTML, CSS, JS ohne Framework).

Antworten werden nur auf dem Server geprüft, der Client bekommt immer nur die aktuelle Aufgabe.

## Docker

```bash
docker compose up -d --build
```

Läuft danach auf Port 3000. Für `server.local` siehe `deploy.sh`.
