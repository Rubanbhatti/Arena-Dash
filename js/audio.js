// Synthesised sound effects and a small arcade music loop. No audio files needed.

export function createSound(store) {
  let ctx = null, master = null, musicBus = null;
  let muted = store.get("muted", false);
  let noiseBuf = null;

  function unlock() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = .5; musicBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * .2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function tone(freq, dur = .08, type = "square", vol = .05, slide = 0, delay = 0, bus = master) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + .03);
  }
  function noise(t, dur, vol, hp = 6000, bus = musicBus) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + dur + .02);
  }

  /* ---------- music: 2-bar loop, faster during the final rush ---------- */
  const BASS = [45, 45, 57, 45, 48, 48, 60, 48, 43, 43, 55, 43, 50, 50, 52, 55]; // midi, 16 eighths
  const LEAD = [69, 0, 72, 0, 76, 0, 72, 74, 0, 72, 0, 67, 69, 0, 0, 0];
  const midi = n => 440 * 2 ** ((n - 69) / 12);
  let timer = null, step = 0, nextT = 0, tempo = 124;

  function schedule() {
    while (nextT < ctx.currentTime + .12) {
      const i = step % 16, eighth = 60 / tempo / 2;
      const t = nextT;
      const b = BASS[i];
      { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = "sawtooth"; o.frequency.value = midi(b);
        f.type = "lowpass"; f.frequency.value = 700;
        g.gain.setValueAtTime(.09, t); g.gain.exponentialRampToValueAtTime(.001, t + eighth * .9);
        o.connect(f).connect(g).connect(musicBus); o.start(t); o.stop(t + eighth); }
      if (i % 4 === 0) { // kick
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + .12);
        g.gain.setValueAtTime(.35, t); g.gain.exponentialRampToValueAtTime(.001, t + .15);
        o.connect(g).connect(musicBus); o.start(t); o.stop(t + .16);
      }
      if (i % 2 === 1) noise(t, .04, .05);
      if (i % 8 === 4) noise(t, .12, .12, 1500);
      if (tempo > 130 && LEAD[i]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square"; o.frequency.value = midi(LEAD[i]);
        g.gain.setValueAtTime(.025, t); g.gain.exponentialRampToValueAtTime(.001, t + eighth * .8);
        o.connect(g).connect(musicBus); o.start(t); o.stop(t + eighth);
      }
      nextT += eighth; step++;
    }
  }

  return {
    unlock,
    get muted() { return muted; },
    toggle() {
      muted = !muted; store.set("muted", muted);
      if (master) master.gain.value = muted ? 0 : 1;
      return muted;
    },
    musicStart(rush = false) {
      if (!ctx) return;
      tempo = rush ? 148 : 124;
      if (timer) return;
      step = 0; nextT = ctx.currentTime + .05;
      timer = setInterval(schedule, 25);
    },
    musicRush() { tempo = 148; },
    musicStop() { clearInterval(timer); timer = null; },

    token(mult = 1) { const b = 880 * (1 + (mult - 1) * .12); tone(b, .05, "square", .04); tone(b * 1.335, .07, "square", .04, 0, .045); },
    gem() { tone(660, .1, "triangle", .08); tone(990, .1, "triangle", .08, 0, .08); tone(1320, .16, "triangle", .07, 0, .16); },
    power() { tone(330, .3, "sawtooth", .05, 3); tone(660, .2, "triangle", .05, 0, .12); },
    freeze() { for (let i = 0; i < 5; i++) tone(2000 - i * 250, .08, "sine", .04, 0, i * .04); },
    shieldBreak() { tone(900, .2, "triangle", .07, .4); if (ctx) noise(ctx.currentTime, .15, .1, 2000, master); },
    hit() { tone(220, .3, "sawtooth", .08, .35); if (ctx) noise(ctx.currentTime, .2, .12, 400, master); },
    combo(m) { [0, 4, 7, 12].slice(0, m).forEach((s, i) => tone(523 * 2 ** (s / 12), .09, "square", .05, 0, i * .06)); },
    comboEnd() { tone(392, .15, "triangle", .04, .7); },
    spawn() { tone(110, .4, "sawtooth", .06, 2); },
    rush() { [0, 3, 7, 12, 15].forEach((s, i) => tone(440 * 2 ** (s / 12), .1, "square", .06, 0, i * .05)); },
    tick() { tone(520, .07, "square", .05); },
    count() { tone(523, .15, "square", .05); },
    go() { tone(1046, .28, "square", .06); },
    end() { tone(784, .15, "square", .06); tone(622, .15, "square", .06, 0, .15); tone(523, .4, "square", .06, 0, .3); },
    click() { tone(1200, .03, "square", .03); }
  };
}
