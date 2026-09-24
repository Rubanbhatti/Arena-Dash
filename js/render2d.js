// Classic 2D renderer. Used when WebGL isn't available or the player picks "Classic".
import { posOf, POWERS } from "./engine.js";

export function createRenderer2D(stage, opts) {
  const cv = document.createElement("canvas");
  cv.className = "flat";
  stage.prepend(cv);
  const ctx = cv.getContext("2d");
  let map = null, T = 24, dpr = 1, layer = null, skin = opts.skin || "#F5F7FF", shake = 0;
  let parts = [];

  function build() {
    if (!map) return;
    layer = document.createElement("canvas");
    layer.width = cv.width; layer.height = cv.height;
    const c = layer.getContext("2d");
    c.scale(dpr, dpr);
    const W = map.cols * T, H = map.rows * T;
    for (let x = 0; x < map.cols; x++) { c.fillStyle = x % 2 ? "#1D3BA6" : "#2346C0"; c.fillRect(x * T, 0, T, H); }
    c.strokeStyle = "rgba(245,247,255,.22)"; c.lineWidth = Math.max(1.5, T * .07);
    c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, T * 2.1, 0, 7); c.stroke();
    const e = Math.max(2, Math.round(T * .1));
    for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
      if (map.open(x, y)) continue;
      const px = x * T, py = y * T;
      c.fillStyle = "#16237A"; c.fillRect(px, py, T, T);
      c.fillStyle = "#FFC928";
      if (map.open(x, y - 1)) c.fillRect(px, py, T, e);
      if (map.open(x, y + 1)) c.fillRect(px, py + T - e, T, e);
      if (map.open(x - 1, y)) c.fillRect(px, py, e, T);
      if (map.open(x + 1, y)) c.fillRect(px + T - e, py, e, T);
    }
  }

  let offX = 0, offY = 0;
  function resize() {
    if (!map) return;
    const w = stage.clientWidth - 16, h = stage.clientHeight - 16;
    if (w <= 0 || h <= 0) return;
    T = Math.max(10, Math.floor(Math.min(w / map.cols, h / map.rows)));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = T * map.cols + "px"; cv.style.height = T * map.rows + "px";
    cv.width = Math.round(T * map.cols * dpr); cv.height = Math.round(T * map.rows * dpr);
    offX = (stage.clientWidth - T * map.cols) / 2; offY = (stage.clientHeight - T * map.rows) / 2;
    build();
  }

  const cx = x => (x + .5) * T, cy = y => (y + .5) * T;

  function star(x, y, r, a, color, pts = 8) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) { const rr = i % 2 ? r * .55 : r, an = i / (pts * 2) * Math.PI * 2; i ? ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : ctx.moveTo(rr, 0); }
    ctx.closePath(); ctx.fill(); ctx.fillStyle = "#0A1440"; ctx.beginPath(); ctx.arc(0, 0, r * .28, 0, 7); ctx.fill(); ctx.restore();
  }

  function render(round, dt, now) {
    if (!layer) return;
    const t = now / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(layer, 0, 0);
    if (!round) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0) { shake -= dt; ctx.translate((Math.random() - .5) * T * .3, (Math.random() - .5) * T * .3); }
    if (round.rush) { ctx.fillStyle = `rgba(255,61,127,${.06 + Math.sin(t * 10) * .04})`; ctx.fillRect(0, 0, map.cols * T, map.rows * T); }

    round.tokens.forEach((c, i) => {
      const s = Math.min(1, (round.elapsed - (c.born || 0)) * 5);
      const bob = opts.reducedMotion ? 0 : Math.sin(t * 4 + i) * T * .04;
      ctx.fillStyle = "#FFC928"; ctx.beginPath(); ctx.arc(cx(c.x), cy(c.y) + bob, T * .2 * s, 0, 7); ctx.fill();
      ctx.strokeStyle = "#C98E00"; ctx.lineWidth = T * .05; ctx.beginPath(); ctx.arc(cx(c.x), cy(c.y) + bob, T * .12 * s, 0, 7); ctx.stroke();
    });
    const g = round.gem;
    if (g && (g.life > 2 || Math.floor(t * 8) % 2)) {
      const x = cx(g.x), y = cy(g.y), r = T * .3;
      ctx.fillStyle = "#43E6FF"; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * .8, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * .8, y); ctx.closePath(); ctx.fill();
    }
    const pw = round.power;
    if (pw && (pw.life > 2 || Math.floor(t * 8) % 2)) {
      const x = cx(pw.x), y = cy(pw.y), col = POWERS[pw.kind].color;
      ctx.strokeStyle = col; ctx.lineWidth = T * .07; ctx.beginPath(); ctx.arc(x, y, T * .36 + Math.sin(t * 6) * T * .03, 0, 7); ctx.stroke();
      ctx.fillStyle = col; ctx.font = `${Math.round(T * .42)}px Bungee, Impact, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText({ boost: "S", shield: "D", magnet: "M", freeze: "F" }[pw.kind], x, y + 1);
    }
    for (const h of round.hazards) {
      const q = posOf(h);
      const frozen = round.freeze > 0;
      if (h.kind === "hunter") {
        ctx.fillStyle = frozen ? "#A8EEFF" : "#D11F4B"; ctx.beginPath(); ctx.arc(cx(q.x), cy(q.y), T * .36, 0, 7); ctx.fill();
        ctx.fillStyle = "#FF3030"; ctx.fillRect(cx(q.x) - T * .2, cy(q.y) - T * .08, T * .4, T * .12);
      } else star(cx(q.x), cy(q.y), T * .38, frozen ? 0 : h.spin, frozen ? "#A8EEFF" : "#FF3D7F");
    }
    const P = round.player, p = posOf(P);
    if (!(P.invuln > 0 && P.stun <= 0 && Math.floor(t * 12) % 2)) {
      const x = cx(p.x), y = cy(p.y), r = T * .36;
      if (P.magnet > 0) { ctx.fillStyle = "rgba(255,138,61,.15)"; ctx.beginPath(); ctx.arc(x, y, T * 2.6, 0, 7); ctx.fill(); }
      if (P.boost > 0) { ctx.strokeStyle = "#7CFF6B"; ctx.lineWidth = T * .08; ctx.beginPath(); ctx.arc(x, y, r + T * .1, 0, 7); ctx.stroke(); }
      ctx.fillStyle = P.stun > 0 ? "#9AA6D6" : skin; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = "#FFC928"; ctx.lineWidth = T * .08; ctx.beginPath(); ctx.arc(x, y, r - T * .04, 0, 7); ctx.stroke();
      const d = P.facing || { x: 0, y: 1 };
      ctx.fillStyle = "#0A1440"; ctx.beginPath(); ctx.arc(x + d.x * r * .42, y + d.y * r * .42, T * .09, 0, 7); ctx.fill();
      if (P.shield) { ctx.strokeStyle = "rgba(91,168,255,.9)"; ctx.lineWidth = T * .06; ctx.beginPath(); ctx.arc(x, y, r + T * .18, 0, 7); ctx.stroke(); }
    }
    parts = parts.filter(pp => (pp.life -= dt) > 0);
    for (const pp of parts) {
      pp.x += pp.vx * dt; pp.y += pp.vy * dt;
      ctx.globalAlpha = pp.life / .6; ctx.fillStyle = pp.c; ctx.fillRect(cx(pp.x) - 2, cy(pp.y) - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function burst(x, y, c, n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 7, s = 1 + Math.random() * 2; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, c, life: .6 }); }
  }

  return {
    kind: "2d",
    setMap(m) { map = m; resize(); },
    newRound() { parts = []; },
    setSkin(c) { skin = c; },
    render, resize,
    onEvent(e) {
      if (e.type === "token") burst(e.x, e.y, "#FFC928", 5);
      if (e.type === "gem") burst(e.x, e.y, "#43E6FF", 12);
      if (e.type === "power") burst(e.x, e.y, POWERS[e.kind].color, 12);
      if (e.type === "hit") { burst(e.x, e.y, "#FF3D7F", 12); if (!opts.reducedMotion) shake = .25; }
      if (e.type === "shieldBreak") burst(e.x, e.y, "#5BA8FF", 14);
    },
    project(x, y) { return { x: offX + cx(x), y: offY + cy(y) - T * .4 }; },
    dispose() { cv.remove(); }
  };
}
