import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;

// ---------- Aufgaben-Generator ----------
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rnd(0, arr.length - 1)];

function makeProblem(difficulty) {
  let a, b;
  switch (difficulty) {
    case "easy": {
      const op = pick(["+", "+", "-", "×"]);
      if (op === "+") { a = rnd(1, 50); b = rnd(1, 50); return { text: `${a} + ${b}`, answer: a + b }; }
      if (op === "-") { a = rnd(5, 60); b = rnd(1, a); return { text: `${a} − ${b}`, answer: a - b }; }
      a = rnd(2, 10); b = rnd(2, 10); return { text: `${a} × ${b}`, answer: a * b };
    }
    case "hard": {
      const op = pick(["+", "-", "×", "×", "÷", "²"]);
      if (op === "+") { a = rnd(100, 999); b = rnd(100, 999); return { text: `${a} + ${b}`, answer: a + b }; }
      if (op === "-") { a = rnd(200, 999); b = rnd(100, a); return { text: `${a} − ${b}`, answer: a - b }; }
      if (op === "×") {
        if (Math.random() < 0.5) { a = rnd(11, 99); b = rnd(3, 9); }
        else { a = rnd(11, 25); b = rnd(11, 25); }
        return { text: `${a} × ${b}`, answer: a * b };
      }
      if (op === "÷") { b = rnd(3, 12); const q = rnd(11, 60); return { text: `${b * q} ÷ ${b}`, answer: q }; }
      a = rnd(11, 30); return { text: `${a}²`, answer: a * a };
    }
    default: { // medium
      const op = pick(["+", "-", "×", "×", "÷"]);
      if (op === "+") { a = rnd(10, 200); b = rnd(10, 200); return { text: `${a} + ${b}`, answer: a + b }; }
      if (op === "-") { a = rnd(50, 250); b = rnd(10, a); return { text: `${a} − ${b}`, answer: a - b }; }
      if (op === "×") { a = rnd(2, 12); b = rnd(2, 20); return { text: `${a} × ${b}`, answer: a * b }; }
      b = rnd(2, 12); const q = rnd(2, 20); return { text: `${b * q} ÷ ${b}`, answer: q };
    }
  }
}

function makeProblems(difficulty, count) {
  const out = [];
  let lastText = "";
  while (out.length < count) {
    const p = makeProblem(difficulty);
    if (p.text === lastText) continue;
    lastText = p.text;
    out.push(p);
  }
  return out;
}

// ---------- Räume ----------
const rooms = new Map();
const COLORS = ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#c77dff", "#ff9f43", "#48dbfb", "#f368e0"];
const BOT_NAMES = ["Gauss-Bot", "Euler-Bot", "Noether-Bot", "Turing-Bot", "Hypatia-Bot", "Ramanujan-Bot"];
const COUNTDOWN_SEC = 3;
const GRACE_AFTER_FIRST_FINISH_MS = 60_000;
const MAX_RACE_MS = 4 * 60_000;

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do { code = Array.from({ length: 4 }, () => chars[rnd(0, chars.length - 1)]).join(""); }
  while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: roomCode(),
    phase: "lobby",
    difficulty: "medium",
    count: 20,
    players: new Map(), // id -> player
    problems: [],
    startedAt: 0,
    firstFinishAt: 0,
    timers: [],
    nextId: 1,
  };
  rooms.set(room.code, room);
  return room;
}

function newPlayer(room, name, ws, isBot = false) {
  const id = String(room.nextId++);
  const usedColors = new Set([...room.players.values()].map((p) => p.color));
  const color = COLORS.find((c) => !usedColors.has(c)) || pick(COLORS);
  const player = {
    id, name, ws, isBot, color,
    progress: 0, errors: 0, finishedAt: 0, botTimer: null, lastAnswerAt: 0,
  };
  room.players.set(id, player);
  return player;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  for (const p of room.players.values()) if (!p.isBot) send(p.ws, msg);
}

function hostOf(room) {
  for (const p of room.players.values()) if (!p.isBot) return p;
  return null;
}

function publicState(room) {
  const host = hostOf(room);
  const elapsed = room.startedAt ? Date.now() - room.startedAt : 0;
  return {
    type: "state",
    code: room.code,
    phase: room.phase,
    difficulty: room.difficulty,
    count: room.count,
    hostId: host?.id ?? null,
    elapsed,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, isBot: p.isBot,
      progress: p.progress, errors: p.errors,
      finishedMs: p.finishedAt ? p.finishedAt - room.startedAt : 0,
    })),
  };
}

function pushState(room) { broadcast(room, publicState(room)); }

function clearTimers(room) {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
  for (const p of room.players.values()) if (p.botTimer) { clearInterval(p.botTimer); p.botTimer = null; }
}

function sendProblem(room, player) {
  if (player.isBot) return;
  const idx = player.progress;
  if (idx >= room.problems.length) return;
  send(player.ws, { type: "problem", index: idx, total: room.problems.length, text: room.problems[idx].text });
}

function startCountdown(room) {
  if (room.phase !== "lobby" && room.phase !== "results") return;
  clearTimers(room);
  room.phase = "countdown";
  room.startedAt = 0;
  room.problems = makeProblems(room.difficulty, room.count);
  for (const p of room.players.values()) { p.progress = 0; p.errors = 0; p.finishedAt = 0; }
  pushState(room);
  let n = COUNTDOWN_SEC;
  const tick = () => {
    if (n > 0) {
      broadcast(room, { type: "countdown", n });
      n--;
      room.timers.push(setTimeout(tick, 1000));
    } else {
      startRace(room);
    }
  };
  tick();
}

function startRace(room) {
  room.phase = "racing";
  room.startedAt = Date.now();
  room.firstFinishAt = 0;
  broadcast(room, { type: "go" });
  pushState(room);
  for (const p of room.players.values()) {
    if (p.isBot) startBot(room, p); else sendProblem(room, p);
  }
  room.timers.push(setTimeout(() => finishRace(room), MAX_RACE_MS));
}

function startBot(room, bot) {
  const speed = { easy: 2200, medium: 3500, hard: 6000 }[room.difficulty] || 3500;
  const step = () => {
    if (room.phase !== "racing" || bot.finishedAt) return;
    if (Math.random() < 0.12) { bot.errors++; }
    else { bot.progress++; }
    if (bot.progress >= room.problems.length) { bot.finishedAt = Date.now(); onPlayerFinished(room, bot); }
    pushState(room);
    if (!bot.finishedAt) bot.botTimer = setTimeout(step, speed * (0.5 + Math.random()));
  };
  bot.botTimer = setTimeout(step, speed * (0.5 + Math.random()));
}

function onPlayerFinished(room, player) {
  broadcast(room, { type: "finished", id: player.id, ms: player.finishedAt - room.startedAt });
  const all = [...room.players.values()].every((p) => p.finishedAt);
  if (all) { finishRace(room); return; }
  if (!room.firstFinishAt) {
    room.firstFinishAt = Date.now();
    room.timers.push(setTimeout(() => finishRace(room), GRACE_AFTER_FIRST_FINISH_MS));
  }
}

function finishRace(room) {
  if (room.phase !== "racing") return;
  clearTimers(room);
  room.phase = "results";
  const now = Date.now();
  const results = [...room.players.values()].map((p) => {
    const ms = p.finishedAt ? p.finishedAt - room.startedAt : now - room.startedAt;
    const minutes = ms / 60000;
    return {
      id: p.id, name: p.name, color: p.color, isBot: p.isBot,
      finished: Boolean(p.finishedAt), ms, progress: p.progress, errors: p.errors,
      ppm: minutes > 0 ? Math.round((p.progress / minutes) * 10) / 10 : 0,
      accuracy: p.progress + p.errors > 0 ? Math.round((p.progress / (p.progress + p.errors)) * 100) : 100,
    };
  });
  results.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.ms - b.ms;
    return b.progress - a.progress;
  });
  broadcast(room, { type: "results", results, total: room.problems.length });
  pushState(room);
}

function handleAnswer(room, player, value) {
  if (room.phase !== "racing" || player.finishedAt) return;
  const problem = room.problems[player.progress];
  if (!problem) return;
  const num = Number(String(value).trim().replace(",", "."));
  if (Number.isFinite(num) && num === problem.answer) {
    player.progress++;
    send(player.ws, { type: "correct", index: player.progress - 1 });
    if (player.progress >= room.problems.length) {
      player.finishedAt = Date.now();
      onPlayerFinished(room, player);
    } else {
      sendProblem(room, player);
    }
  } else {
    player.errors++;
    send(player.ws, { type: "wrong" });
  }
  pushState(room);
}

function leaveRoom(room, player) {
  if (player.botTimer) clearTimeout(player.botTimer);
  room.players.delete(player.id);
  const humans = [...room.players.values()].filter((p) => !p.isBot);
  if (humans.length === 0) { clearTimers(room); rooms.delete(room.code); return; }
  if (room.phase === "racing") {
    const all = [...room.players.values()].every((p) => p.finishedAt);
    if (all) finishRace(room);
  }
  pushState(room);
}

// ---------- HTTP (statische Dateien) ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let room = null;
  let player = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      if (player) return;
      const name = String(msg.name || "").trim().slice(0, 16) || "Anonym";
      const code = String(msg.room || "").trim().toUpperCase();
      room = code ? rooms.get(code) : null;
      if (code && !room) { send(ws, { type: "error", message: `Raum ${code} existiert nicht.` }); return; }
      if (!room) room = createRoom();
      if (room.players.size >= 8) { send(ws, { type: "error", message: "Raum ist voll (max. 8)." }); room = null; return; }
      player = newPlayer(room, name, ws);
      send(ws, { type: "joined", code: room.code, you: player.id });
      if (room.phase === "racing") sendProblem(room, player); // Nachzügler fahren mit
      pushState(room);
      return;
    }

    if (!room || !player) return;
    const isHost = hostOf(room)?.id === player.id;

    switch (msg.type) {
      case "settings":
        if (!isHost || room.phase === "racing" || room.phase === "countdown") return;
        if (["easy", "medium", "hard"].includes(msg.difficulty)) room.difficulty = msg.difficulty;
        if ([10, 20, 30, 50].includes(Number(msg.count))) room.count = Number(msg.count);
        pushState(room);
        break;
      case "start":
        if (!isHost) return;
        startCountdown(room);
        break;
      case "add_bot": {
        if (!isHost || room.phase === "racing" || room.phase === "countdown") return;
        if (room.players.size >= 8) return;
        const used = new Set([...room.players.values()].map((p) => p.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${room.players.size}`;
        newPlayer(room, name, null, true);
        pushState(room);
        break;
      }
      case "remove_bots":
        if (!isHost || room.phase === "racing" || room.phase === "countdown") return;
        for (const p of [...room.players.values()]) if (p.isBot) room.players.delete(p.id);
        pushState(room);
        break;
      case "answer":
        handleAnswer(room, player, msg.value);
        break;
      case "to_lobby":
        if (!isHost || room.phase !== "results") return;
        room.phase = "lobby";
        pushState(room);
        break;
    }
  });

  ws.on("close", () => { if (room && player) leaveRoom(room, player); });
});

server.listen(PORT, () => {
  console.log(`MathRacer läuft auf http://localhost:${PORT}`);
});
