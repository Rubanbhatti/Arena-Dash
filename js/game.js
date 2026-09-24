import { createBoard, newAttemptId, nameKey } from "./board.js";

/* ============================================================
   Config
   ============================================================ */
const CFG = Object.assign({
  eventName: "Arena Dash",
  eventSubtitle: "",
  enabled: true,
  roundSeconds: 60,
  maxAttemptsPerName: 0,
  nameLabel: "Your name",
  points: {}
}, window.ARENA_CONFIG || {});
const PTS = Object.assign({ coin: 10, gem: 40, hitPenalty: 10 }, CFG.points);
const board = createBoard(CFG);
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem("arenaDash." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("arenaDash." + k, JSON.stringify(v)); } catch {} }
};

/* ============================================================
   Arena layout (13 x 18). '#' = barrier, '.' = floor.
   Fully connected, no dead ends.
   ============================================================ */
const MAP = [
  "#############",
  "#.....#.....#",
  "#.##.....##.#",
  "#.#..#.#..#.#",
  "#...##.##...#",
  "##.#.....#.##",
  "#..#.###.#..#",
  "#...........#",
  "#.##.#.#.##.#",
  "#....#.#....#",
  "#.##.....##.#",
  "#..#.###.#..#",
  "##.#.....#.##",
  "#...##.##...#",
  "#.#..#.#..#.#",
  "#.##.....##.#",
  "#.....#.....#",
  "#############"
];
const COLS = MAP[0].length, ROWS = MAP.length;
const open = (x, y) => y >= 0 && y < ROWS && x >= 0 && x < COLS && MAP[y][x] === ".";
const FLOOR = [];
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (open(x, y)) FLOOR.push({ x, y });

const START = { x: 6, y: 7 };
const SPAWNS = [{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 1, y: 16 }, { x: 11, y: 16 }, { x: 6, y: 12 }, { x: 6, y: 3 }];
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const DIR_LIST = Object.values(DIRS);

const TUNE = {
  playerSpeed: 5.6,     // tiles per second
  boostSpeed: 8.6,
  boostTime: 4,
  hazardStart: 3.0,
  hazardEnd: 4.4,
  chase: 0.35,          // chance a spinner steers toward you at a junction
  coins: 14,
  stun: 0.8,
  invuln: 1.8,
  gemEvery: [8, 13], gemLife: 6,
  boltEvery: [14, 20], boltLife: 7,
  extraSpinners: [0.33, 0.66] // fractions of the round when a new spinner joins
};

/* ============================================================
   Sound (tiny synth, no files needed)
   ============================================================ */
const Sound = (() => {
  let ctx = null;
  let muted = store.get("muted", false);
  function unlock() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (ctx.state === "suspended") ctx.resume();
  }
  function tone(freq, dur = .08, type = "square", vol = .05, slide = 0, delay = 0) {
    if (muted || !ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + .03);
  }
  return {
    unlock,
    get muted() { return muted; },
    toggle() { muted = !muted; store.set("muted", muted); return muted; },
    coin() { tone(988, .06, "square", .04); tone(1318, .08, "square", .04, 0, .05); },
    gem() { tone(660, .1, "triangle", .08); tone(990, .1, "triangle", .08, 0, .08); tone(1320, .14, "triangle", .07, 0, .16); },
    bolt() { tone(260, .35, "sawtooth", .05, 3.2); },
    hit() { tone(220, .3, "sawtooth", .08, .35); },
    tick() { tone(520, .07, "square", .04); },
    go() { tone(1046, .25, "square", .06); },
    count() { tone(523, .15, "square", .05); },
    end() { tone(784, .15, "square", .06); tone(622, .15, "square", .06, 0, .15); tone(523, .35, "square", .06, 0, .3); }
  };
})();

const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* ============================================================
   Screens + branding
   ============================================================ */
let boardUnsub = null;
function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  if (id !== "screen-board" && boardUnsub) { boardUnsub(); boardUnsub = null; }
}

(function brand() {
  document.title = CFG.eventName;
  const t = $("title");
  t.textContent = "";
  CFG.eventName.split(/\s+/).forEach((w, i) => { if (i) t.append(document.createElement("br")); t.append(w); });
  $("subtitle").textContent = CFG.eventSubtitle || "";
  $("name-label").textContent = CFG.nameLabel;
  document.querySelectorAll("[data-pts]").forEach(el => { el.textContent = PTS[el.dataset.pts]; });
  $("hud-time").textContent = CFG.roundSeconds;
  $("name").value = store.get("name", "");
  if (board.mode === "local") {
    const n = $("mode-note");
    n.textContent = "Test mode: scores are saved on this device only. Add your Firebase settings to config.js to share the leaderboard.";
    n.classList.add("warn");
  }
  updateMuteIcon();
})();

if (!CFG.enabled) show("screen-closed");
else board.isOpen().then(ok => { if (!ok) show("screen-closed"); }).catch(() => {});

/* ============================================================
   Game state
   ============================================================ */
const cv = $("cv");
const ctx = cv.getContext("2d");
let T = 24;                 // tile size in CSS pixels
let dpr = 1;
let staticLayer = null;     // pre-rendered floor + barriers

let G = null;               // current round
let phase = "idle";         // idle | count | play | paused | over
let lastFrame = 0;
let playerName = "";
let lastResult = null;
let wakeLock = null;

function mover(x, y) { return { x, y, dir: null, next: null, t: 0, moving: false }; }
function posOf(m) { return m.moving ? { x: m.x + m.dir.x * m.t, y: m.y + m.dir.y * m.t } : { x: m.x, y: m.y }; }
const rand = (a, b) => a + Math.random() * (b - a);

function newRound() {
  G = {
    attemptId: newAttemptId(),
    time: CFG.roundSeconds,
    elapsed: 0,
    score: 0, coins: 0, gems: 0, hits: 0,
    player: mover(START.x, START.y),
    stun: 0, invuln: 0, boost: 0,
    hazards: [],
    extraAdded: 0,
    items: [],
    gem: null, bolt: null,
    nextGem: rand(...TUNE.gemEvery),
    nextBolt: rand(...TUNE.boltEvery),
    popups: [],
    shake: 0,
    lastWhole: CFG.roundSeconds
  };
  [SPAWNS[0], SPAWNS[1], SPAWNS[3]].forEach(s => G.hazards.push(Object.assign(mover(s.x, s.y), { spin: Math.random() * 6 })));
  for (let i = 0; i < TUNE.coins; i++) G.items.push(freeTile());
  updateHud();
}

function occupied(x, y) {
  return G.items.some(c => c.x === x && c.y === y) ||
    (G.gem && G.gem.x === x && G.gem.y === y) ||
    (G.bolt && G.bolt.x === x && G.bolt.y === y);
}
function freeTile() {
  const p = posOf(G.player);
  for (let tries = 0; tries < 60; tries++) {
    const c = FLOOR[(Math.random() * FLOOR.length) | 0];
    if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) < 3) continue;
    if (occupied(c.x, c.y)) continue;
    return { x: c.x, y: c.y };
  }
  return { ...FLOOR[(Math.random() * FLOOR.length) | 0] };
}

/* ---------- Movement (tile-to-tile, smooth) ---------- */
function stepMover(m, speed, dt, choose) {
  let rem = speed * dt;
  for (let guard = 0; rem > 1e-6 && guard < 8; guard++) {
    if (m.moving) {
      const s = Math.min(rem, 1 - m.t);
      m.t += s; rem -= s;
      if (m.t >= 1 - 1e-6) { m.x += m.dir.x; m.y += m.dir.y; m.t = 0; m.moving = false; }
    } else {
      choose(m);
      if (m.dir && open(m.x + m.dir.x, m.y + m.dir.y)) m.moving = true;
      else break;
    }
  }
}

function choosePlayer(m) {
  if (m.next && open(m.x + m.next.x, m.y + m.next.y)) m.dir = m.next;
}

function chooseHazard(h) {
  const p = posOf(G.player);
  let opts = DIR_LIST.filter(d => open(h.x + d.x, h.y + d.y) && !(h.dir && d.x === -h.dir.x && d.y === -h.dir.y));
  if (!opts.length) opts = DIR_LIST.filter(d => open(h.x + d.x, h.y + d.y));
  if (Math.random() < TUNE.chase) {
    opts.sort((a, b) => dist2(h.x + a.x, h.y + a.y, p) - dist2(h.x + b.x, h.y + b.y, p));
    h.dir = opts[0];
  } else {
    h.dir = opts[(Math.random() * opts.length) | 0];
  }
}
const dist2 = (x, y, p) => (x - p.x) ** 2 + (y - p.y) ** 2;

function steer(name) {
  if (phase !== "play" && phase !== "count") return;
  const d = DIRS[name];
  const m = G.player;
  m.next = d;
  if (!m.moving) return;
  // Reverse instantly mid-corridor
  if (d.x === -m.dir.x && d.y === -m.dir.y) {
    m.x += m.dir.x; m.y += m.dir.y; m.t = 1 - m.t; m.dir = d;
    return;
  }
  // Forgiving turns: if you only just left a junction, turn from it
  if (m.t < .22 && (d.x !== m.dir.x || d.y !== m.dir.y) && open(m.x + d.x, m.y + d.y)) {
    m.t = 0; m.moving = false; m.dir = d;
  }
}

/* ---------- Round update ---------- */
function update(dt) {
  G.elapsed += dt;
  G.time = Math.max(0, CFG.roundSeconds - G.elapsed);

  // countdown ticks in the last 5 seconds
  const whole = Math.ceil(G.time);
  if (whole !== G.lastWhole) {
    G.lastWhole = whole;
    if (whole <= 5 && whole > 0) Sound.tick();
  }

  // Player
  G.invuln = Math.max(0, G.invuln - dt);
  G.boost = Math.max(0, G.boost - dt);
  if (G.stun > 0) G.stun = Math.max(0, G.stun - dt);
  else stepMover(G.player, G.boost > 0 ? TUNE.boostSpeed : TUNE.playerSpeed, dt, choosePlayer);

  // Spinners join as the round goes on
  const frac = G.elapsed / CFG.roundSeconds;
  if (G.extraAdded < TUNE.extraSpinners.length && frac >= TUNE.extraSpinners[G.extraAdded]) {
    G.extraAdded++;
    const p = posOf(G.player);
    const s = SPAWNS.slice().sort((a, b) => dist2(b.x, b.y, p) - dist2(a.x, a.y, p))[0];
    G.hazards.push(Object.assign(mover(s.x, s.y), { spin: 0 }));
  }
  const hs = TUNE.hazardStart + (TUNE.hazardEnd - TUNE.hazardStart) * frac;
  G.hazards.forEach(h => { stepMover(h, hs, dt, chooseHazard); h.spin += dt * 6; });

  const p = posOf(G.player);

  // Tokens
  for (let i = 0; i < G.items.length; i++) {
    const c = G.items[i];
    if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) < .5) {
      G.score += PTS.coin; G.coins++;
      popup(c.x, c.y, "+" + PTS.coin, "#FFC928");
      Sound.coin();
      G.items[i] = freeTile();
    }
  }

  // Gem
  G.nextGem -= dt;
  if (!G.gem && G.nextGem <= 0) { G.gem = Object.assign(freeTile(), { life: TUNE.gemLife }); }
  if (G.gem) {
    G.gem.life -= dt;
    if (Math.abs(G.gem.x - p.x) + Math.abs(G.gem.y - p.y) < .5) {
      G.score += PTS.gem; G.gems++;
      popup(G.gem.x, G.gem.y, "+" + PTS.gem, "#43E6FF");
      Sound.gem(); buzz(30);
      G.gem = null; G.nextGem = rand(...TUNE.gemEvery);
    } else if (G.gem.life <= 0) { G.gem = null; G.nextGem = rand(...TUNE.gemEvery); }
  }

  // Speed bolt
  G.nextBolt -= dt;
  if (!G.bolt && G.nextBolt <= 0) { G.bolt = Object.assign(freeTile(), { life: TUNE.boltLife }); }
  if (G.bolt) {
    G.bolt.life -= dt;
    if (Math.abs(G.bolt.x - p.x) + Math.abs(G.bolt.y - p.y) < .5) {
      G.boost = TUNE.boostTime;
      popup(G.bolt.x, G.bolt.y, "Boost", "#7CFF6B");
      Sound.bolt();
      G.bolt = null; G.nextBolt = rand(...TUNE.boltEvery);
    } else if (G.bolt.life <= 0) { G.bolt = null; G.nextBolt = rand(...TUNE.boltEvery); }
  }

  // Spinner contact
  if (G.invuln <= 0) {
    for (const h of G.hazards) {
      const q = posOf(h);
      if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < .62 * .62) {
        G.score = Math.max(0, G.score - PTS.hitPenalty);
        G.hits++;
        G.stun = TUNE.stun; G.invuln = TUNE.invuln; G.boost = 0;
        popup(p.x, p.y, "−" + PTS.hitPenalty, "#FF3D7F");
        Sound.hit(); buzz(140);
        if (!reducedMotion) G.shake = .25;
        break;
      }
    }
  }

  G.shake = Math.max(0, G.shake - dt);
  G.popups.forEach(pp => { pp.life -= dt; pp.y -= dt * 1.2; });
  G.popups = G.popups.filter(pp => pp.life > 0);

  updateHud();
  if (G.time <= 0) endRound();
}

function popup(x, y, text, color) { G.popups.push({ x, y, text, color, life: .8 }); }

let hudScore = -1, hudTime = -1;
function updateHud() {
  if (G.score !== hudScore) { hudScore = G.score; $("hud-score").textContent = G.score; }
  const t = Math.ceil(G.time);
  if (t !== hudTime) {
    hudTime = t;
    $("hud-time").textContent = t;
    $("hud-time-wrap").classList.toggle("low", t <= 10);
  }
}

/* ============================================================
   Rendering
   ============================================================ */
function resize() {
  const stage = $("stage");
  const w = stage.clientWidth - 16, h = stage.clientHeight - 16;
  if (w <= 0 || h <= 0) return;
  T = Math.max(10, Math.floor(Math.min(w / COLS, h / ROWS)));
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.style.width = T * COLS + "px";
  cv.style.height = T * ROWS + "px";
  cv.width = Math.round(T * COLS * dpr);
  cv.height = Math.round(T * ROWS * dpr);
  buildStatic();
  draw();
}

function buildStatic() {
  staticLayer = document.createElement("canvas");
  staticLayer.width = cv.width; staticLayer.height = cv.height;
  const c = staticLayer.getContext("2d");
  c.scale(dpr, dpr);
  const W = COLS * T, H = ROWS * T;

  // Court floor planks
  for (let x = 0; x < COLS; x++) {
    c.fillStyle = x % 2 ? "#1D3BA6" : "#2346C0";
    c.fillRect(x * T, 0, T, H);
  }
  // Court markings
  c.strokeStyle = "rgba(245,247,255,.22)";
  c.lineWidth = Math.max(1.5, T * .07);
  c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
  c.beginPath(); c.arc(W / 2, H / 2, T * 2.1, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(W / 2, 0, T * 3.4, 0, Math.PI); c.stroke();
  c.beginPath(); c.arc(W / 2, H, T * 3.4, Math.PI, 0); c.stroke();

  // Barriers with yellow padding strips on the sides that face the floor
  const edge = Math.max(2, Math.round(T * .1));
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (open(x, y)) continue;
    const px = x * T, py = y * T;
    c.fillStyle = "#0E1A5C";
    c.fillRect(px, py, T, T);
    c.fillStyle = "#FFC928";
    if (open(x, y - 1)) c.fillRect(px, py, T, edge);
    if (open(x, y + 1)) c.fillRect(px, py + T - edge, T, edge);
    if (open(x - 1, y)) c.fillRect(px, py, edge, T);
    if (open(x + 1, y)) c.fillRect(px + T - edge, py, edge, T);
  }
}

function draw(now = performance.now()) {
  if (!staticLayer) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(staticLayer, 0, 0);
  if (!G) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (G.shake > 0) ctx.translate((Math.random() - .5) * T * .3, (Math.random() - .5) * T * .3);
  const cx = x => (x + .5) * T, cy = y => (y + .5) * T;
  const time = now / 1000;

  // Tokens
  for (const c of G.items) {
    const bob = reducedMotion ? 0 : Math.sin(time * 4 + c.x + c.y) * T * .04;
    ctx.fillStyle = "#FFC928";
    ctx.beginPath(); ctx.arc(cx(c.x), cy(c.y) + bob, T * .2, 0, 7); ctx.fill();
    ctx.strokeStyle = "#D9A300"; ctx.lineWidth = T * .06;
    ctx.beginPath(); ctx.arc(cx(c.x), cy(c.y) + bob, T * .12, 0, 7); ctx.stroke();
  }

  // Gem
  if (G.gem && (G.gem.life > 2 || Math.floor(time * 8) % 2)) {
    const x = cx(G.gem.x), y = cy(G.gem.y), r = T * .3;
    ctx.fillStyle = "#43E6FF";
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * .45, y - r * .1); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
  }

  // Speed bolt
  if (G.bolt && (G.bolt.life > 2 || Math.floor(time * 8) % 2)) {
    const x = cx(G.bolt.x) - T * .5, y = cy(G.bolt.y) - T * .5, s = T;
    ctx.fillStyle = "#7CFF6B";
    ctx.beginPath();
    [[.58, .12], [.26, .56], [.47, .56], [.4, .88], [.76, .42], [.54, .42]].forEach(([a, b], i) =>
      i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s));
    ctx.closePath(); ctx.fill();
  }

  // Spinners
  for (const h of G.hazards) {
    const q = posOf(h);
    drawSpinner(cx(q.x), cy(q.y), T * .38, h.spin);
  }

  // Player
  const p = posOf(G.player);
  const blink = G.invuln > 0 && G.stun <= 0 && Math.floor(time * 12) % 2;
  if (!blink) {
    const x = cx(p.x), y = cy(p.y), r = T * .36;
    if (G.boost > 0) {
      ctx.strokeStyle = "#7CFF6B"; ctx.lineWidth = T * .08;
      ctx.beginPath(); ctx.arc(x, y, r + T * .1, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = G.stun > 0 ? "#9AA6D6" : "#F5F7FF";
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "#FFC928"; ctx.lineWidth = T * .08;
    ctx.beginPath(); ctx.arc(x, y, r - T * .04, 0, 7); ctx.stroke();
    const d = G.player.dir || DIRS.down;
    ctx.fillStyle = "#0A1440";
    ctx.beginPath(); ctx.arc(x + d.x * r * .42, y + d.y * r * .42, T * .09, 0, 7); ctx.fill();
    if (G.stun > 0) {
      ctx.fillStyle = "#FFC928";
      for (let i = 0; i < 3; i++) {
        const a = time * 6 + i * 2.1;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y - r * .9 + Math.sin(a) * r * .3, T * .06, 0, 7); ctx.fill();
      }
    }
  }

  // Score pop-ups
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `${Math.round(T * .5)}px Bungee, Impact, sans-serif`;
  for (const pp of G.popups) {
    ctx.globalAlpha = Math.min(1, pp.life / .4);
    ctx.fillStyle = "#0A1440"; ctx.fillText(pp.text, cx(pp.x) + 2, cy(pp.y) + 2);
    ctx.fillStyle = pp.color; ctx.fillText(pp.text, cx(pp.x), cy(pp.y));
  }
  ctx.globalAlpha = 1;
}

function drawSpinner(x, y, r, a) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = "#FF3D7F";
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const rr = i % 2 ? r * .55 : r;
    const ang = (i / 16) * Math.PI * 2;
    i ? ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr) : ctx.moveTo(rr, 0);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#0A1440";
  ctx.beginPath(); ctx.arc(0, 0, r * .28, 0, 7); ctx.fill();
  ctx.restore();
}

/* ============================================================
   Loop
   ============================================================ */
function frame(now) {
  const dt = Math.min(.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;
  if (phase === "play") update(dt);
  else if (phase === "count" && G) G.hazards.forEach(h => { h.spin += dt * 3; });
  draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(t => { lastFrame = t; requestAnimationFrame(frame); });

/* ============================================================
   Flow: start → countdown → play → result
   ============================================================ */
$("start-form").addEventListener("submit", e => {
  e.preventDefault();
  startFromForm();
});

function startFromForm() {
  const name = $("name").value.replace(/\s+/g, " ").trim();
  const err = $("start-error");
  if (!name) { err.textContent = "Enter a name to start."; $("name").focus(); return; }
  if (name.length > 16) { err.textContent = "Keep your name to 16 characters."; return; }
  if (CFG.maxAttemptsPerName > 0) {
    const used = store.get("attempts", {})[nameKey(name)] || 0;
    if (used >= CFG.maxAttemptsPerName) {
      err.textContent = `You've used all ${CFG.maxAttemptsPerName} attempts for this name.`;
      return;
    }
  }
  err.textContent = "";
  playerName = name;
  store.set("name", name);
  $("name").blur();
  Sound.unlock();
  goFullscreen();
  startRound();
}

function startRound() {
  if (CFG.maxAttemptsPerName > 0) {
    const a = store.get("attempts", {});
    a[nameKey(playerName)] = (a[nameKey(playerName)] || 0) + 1;
    store.set("attempts", a);
  }
  newRound();
  show("screen-game");
  requestAnimationFrame(resize);
  keepAwake(true);
  countdown();
}

function countdown() {
  phase = "count";
  const ov = $("overlay");
  const steps = ["3", "2", "1", "Go"];
  let i = 0;
  const next = () => {
    if (phase !== "count") return;
    if (i >= steps.length) { ov.classList.remove("show"); ov.innerHTML = ""; phase = "play"; return; }
    ov.innerHTML = "";
    const el = document.createElement("div");
    el.className = "count";
    el.textContent = steps[i];
    ov.append(el); ov.classList.add("show");
    steps[i] === "Go" ? Sound.go() : Sound.count();
    i++;
    setTimeout(next, i === steps.length ? 450 : 750);
  };
  next();
}

function pause() {
  if (phase !== "play") return;
  phase = "paused";
  const ov = $("overlay");
  ov.innerHTML = `<div class="paused"><h2>Paused</h2><div class="stack">
    <button class="btn primary" id="btn-resume" type="button">Resume</button>
    <button class="btn ghost" id="btn-quit" type="button">Quit round</button></div></div>`;
  ov.classList.add("show");
  $("btn-resume").onclick = resume;
  $("btn-quit").onclick = () => { ov.classList.remove("show"); phase = "idle"; keepAwake(false); show("screen-welcome"); };
  $("btn-resume").focus();
}
function resume() {
  if (phase !== "paused") return;
  const ov = $("overlay");
  ov.classList.remove("show"); ov.innerHTML = "";
  phase = "play";
}

function endRound() {
  if (phase !== "play") return;
  phase = "over";
  G.time = 0; updateHud();
  Sound.end(); buzz([80, 60, 80]);
  keepAwake(false);
  const result = {
    name: playerName, score: G.score, coins: G.coins, gems: G.gems, hits: G.hits,
    attemptId: G.attemptId
  };
  Object.freeze(result);
  setTimeout(() => showResult(result), 900);
}

function showResult(r) {
  $("over-name").textContent = r.name;
  $("over-score").textContent = r.score;
  $("st-coins").textContent = r.coins;
  $("st-gems").textContent = r.gems;
  $("st-hits").textContent = r.hits;
  const again = $("btn-again");
  const left = CFG.maxAttemptsPerName > 0
    ? CFG.maxAttemptsPerName - (store.get("attempts", {})[nameKey(r.name)] || 0) : Infinity;
  again.disabled = left <= 0;
  again.textContent = left <= 0 ? "No attempts left" : left === Infinity ? "Play again" : `Play again (${left} left)`;
  show("screen-over");
  submit(r);
}

async function submit(r) {
  const st = $("over-status");
  st.className = "status";
  st.textContent = "Saving your score…";
  const slow = setTimeout(() => {
    st.textContent = "Waiting for a connection. Keep this page open and your score will be sent.";
  }, 10000);
  try {
    const res = await board.submit(r);
    clearTimeout(slow);
    lastResult = res;
    st.className = "status ok";
    st.textContent = "";
    const head = document.createElement("div");
    head.textContent = res.improved ? "Score saved. That's your best yet." : `Score saved. Your best is still ${res.best}.`;
    st.append(head);
    if (res.rank) {
      const line = document.createElement("div");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = "#" + res.rank;
      line.append("You're ", rank, ` of ${res.total} on the leaderboard.`);
      st.append(line);
    }
  } catch (e) {
    clearTimeout(slow);
    console.error(e);
    st.className = "status bad";
    st.textContent = "";
    const msg = document.createElement("div");
    const code = e && e.code || "";
    if (code === "permission-denied") {
      msg.textContent = "The leaderboard didn't accept this score. The event may be closed, or a score was sent from this phone less than a minute ago.";
      st.append(msg);
    } else {
      msg.textContent = "Couldn't reach the leaderboard. Check your connection, then retry.";
      const btn = document.createElement("button");
      btn.className = "btn ghost"; btn.type = "button"; btn.textContent = "Retry saving";
      btn.onclick = () => submit(r);
      st.append(msg, btn);
    }
  }
}

$("btn-again").onclick = () => { Sound.unlock(); startRound(); };
$("btn-mute").onclick = () => { Sound.unlock(); Sound.toggle(); updateMuteIcon(); };
$("btn-pause").onclick = () => (phase === "paused" ? resume() : pause());

function updateMuteIcon() {
  const b = $("btn-mute");
  b.setAttribute("aria-label", Sound.muted ? "Turn sound on" : "Mute sound");
  b.style.opacity = Sound.muted ? .45 : 1;
}

document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("resize", () => { if (phase !== "idle") resize(); });
if (window.ResizeObserver) new ResizeObserver(() => { if ($("screen-game").classList.contains("active")) resize(); }).observe($("stage"));

/* ============================================================
   Leaderboard screen
   ============================================================ */
let boardBack = "screen-welcome";
function openBoard(from) {
  boardBack = from;
  show("screen-board");
  const list = $("board-rows");
  const live = $("board-live");
  list.innerHTML = `<li class="empty">Loading scores…</li>`;
  live.classList.remove("off");
  live.textContent = board.mode === "local" ? "This device only" : "Updates live";
  const myId = (lastResult && lastResult.myId) || (playerName && board.myIdFor(playerName));
  boardUnsub = board.subscribe(rows => {
    list.innerHTML = "";
    if (!rows.length) {
      list.innerHTML = `<li class="empty">No scores yet. Play a round to claim first place.</li>`;
      return;
    }
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = "row" + (i < 3 ? ` top${i + 1}` : "") + (r.id === myId ? " me" : "");
      const rk = document.createElement("span"); rk.className = "r"; rk.textContent = i + 1;
      const nm = document.createElement("span"); nm.className = "n"; nm.textContent = r.name;
      const sc = document.createElement("span"); sc.className = "s"; sc.textContent = r.score;
      li.append(rk, nm, sc);
      list.append(li);
    });
  }, err => {
    console.error(err);
    live.classList.add("off");
    live.textContent = "Offline";
    list.innerHTML = `<li class="empty">Couldn't load the leaderboard. Check your connection and open it again.</li>`;
  });
}
$("btn-board").onclick = () => openBoard("screen-welcome");
$("btn-over-board").onclick = () => openBoard("screen-over");
$("btn-closed-board").onclick = () => openBoard("screen-closed");
$("btn-board-back").onclick = () => show(boardBack);

/* ============================================================
   Controls: keyboard, swipe, d-pad
   ============================================================ */
const KEYS = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right"
};
window.addEventListener("keydown", e => {
  if (!$("screen-game").classList.contains("active")) return;
  if (KEYS[e.key]) { e.preventDefault(); steer(KEYS[e.key]); }
  else if (e.key === "p" || e.key === "P" || e.key === "Escape") { phase === "paused" ? resume() : pause(); }
});

// Swipe anywhere on the arena. Keep your finger down and swipe again to chain turns.
(function swipe() {
  const stage = $("stage");
  let sx = 0, sy = 0, active = false;
  const TH = 18;
  stage.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse") return;
    active = true; sx = e.clientX; sy = e.clientY;
  });
  stage.addEventListener("pointermove", e => {
    if (!active) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < TH) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    sx = e.clientX; sy = e.clientY;
  });
  const stop = () => { active = false; };
  stage.addEventListener("pointerup", stop);
  stage.addEventListener("pointercancel", stop);
})();

// D-pad: press, or slide your thumb between arrows without lifting it.
(function dpad() {
  const pad = $("dpad");
  let current = null;
  const set = btn => {
    if (btn === current) return;
    if (current) current.classList.remove("on");
    current = btn;
    if (btn) { btn.classList.add("on"); steer(btn.dataset.dir); }
  };
  const btnAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("#dpad button") : null;
  };
  pad.addEventListener("pointerdown", e => {
    e.preventDefault();
    Sound.unlock();
    set(btnAt(e.clientX, e.clientY));
  });
  pad.addEventListener("pointermove", e => {
    if (!current) return;
    const b = btnAt(e.clientX, e.clientY);
    if (b) set(b);
  });
  const release = () => set(null);
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
  pad.addEventListener("contextmenu", e => e.preventDefault());
})();

// Block the long-press menu and double-tap zoom during play
$("screen-game").addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("dblclick", e => e.preventDefault(), { passive: false });

/* ============================================================
   Android niceties: fullscreen, portrait lock, screen stays on
   ============================================================ */
function goFullscreen() {
  if (!matchMedia("(pointer: coarse)").matches) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement) return;
  try {
    const p = req.call(el, { navigationUI: "hide" });
    if (p && p.then) p.then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock("portrait").catch(() => {});
    }).catch(() => {});
  } catch {}
}

async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch {}
}
