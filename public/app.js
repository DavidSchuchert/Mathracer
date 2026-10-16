const $ = (id) => document.getElementById(id);
const screens = { join: $("screen-join"), lobby: $("screen-lobby"), race: $("screen-race"), results: $("screen-results") };

let ws = null;
let myId = null;
let state = null;
let timerInterval = null;
let lastPhase = null;

const DIFF_HINTS = {
  easy: "Plus und Minus bis 60, kleines Einmaleins.",
  medium: "Zahlen bis 250, Einmaleins bis 12 × 20, Division.",
  hard: "Dreistellige Summen, 2-stellig × 2-stellig, Quadratzahlen.",
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

function toast(text, ms = 2200) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), ms);
}

function initials(name) {
  return name.split(/[\s-]+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
}

function fmtMs(ms) {
  return (ms / 1000).toFixed(1).replace(".", ",") + " s";
}

// ---------- Verbindung ----------
function connect(name, room) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ type: "join", name, room }));
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    if (myId) { toast("Verbindung getrennt."); show("join"); $("roomTag").hidden = true; myId = null; }
  };
}

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function handle(msg) {
  switch (msg.type) {
    case "error":
      $("joinError").textContent = msg.message; $("joinError").hidden = false;
      break;
    case "joined":
      myId = msg.you;
      $("roomCode").textContent = msg.code;
      $("roomTag").hidden = false;
      history.replaceState(null, "", `?room=${msg.code}`);
      $("joinError").hidden = true;
      break;
    case "state":
      state = msg;
      render();
      break;
    case "countdown":
      $("countdown").hidden = false;
      $("countdown").textContent = msg.n;
      $("countdown").style.animation = "none"; void $("countdown").offsetWidth; $("countdown").style.animation = "";
      break;
    case "go":
      if (state) state.elapsed = 0;
      $("countdown").hidden = true;
      $("answerInput").disabled = false;
      $("answerInput").value = "";
      $("answerInput").focus();
      startTimer();
      break;
    case "problem":
      $("question").textContent = msg.text;
      $("qIndex").textContent = `${msg.index + 1} / ${msg.total}`;
      $("answerInput").value = "";
      $("answerInput").disabled = false;
      $("answerInput").focus();
      break;
    case "correct": {
      const inp = $("answerInput");
      inp.classList.add("flash"); setTimeout(() => inp.classList.remove("flash"), 200);
      break;
    }
    case "wrong": {
      const inp = $("answerInput");
      inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake");
      inp.select();
      break;
    }
    case "finished":
      if (msg.id === myId) {
        const place = state ? state.players.filter((p) => p.finishedMs > 0).length + 1 : 1;
        $("qbox").hidden = true;
        $("doneMsg").hidden = false;
        $("doneMsg").innerHTML = `<strong>Fertig! Platz ${place}</strong>${fmtMs(msg.ms)} – warte auf die anderen …`;
        $("answerInput").disabled = true;
        stopTimer();
      } else if (state) {
        const p = state.players.find((x) => x.id === msg.id);
        if (p) toast(`${p.name} ist im Ziel (${fmtMs(msg.ms)})`);
      }
      break;
    case "results":
      renderResults(msg);
      show("results");
      stopTimer();
      break;
  }
}

// ---------- Rendering ----------
function render() {
  const s = state;
  const isHost = s.hostId === myId;
  document.body.classList.toggle("is-host", isHost);

  if (s.phase !== lastPhase) {
    if (s.phase === "lobby") show("lobby");
    if (s.phase === "countdown") {
      show("race");
      $("qbox").hidden = false; $("doneMsg").hidden = true;
      $("question").textContent = "…"; $("qIndex").textContent = `1 / ${s.count}`;
      $("answerInput").value = ""; $("answerInput").disabled = true;
      $("timer").textContent = "0,0 s";
    }
    if (s.phase === "racing" && lastPhase !== "countdown") { show("race"); $("countdown").hidden = true; startTimer(); }
    lastPhase = s.phase;
  }

  // Lobby
  $("playerCount").textContent = `(${s.players.length}/8)`;
  $("lobbyPlayers").innerHTML = s.players.map((p) => `
    <li><span class="avatar" style="background:${p.color}">${initials(p.name)}</span>
      <span>${esc(p.name)}</span>
      ${p.id === s.hostId ? '<span class="tag">Host</span>' : ""}
      ${p.isBot ? '<span class="tag">Bot</span>' : ""}
      ${p.id === myId ? '<span class="tag">Du</span>' : ""}
    </li>`).join("");
  for (const b of $("diffSeg").children) b.classList.toggle("on", b.dataset.v === s.difficulty);
  for (const b of $("countSeg").children) b.classList.toggle("on", Number(b.dataset.v) === s.count);
  $("diffSeg").setAttribute("aria-disabled", String(!isHost));
  $("countSeg").setAttribute("aria-disabled", String(!isHost));
  $("diffHint").textContent = DIFF_HINTS[s.difficulty];
  $("startBtn").disabled = s.players.length < 1;

  // Strecke
  const me = s.players.find((p) => p.id === myId);
  if (me) $("errCount").textContent = `${me.errors} Fehler`;
  $("track").innerHTML = s.players.map((p) => {
    const pct = Math.min(100, Math.round((p.progress / s.count) * 100));
    return `<div class="lane ${p.finishedMs ? "done" : ""}">
      <div class="name"><span class="avatar" style="background:${p.color}">${initials(p.name)}</span>${esc(p.name)}</div>
      <div class="bar"><div class="fill" style="width:${pct}%;background:${p.color}"></div>
        <div class="car ${p.id === myId ? "me" : ""}" style="left:${pct}%;background:${p.color}">${initials(p.name)}</div>
        <div class="finish"></div></div>
      <div class="pct">${p.finishedMs ? fmtMs(p.finishedMs) : pct + "%"}</div>
    </div>`;
  }).join("");
}

function renderResults(msg) {
  const medals = ["🥇", "🥈", "🥉"];
  $("resultsTable").querySelector("tbody").innerHTML = msg.results.map((r, i) => `
    <tr class="${i === 0 && r.finished ? "first" : ""} ${r.finished ? "" : "dnf"}">
      <td>${r.finished && medals[i] ? `<span class="medal">${medals[i]}</span>` : i + 1}</td>
      <td class="name"><span class="avatar" style="background:${r.color}">${initials(r.name)}</span>${esc(r.name)}${r.id === myId ? ' <span class="tag">Du</span>' : ""}</td>
      <td>${r.finished ? fmtMs(r.ms) : `${r.progress}/${msg.total}`}</td>
      <td>${String(r.ppm).replace(".", ",")}</td>
      <td>${r.accuracy} %</td>
      <td>${r.errors}</td>
    </tr>`).join("");
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function startTimer() {
  stopTimer();
  const t0 = Date.now() - (state?.elapsed || 0);
  timerInterval = setInterval(() => { $("timer").textContent = fmtMs(Date.now() - t0); }, 100);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// ---------- Events ----------
$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("nameInput").value.trim();
  const code = $("codeInput").value.trim().toUpperCase();
  localStorage.setItem("mr_name", name);
  connect(name, code);
});

$("diffSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  send({ type: "settings", difficulty: b.dataset.v });
});
$("countSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  send({ type: "settings", count: Number(b.dataset.v) });
});
$("addBot").addEventListener("click", () => send({ type: "add_bot" }));
$("removeBots").addEventListener("click", () => send({ type: "remove_bots" }));
$("startBtn").addEventListener("click", () => send({ type: "start" }));
$("againBtn").addEventListener("click", () => send({ type: "start" }));
$("lobbyBtn").addEventListener("click", () => send({ type: "to_lobby" }));

$("answerInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const v = $("answerInput").value.trim();
  if (!v) return;
  send({ type: "answer", value: v });
});

$("copyLink").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); toast("Link kopiert"); }
  catch { toast(location.href, 5000); }
});

// Vorbelegung
$("nameInput").value = localStorage.getItem("mr_name") || "";
const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) $("codeInput").value = urlRoom.toUpperCase();
show("join");
