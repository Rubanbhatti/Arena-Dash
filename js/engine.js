// Arena Dash rules engine. Pure game logic; renderers only read from it.

export const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const DIR_LIST = Object.values(DIRS);

export const POWERS = {
  boost:  { name: "Speed",  color: "#7CFF6B", time: 4 },
  shield: { name: "Shield", color: "#5BA8FF", time: 0 },   // lasts until it blocks a hit
  magnet: { name: "Magnet", color: "#FF8A3D", time: 6 },
  freeze: { name: "Freeze", color: "#CFF6FF", time: 4 }
};
const POWER_WEIGHTS = [["boost", 3], ["shield", 2.5], ["magnet", 2.5], ["freeze", 2]];

export const TUNE = {
  playerSpeed: 5.6,
  boostSpeed: 8.8,
  spinnerStart: 3.0,
  spinnerEnd: 4.4,
  hunterFactor: 0.78,       // hunters are smarter but slower
  chase: 0.35,
  tokens: 14,
  stun: 0.8,
  invuln: 1.8,
  gemEvery: [8, 12], gemLife: 6,
  powerEvery: [9, 14], powerLife: 7,
  comboWindow: 1.8,         // seconds between tokens to keep a combo
  comboStep: 5,             // tokens per multiplier step
  comboMax: 4,
  rushSeconds: 10,          // final seconds with double points
  magnetRange: 2.6,
  // [fraction of round, hazard kind]
  waves: [[0.3, "spinner"], [0.5, "hunter"], [0.72, "spinner"]],
  maxScore: 5000
};

const rand = (a, b) => a + Math.random() * (b - a);
const d2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function mover(x, y) { return { x, y, dir: null, next: null, t: 0, moving: false }; }
export function posOf(m) {
  return m.moving ? { x: m.x + m.dir.x * m.t, y: m.y + m.dir.y * m.t } : { x: m.x, y: m.y };
}

export class Round {
  constructor({ seconds, points, map }) {
    this.map = map;
    this.seconds = seconds;
    this.pts = points;
    this.time = seconds;
    this.elapsed = 0;
    this.over = false;

    this.score = 0; this.coins = 0; this.gems = 0; this.hits = 0;
    this.stats = { maxMult: 1, bestChain: 0, powerups: 0, shieldSaves: 0, rushPoints: 0 };

    this.player = Object.assign(mover(map.start.x, map.start.y), {
      stun: 0, invuln: 0, boost: 0, magnet: 0, shield: false, facing: DIRS.down
    });
    this.freeze = 0;
    this.combo = { count: 0, timer: 0, mult: 1 };
    this.rush = false;

    this.hazards = [];
    this.wave = 0;
    this.tokens = [];
    this.gem = null;
    this.power = null;
    this.nextGem = rand(...TUNE.gemEvery);
    this.nextPower = rand(5, 8);
    this.events = [];
    this.lastWhole = seconds;

    [0, 1, 3].forEach(i => this.addHazard("spinner", map.spawns[i]));
    for (let i = 0; i < TUNE.tokens; i++) this.tokens.push(this.freeTile());
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  addHazard(kind, at) {
    this.hazards.push(Object.assign(mover(at.x, at.y), { kind, spin: Math.random() * 6, id: this.hazards.length }));
  }

  occupied(x, y) {
    return this.tokens.some(c => c.x === x && c.y === y) ||
      (this.gem && this.gem.x === x && this.gem.y === y) ||
      (this.power && this.power.x === x && this.power.y === y);
  }

  freeTile() {
    const p = posOf(this.player), F = this.map.floor;
    for (let i = 0; i < 80; i++) {
      const c = F[(Math.random() * F.length) | 0];
      if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) < 3 || this.occupied(c.x, c.y)) continue;
      return { x: c.x, y: c.y, born: this.elapsed };
    }
    const c = F[(Math.random() * F.length) | 0];
    return { x: c.x, y: c.y, born: this.elapsed };
  }

  /* ---------- steering ---------- */
  steer(name) {
    const d = DIRS[name], m = this.player, open = this.map.open;
    if (!d || this.over) return;
    m.next = d;
    if (!m.moving) return;
    if (d.x === -m.dir.x && d.y === -m.dir.y) {           // instant reverse
      m.x += m.dir.x; m.y += m.dir.y; m.t = 1 - m.t; m.dir = d; m.facing = d;
      return;
    }
    if (m.t < .22 && (d.x !== m.dir.x || d.y !== m.dir.y) && open(m.x + d.x, m.y + d.y)) {
      m.t = 0; m.moving = false; m.dir = d;                  // forgiving late turn
    }
  }

  step(m, speed, dt, choose) {
    const open = this.map.open;
    let rem = speed * dt;
    for (let g = 0; rem > 1e-6 && g < 8; g++) {
      if (m.moving) {
        const s = Math.min(rem, 1 - m.t);
        m.t += s; rem -= s;
        if (m.t >= 1 - 1e-6) { m.x += m.dir.x; m.y += m.dir.y; m.t = 0; m.moving = false; }
      } else {
        choose(m);
        if (m.dir && open(m.x + m.dir.x, m.y + m.dir.y)) { m.moving = true; m.facing = m.dir; }
        else break;
      }
    }
  }

  choosePlayer = m => {
    if (m.next && this.map.open(m.x + m.next.x, m.y + m.next.y)) m.dir = m.next;
  };

  chooseSpinner = h => {
    const open = this.map.open, p = posOf(this.player);
    let opts = DIR_LIST.filter(d => open(h.x + d.x, h.y + d.y) && !(h.dir && d.x === -h.dir.x && d.y === -h.dir.y));
    if (!opts.length) opts = DIR_LIST.filter(d => open(h.x + d.x, h.y + d.y));
    if (Math.random() < TUNE.chase) {
      opts.sort((a, b) => d2(h.x + a.x, h.y + a.y, p.x, p.y) - d2(h.x + b.x, h.y + b.y, p.x, p.y));
      h.dir = opts[0];
    } else h.dir = opts[(Math.random() * opts.length) | 0];
  };

  // Hunters follow the real shortest path to you.
  chooseHunter = h => {
    const { open, cols } = this.map, p = this.player;
    const tx = p.moving ? p.x + p.dir.x : p.x, ty = p.moving ? p.y + p.dir.y : p.y;
    if (h.x === tx && h.y === ty) { this.chooseSpinner(h); return; }
    const key = (x, y) => y * cols + x;
    const prev = new Map([[key(tx, ty), null]]);
    const q = [[tx, ty]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === h.x && y === h.y) break;
      for (const d of DIR_LIST) {
        const nx = x + d.x, ny = y + d.y, k = key(nx, ny);
        if (open(nx, ny) && !prev.has(k)) { prev.set(k, d); q.push([nx, ny]); }
      }
    }
    const came = prev.get(key(h.x, h.y));
    h.dir = came ? { x: -came.x, y: -came.y } : null;
    if (!h.dir) this.chooseSpinner(h);
  };

  /* ---------- scoring helpers ---------- */
  addScore(n) {
    this.score = Math.min(TUNE.maxScore, this.score + n);
    if (this.rush) this.stats.rushPoints += n;
  }

  collectToken(i, viaMagnet) {
    const c = this.tokens[i];
    const cb = this.combo;
    cb.count = cb.timer > 0 ? cb.count + 1 : 1;
    cb.timer = TUNE.comboWindow;
    const mult = Math.min(TUNE.comboMax, 1 + Math.floor(cb.count / TUNE.comboStep));
    if (mult > cb.mult) this.emit("combo", { mult });
    cb.mult = mult;
    this.stats.maxMult = Math.max(this.stats.maxMult, mult);
    this.stats.bestChain = Math.max(this.stats.bestChain, cb.count);
    const pts = this.pts.coin * mult * (this.rush ? 2 : 1);
    this.addScore(pts);
    this.coins++;
    this.emit("token", { x: c.x, y: c.y, pts, magnet: !!viaMagnet });
    this.tokens[i] = this.freeTile();
  }

  /* ---------- main update ---------- */
  update(dt) {
    if (this.over) return;
    this.elapsed += dt;
    this.time = Math.max(0, this.seconds - this.elapsed);
    const frac = this.elapsed / this.seconds;
    const P = this.player;

    const whole = Math.ceil(this.time);
    if (whole !== this.lastWhole) { this.lastWhole = whole; if (whole <= 5 && whole > 0) this.emit("tick", { n: whole }); }

    if (!this.rush && this.time <= TUNE.rushSeconds) { this.rush = true; this.emit("rush"); }

    // Timers
    P.invuln = Math.max(0, P.invuln - dt);
    P.boost = Math.max(0, P.boost - dt);
    P.magnet = Math.max(0, P.magnet - dt);
    const wasFrozen = this.freeze > 0;
    this.freeze = Math.max(0, this.freeze - dt);
    if (wasFrozen && this.freeze === 0) this.emit("thaw");
    if (this.combo.timer > 0) {
      this.combo.timer -= dt;
      if (this.combo.timer <= 0) {
        if (this.combo.mult > 1) this.emit("comboEnd");
        this.combo.count = 0; this.combo.mult = 1; this.combo.timer = 0;
      }
    }

    // Player
    if (P.stun > 0) P.stun = Math.max(0, P.stun - dt);
    else this.step(P, P.boost > 0 ? TUNE.boostSpeed : TUNE.playerSpeed, dt, this.choosePlayer);

    // Hazard waves
    if (this.wave < TUNE.waves.length && frac >= TUNE.waves[this.wave][0]) {
      const kind = TUNE.waves[this.wave][1];
      this.wave++;
      const p = posOf(P);
      const s = this.map.spawns.slice().sort((a, b) => d2(b.x, b.y, p.x, p.y) - d2(a.x, a.y, p.x, p.y))[0];
      this.addHazard(kind, s);
      this.emit("spawn", { kind, x: s.x, y: s.y });
    }

    // Hazards
    const sp = TUNE.spinnerStart + (TUNE.spinnerEnd - TUNE.spinnerStart) * frac;
    for (const h of this.hazards) {
      if (this.freeze > 0) continue;
      if (h.kind === "hunter") this.step(h, sp * TUNE.hunterFactor, dt, this.chooseHunter);
      else this.step(h, sp, dt, this.chooseSpinner);
      h.spin += dt * 6;
    }

    const p = posOf(P);

    // Tokens (and magnet pull)
    for (let i = 0; i < this.tokens.length; i++) {
      const c = this.tokens[i];
      const man = Math.abs(c.x - p.x) + Math.abs(c.y - p.y);
      if (man < .5) this.collectToken(i, false);
      else if (P.magnet > 0 && d2(c.x, c.y, p.x, p.y) < TUNE.magnetRange ** 2) this.collectToken(i, true);
    }

    // Gem
    this.nextGem -= dt * (this.rush ? 2 : 1);
    if (!this.gem && this.nextGem <= 0) { this.gem = Object.assign(this.freeTile(), { life: TUNE.gemLife }); this.emit("gemSpawn", this.gem); }
    if (this.gem) {
      const g = this.gem;
      g.life -= dt;
      if (Math.abs(g.x - p.x) + Math.abs(g.y - p.y) < .5) {
        const pts = this.pts.gem * (this.rush ? 2 : 1);
        this.addScore(pts); this.gems++;
        this.emit("gem", { x: g.x, y: g.y, pts });
        this.gem = null; this.nextGem = rand(...TUNE.gemEvery);
      } else if (g.life <= 0) { this.gem = null; this.nextGem = rand(...TUNE.gemEvery); }
    }

    // Power-ups
    this.nextPower -= dt;
    if (!this.power && this.nextPower <= 0) {
      const total = POWER_WEIGHTS.reduce((s, [, w]) => s + w, 0);
      let r = Math.random() * total, kind = "boost";
      for (const [k, w] of POWER_WEIGHTS) { if ((r -= w) <= 0) { kind = k; break; } }
      this.power = Object.assign(this.freeTile(), { kind, life: TUNE.powerLife });
    }
    if (this.power) {
      const pw = this.power;
      pw.life -= dt;
      if (Math.abs(pw.x - p.x) + Math.abs(pw.y - p.y) < .5) {
        this.stats.powerups++;
        if (pw.kind === "boost") P.boost = POWERS.boost.time;
        if (pw.kind === "shield") P.shield = true;
        if (pw.kind === "magnet") P.magnet = POWERS.magnet.time;
        if (pw.kind === "freeze") this.freeze = POWERS.freeze.time;
        this.emit("power", { kind: pw.kind, x: pw.x, y: pw.y });
        this.power = null; this.nextPower = rand(...TUNE.powerEvery);
      } else if (pw.life <= 0) { this.power = null; this.nextPower = rand(...TUNE.powerEvery); }
    }

    // Hazard contact (frozen hazards are harmless)
    if (P.invuln <= 0 && this.freeze <= 0) {
      for (const h of this.hazards) {
        const q = posOf(h);
        if (d2(q.x, q.y, p.x, p.y) < .62 * .62) {
          if (P.shield) {
            P.shield = false; P.invuln = 1.2; this.stats.shieldSaves++;
            this.emit("shieldBreak", { x: p.x, y: p.y });
          } else {
            this.score = Math.max(0, this.score - this.pts.hitPenalty);
            this.hits++;
            P.stun = TUNE.stun; P.invuln = TUNE.invuln; P.boost = 0;
            if (this.combo.mult > 1) this.emit("comboEnd");
            this.combo.count = 0; this.combo.mult = 1; this.combo.timer = 0;
            this.emit("hit", { x: p.x, y: p.y, pts: this.pts.hitPenalty, kind: h.kind });
          }
          break;
        }
      }
    }

    if (this.time <= 0) { this.over = true; this.emit("end"); }
  }

  result() {
    return {
      score: Math.min(TUNE.maxScore, Math.max(0, Math.round(this.score))),
      coins: this.coins, gems: this.gems, hits: this.hits,
      stats: { ...this.stats }, map: this.map.name
    };
  }
}

// Badges earned in a round
export function badgesFor(r) {
  const s = r.stats, out = [];
  if (r.hits === 0) out.push({ id: "untouchable", name: "Untouchable", desc: "No hits all round" });
  if (s.maxMult >= 4) out.push({ id: "combo", name: "Combo king", desc: "Reached a ×4 combo" });
  else if (s.maxMult >= 3) out.push({ id: "combo3", name: "On a roll", desc: "Reached a ×3 combo" });
  if (r.gems >= 3) out.push({ id: "gems", name: "Gem hunter", desc: `${r.gems} gems grabbed` });
  if (s.powerups >= 3) out.push({ id: "power", name: "Power player", desc: `${s.powerups} power-ups used` });
  if (s.shieldSaves >= 1) out.push({ id: "shield", name: "Saved by the shield", desc: "Blocked a hit" });
  if (s.rushPoints >= 200) out.push({ id: "rush", name: "Rush hour", desc: `${s.rushPoints} points in the final rush` });
  if (r.coins >= 45) out.push({ id: "tokens", name: "Token machine", desc: `${r.coins} tokens collected` });
  return out;
}
