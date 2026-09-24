import { createBoard, newAttemptId, nameKey } from "./board.js";
import { MAPS, buildMap } from "./maps.js";
import { Round, POWERS, badgesFor } from "./engine.js";
import { createSound } from "./audio.js";
import { createRenderer2D } from "./render2d.js";

/* ============================================================
   Config + storage
   ============================================================ */
const CFG = Object.assign({
  eventName: "Arena Dash", eventSubtitle: "", enabled: true,
  roundSeconds: 60, maxAttemptsPerName: 0, nameLabel: "Your name", points: {}
}, window.ARENA_CONFIG || {});
const PTS = Object.assign({ coin: 10, gem: 40, hitPenalty: 10 }, CFG.points);
const board = createBoard(CFG);
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem("arenaDash." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("arenaDash." + k, JSON.stringify(v)); } catch {} }
};
const Sound = createSound(store);
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

const SKINS = [
  { name: "Snow", color: "#F5F7FF" }, { name: "Lime", color: "#B8FF5C" }, { name: "Coral", color: "#FF8C6B" },
  { name: "Sky", color: "#6BD4FF" }, { name: "Violet", color: "#B58CFF" }
];
let skin = store.get("skin", SKINS[0].color);
let gfx = store.get("gfx", "3d");

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
  const t = $("title"); t.textContent = "";
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
  const wrap = $("skins");
  SKINS.forEach(s => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-label", s.name);
    b.style.background = s.color; b.dataset.color = s.color;
    b.onclick = () => { skin = s.color; store.set("skin", skin); syncPickers(); Sound.unlock(); Sound.click(); };
    wrap.append(b);
  });
  document.querySelectorAll("[data-gfx]").forEach(b => b.onclick = () => {
    gfx = b.dataset.gfx; store.set("gfx", gfx); syncPickers(); Sound.unlock(); Sound.click();
    if (gfx === "3d") { store.set("quality", "high"); import("./render3d.js").catch(() => {}); }
  });
  syncPickers();
  updateBestLine();
  $("name").addEventListener("input", updateBestLine);
  updateMuteIcon();
  if (gfx === "3d") import("./render3d.js").catch(() => {});
})();

function syncPickers() {
  document.querySelectorAll("#skins button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.color === skin)));
  document.querySelectorAll("[data-gfx]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.gfx === gfx)));
}
function updateBestLine() {
  const name = $("name").value.trim();
  const pb = name ? store.get("pb", {})[nameKey(name)] : undefined;
  const el = $("best-line");
  if (pb === undefined) { el.hidden = true; return; }
  el.hidden = false; el.textContent = "";
  const s = document.createElement("strong"); s.textContent = pb;
  el.append("Your best: ", s);
}

if (!CFG.enabled) show("screen-closed");
else board.isOpen().then(ok => { if (!ok) show("screen-closed"); }).catch(() => {});

/* ============================================================
   Renderer management (3D with automatic 2D fallback)
   ============================================================ */
const stage = $("stage");
let R = null, rKind = null, rQuality = null, currentMap = null;

async function ensureRenderer() {
  const quality = store.get("quality", "high");
  if (R && rKind === gfx && (gfx === "2d" || rQuality === quality)) { R.setSkin(skin); return; }
  if (R) { R.dispose(); R = null; }
  stage.classList.remove("is3d");
  if (gfx === "3d") {
    try {
      const mod = await import("./render3d.js");
      R = await mod.createRenderer3D(stage, { quality, skin, reducedMotion });
      rKind = "3d"; rQuality = quality; stage.classList.add("is3d");
      return;
    } catch (e) {
      console.warn("3D unavailable, using classic graphics", e);
      gfx = "2d"; syncPickers();
    }
  }
  R = createRenderer2D(stage, { skin, reducedMotion });
  rKind = "2d";
}

/* ============================================================
   Round state
   ============================================================ */
let G = null;
let phase = "idle";       // idle | loading | count | play | paused | over
let playerName = "";
let lastResult = null;
let lastShare = null;
let wakeLock = null;
let fps = { frames: 0, time: 0, checked: false };

function pickMap() {
  const last = store.get("lastMap", null);
  const pool = MAPS.filter(m => m.id !== last);
  const def = pool[(Math.random() * pool.length) | 0];
  store.set("lastMap", def.id);
  return buildMap(def);
}

/* ============================================================
   Loop
   ============================================================ */
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;
  const active = $("screen-game").classList.contains("active");
  if (phase === "play" && G) {
    G.update(dt);
    for (const e of G.drainEvents()) handleEvent(e);
    updateHud();
    watchPerformance(dt);
  }
  if (active && R && phase !== "loading") R.render(G, phase === "paused" ? 0 : dt, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// If 3D struggles on this phone, use lighter 3D settings from the next round.
function watchPerformance(dt) {
  if (fps.checked || rKind !== "3d") return;
  fps.frames++; fps.time += dt;
  if (fps.time > 4) {
    fps.checked = true;
    const rate = fps.frames / fps.time;
    if (rate < 38 && rQuality === "high") store.set("quality", "low");
  }
}

/* ============================================================
   Events → sound, haptics, pop-ups, banners
   ============================================================ */
function handleEvent(e) {
  if (R && R.onEvent) R.onEvent(e);
  switch (e.type) {
    case "token": Sound.token(G.combo.mult); popup(e.x, e.y, "+" + e.pts, e.pts > PTS.coin ? "#FFE680" : "#FFC928"); break;
    case "gem": Sound.gem(); buzz(30); popup(e.x, e.y, "+" + e.pts, "#43E6FF", true); break;
    case "power":
      e.kind === "freeze" ? Sound.freeze() : Sound.power(); buzz(40);
      showBanner({ boost: "Speed boost", shield: "Shield up", magnet: "Magnet", freeze: "Freeze" }[e.kind]);
      break;
    case "combo": Sound.combo(e.mult); showBanner("Combo ×" + e.mult); buzz(25); break;
    case "comboEnd": Sound.comboEnd(); break;
    case "hit": Sound.hit(); buzz(150); popup(e.x, e.y, "−" + e.pts, "#FF3D7F", true); break;
    case "shieldBreak": Sound.shieldBreak(); buzz(60); popup(e.x, e.y, "Blocked", "#5BA8FF"); break;
    case "spawn": Sound.spawn(); if (e.kind === "hunter") showBanner("Hunter incoming"); break;
    case "rush": Sound.rush(); Sound.musicRush(); showBanner("Final rush: 2× points"); buzz([40, 40, 40]); break;
    case "tick": Sound.tick(); break;
    case "end": endRound(); break;
  }
}

function popup(x, y, text, color, big) {
  if (!R) return;
  const p = R.project(x, y);
  const s = document.createElement("span");
  s.textContent = text; s.style.color = color;
  s.style.left = p.x + "px"; s.style.top = p.y + "px";
  if (big) s.className = "big";
  $("fx").append(s);
  setTimeout(() => s.remove(), 850);
}

let bannerTimer = null;
function showBanner(text) {
  const b = $("banner");
  b.textContent = text;
  b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove("show"), 1500);
}

/* ============================================================
   HUD
   ============================================================ */
let hudScore = -1, hudTime = -1, effectsKey = "";
function updateHud() {
  if (!G) return;
  if (G.score !== hudScore) { hudScore = G.score; $("hud-score").textContent = G.score; }
  const t = Math.ceil(G.time);
  if (t !== hudTime) { hudTime = t; $("hud-time").textContent = t; $("hud-time-wrap").classList.toggle("low", t <= 10); }

  const P = G.player, list = [];
  if (G.combo.mult > 1) list.push({ k: "combo", label: "×" + G.combo.mult, frac: G.combo.timer / 1.8, cls: "combo" });
  if (P.boost > 0) list.push({ k: "boost", label: "Speed", frac: P.boost / POWERS.boost.time, color: POWERS.boost.color });
  if (P.shield) list.push({ k: "shield", label: "Shield", frac: 1, color: POWERS.shield.color });
  if (P.magnet > 0) list.push({ k: "magnet", label: "Magnet", frac: P.magnet / POWERS.magnet.time, color: POWERS.magnet.color });
  if (G.freeze > 0) list.push({ k: "freeze", label: "Freeze", frac: G.freeze / POWERS.freeze.time, color: POWERS.freeze.color });
  if (G.rush) list.push({ k: "rush", label: "2× points", frac: 1, cls: "rush" });
  const key = list.map(i => i.k + i.label).join("|");
  const wrap = $("effects");
  if (key !== effectsKey) {
    effectsKey = key;
    wrap.innerHTML = "";
    for (const i of list) {
      const el = document.createElement("span");
      el.className = "pill " + (i.cls || ""); el.dataset.k = i.k;
      if (i.color) { el.style.color = i.color; const d = document.createElement("i"); d.className = "dot"; d.style.background = i.color; el.append(d); }
      const lab = document.createElement("span"); lab.textContent = i.label; if (!i.cls) lab.style.color = "var(--line)";
      const bar = document.createElement("i"); bar.className = "bar";
      el.append(lab, bar); wrap.append(el);
    }
  }
  for (const i of list) {
    const bar = wrap.querySelector(`[data-k="${i.k}"] .bar`);
    if (bar) bar.style.width = Math.max(0, Math.min(1, i.frac)) * 100 + "%";
  }
}

/* ============================================================
   Flow: start → countdown → play → result
   ============================================================ */
$("start-form").addEventListener("submit", e => { e.preventDefault(); startFromForm(); });

function startFromForm() {
  const name = $("name").value.replace(/\s+/g, " ").trim();
  const err = $("start-error");
  if (!name) { err.textContent = "Enter a name to start."; $("name").focus(); return; }
  if (name.length > 16) { err.textContent = "Keep your name to 16 characters."; return; }
  if (CFG.maxAttemptsPerName > 0) {
    const used = store.get("attempts", {})[nameKey(name)] || 0;
    if (used >= CFG.maxAttemptsPerName) { err.textContent = `You've used all ${CFG.maxAttemptsPerName} attempts for this name.`; return; }
  }
  err.textContent = "";
  playerName = name;
  store.set("name", name);
  $("name").blur();
  Sound.unlock();
  goFullscreen();
  startRound();
}

async function startRound() {
  if (phase === "loading") return;
  if (CFG.maxAttemptsPerName > 0) {
    const a = store.get("attempts", {});
    a[nameKey(playerName)] = (a[nameKey(playerName)] || 0) + 1;
    store.set("attempts", a);
  }
  phase = "loading";
  G = null;
  show("screen-game");
  $("effects").innerHTML = ""; effectsKey = ""; $("fx").innerHTML = "";
  $("hud-score").textContent = "0"; $("hud-time").textContent = CFG.roundSeconds; $("hud-time-wrap").classList.remove("low");
  const ov = $("overlay");
  ov.innerHTML = `<div class="count-wrap"><div class="map-name">Loading arena…</div></div>`; ov.classList.add("show");
  await new Promise(r => requestAnimationFrame(r));
  await ensureRenderer();
  currentMap = pickMap();
  G = new Round({ seconds: CFG.roundSeconds, points: PTS, map: currentMap });
  G.attemptId = newAttemptId();
  fps = { frames: 0, time: 0, checked: false };
  R.setMap(currentMap);
  R.newRound();
  R.resize();
  hudScore = -1; hudTime = -1;
  updateHud();
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
    if (i >= steps.length) {
      ov.classList.remove("show"); ov.innerHTML = ""; phase = "play";
      Sound.musicStart(false);
      return;
    }
    ov.innerHTML = "";
    const wrap = document.createElement("div"); wrap.className = "count-wrap";
    const m = document.createElement("div"); m.className = "map-name"; m.textContent = currentMap.name; wrap.append(m);
    const el = document.createElement("div"); el.className = "count"; el.textContent = steps[i];
    wrap.append(el); ov.append(wrap); ov.classList.add("show");
    steps[i] === "Go" ? Sound.go() : Sound.count();
    i++;
    setTimeout(next, i === steps.length ? 450 : 750);
  };
  next();
}

function steer(name) { if (G && (phase === "play" || phase === "count")) G.steer(name); }

function pause() {
  if (phase !== "play") return;
  phase = "paused";
  Sound.musicStop();
  const ov = $("overlay");
  ov.innerHTML = `<div class="paused"><h2>Paused</h2><div class="stack">
    <button class="btn primary" id="btn-resume" type="button">Resume</button>
    <button class="btn ghost" id="btn-quit" type="button">Quit round</button></div></div>`;
  ov.classList.add("show");
  $("btn-resume").onclick = resume;
  $("btn-quit").onclick = () => { ov.classList.remove("show"); phase = "idle"; G = null; keepAwake(false); updateBestLine(); show("screen-welcome"); };
  $("btn-resume").focus();
}
function resume() {
  if (phase !== "paused") return;
  const ov = $("overlay"); ov.classList.remove("show"); ov.innerHTML = "";
  phase = "play";
  Sound.musicStart(G && G.rush);
}

function endRound() {
  if (phase !== "play") return;
  phase = "over";
  Sound.musicStop(); Sound.end(); buzz([80, 60, 80]);
  keepAwake(false);
  updateHud();
  const res = G.result();
  const result = Object.freeze({
    name: playerName, score: res.score, coins: res.coins, gems: res.gems, hits: res.hits,
    attemptId: G.attemptId
  });
  const badges = badgesFor(res);
  setTimeout(() => showResult(result, res, badges), 1000);
}

function showResult(r, full, badges) {
  $("over-name").textContent = r.name;
  $("over-map").textContent = full.map;
  countUp($("over-score"), r.score);
  $("st-coins").textContent = r.coins;
  $("st-gems").textContent = r.gems;
  $("st-hits").textContent = r.hits;

  const ul = $("badges"); ul.innerHTML = "";
  badges.slice(0, 4).forEach(b => {
    const li = document.createElement("li");
    const m = document.createElement("span"); m.className = "medal"; m.textContent = b.name[0];
    const tx = document.createElement("span");
    const bn = document.createElement("b"); bn.textContent = b.name;
    const sm = document.createElement("small"); sm.textContent = b.desc;
    tx.append(bn, sm); li.append(m, tx); ul.append(li);
  });

  const pbs = store.get("pb", {}), k = nameKey(r.name);
  const newPb = pbs[k] === undefined || r.score > pbs[k];
  if (newPb) { pbs[k] = r.score; store.set("pb", pbs); }
  lastShare = { score: r.score, newPb };

  const again = $("btn-again");
  const left = CFG.maxAttemptsPerName > 0 ? CFG.maxAttemptsPerName - (store.get("attempts", {})[k] || 0) : Infinity;
  again.disabled = left <= 0;
  again.textContent = left <= 0 ? "No attempts left" : left === Infinity ? "Play again" : `Play again (${left} left)`;
  show("screen-over");
  submit(r);
}

function countUp(el, target) {
  if (reducedMotion || target === 0) { el.textContent = target; return; }
  const start = performance.now(), dur = Math.min(1200, 300 + target);
  const tick = now => {
    const k = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(target * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function submit(r) {
  const st = $("over-status");
  st.className = "status"; st.textContent = "Saving your score…";
  const slow = setTimeout(() => { st.textContent = "Waiting for a connection. Keep this page open and your score will be sent."; }, 10000);
  try {
    const res = await board.submit(r);
    clearTimeout(slow);
    lastResult = res;
    st.className = "status ok"; st.textContent = "";
    const head = document.createElement("div");
    head.textContent = res.improved ? "Score saved. That's your best yet." : `Score saved. Your best is still ${res.best}.`;
    st.append(head);
    if (res.rank) {
      const line = document.createElement("div");
      const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = "#" + res.rank;
      line.append("You're ", rank, ` of ${res.total} on the leaderboard.`);
      st.append(line);
      if (lastShare) lastShare.rank = res.rank;
    }
  } catch (e) {
    clearTimeout(slow);
    console.error(e);
    st.className = "status bad"; st.textContent = "";
    const msg = document.createElement("div");
    if (e && e.code === "permission-denied") {
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

$("btn-share").onclick = async () => {
  if (!lastShare) return;
  const text = `I scored ${lastShare.score}${lastShare.rank ? ` (#${lastShare.rank})` : ""} in ${CFG.eventName}. Can you beat it?`;
  const url = location.href.split("#")[0];
  try {
    if (navigator.share) await navigator.share({ title: CFG.eventName, text, url });
    else {
      await navigator.clipboard.writeText(text + " " + url);
      $("btn-share").textContent = "Copied";
      setTimeout(() => { $("btn-share").textContent = "Share score"; }, 1500);
    }
  } catch {}
};

$("btn-again").onclick = () => { Sound.unlock(); startRound(); };
$("btn-mute").onclick = () => { Sound.unlock(); Sound.toggle(); updateMuteIcon(); };
$("btn-pause").onclick = () => (phase === "paused" ? resume() : pause());
function updateMuteIcon() {
  const b = $("btn-mute");
  b.setAttribute("aria-label", Sound.muted ? "Turn sound on" : "Mute sound");
  b.style.opacity = Sound.muted ? .45 : 1;
}

document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
const onResize = () => { if (R && $("screen-game").classList.contains("active")) R.resize(); };
window.addEventListener("resize", onResize);
if (window.ResizeObserver) new ResizeObserver(onResize).observe(stage);

/* ============================================================
   Leaderboard screen
   ============================================================ */
let boardBack = "screen-welcome";
function openBoard(from) {
  boardBack = from;
  show("screen-board");
  const list = $("board-rows"), live = $("board-live");
  list.innerHTML = `<li class="empty">Loading scores…</li>`;
  live.classList.remove("off");
  live.textContent = board.mode === "local" ? "This device only" : "Updates live";
  const myId = (lastResult && lastResult.myId) || (playerName && board.myIdFor(playerName));
  boardUnsub = board.subscribe(rows => {
    list.innerHTML = "";
    if (!rows.length) { list.innerHTML = `<li class="empty">No scores yet. Play a round to claim first place.</li>`; return; }
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = "row" + (i < 3 ? ` top${i + 1}` : "") + (r.id === myId ? " me" : "");
      const rk = document.createElement("span"); rk.className = "r"; rk.textContent = i + 1;
      const nm = document.createElement("span"); nm.className = "n"; nm.textContent = r.name;
      const sc = document.createElement("span"); sc.className = "s"; sc.textContent = r.score;
      li.append(rk, nm, sc); list.append(li);
    });
  }, err => {
    console.error(err);
    live.classList.add("off"); live.textContent = "Offline";
    list.innerHTML = `<li class="empty">Couldn't load the leaderboard. Check your connection and open it again.</li>`;
  });
}
$("btn-board").onclick = () => openBoard("screen-welcome");
$("btn-over-board").onclick = () => openBoard("screen-over");
$("btn-closed-board").onclick = () => openBoard("screen-closed");
$("btn-board-back").onclick = () => { if (boardBack === "screen-welcome") updateBestLine(); show(boardBack); };

/* ============================================================
   Controls: keyboard, swipe, d-pad
   ============================================================ */
const KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right" };
window.addEventListener("keydown", e => {
  if (!$("screen-game").classList.contains("active")) return;
  if (KEYS[e.key]) { e.preventDefault(); steer(KEYS[e.key]); }
  else if (e.key === "p" || e.key === "P" || e.key === "Escape") { phase === "paused" ? resume() : pause(); }
});

(function swipe() {
  let sx = 0, sy = 0, active = false;
  stage.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") return; active = true; sx = e.clientX; sy = e.clientY; });
  stage.addEventListener("pointermove", e => {
    if (!active) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    sx = e.clientX; sy = e.clientY;
  });
  const stop = () => { active = false; };
  stage.addEventListener("pointerup", stop); stage.addEventListener("pointercancel", stop);
})();

(function dpad() {
  const pad = $("dpad");
  let current = null;
  const set = btn => {
    if (btn === current) return;
    if (current) current.classList.remove("on");
    current = btn;
    if (btn) { btn.classList.add("on"); steer(btn.dataset.dir); }
  };
  const btnAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest("#dpad button") : null; };
  pad.addEventListener("pointerdown", e => { e.preventDefault(); Sound.unlock(); set(btnAt(e.clientX, e.clientY)); });
  pad.addEventListener("pointermove", e => { if (!current) return; const b = btnAt(e.clientX, e.clientY); if (b) set(b); });
  const release = () => set(null);
  pad.addEventListener("pointerup", release); pad.addEventListener("pointercancel", release);
  pad.addEventListener("contextmenu", e => e.preventDefault());
})();

$("screen-game").addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("dblclick", e => e.preventDefault(), { passive: false });

/* ============================================================
   Android niceties
   ============================================================ */
function goFullscreen() {
  if (!matchMedia("(pointer: coarse)").matches) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement) return;
  try {
    const p = req.call(el, { navigationUI: "hide" });
    if (p && p.then) p.then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock("portrait").catch(() => {}); }).catch(() => {});
  } catch {}
}
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
