// 3D renderer (Three.js). Reads game state from the engine; never changes it.
import { posOf } from "./engine.js";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export async function createRenderer3D(stage, opts) {
  const THREE = await import(THREE_URL);
  const high = opts.quality !== "low";

  const renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: "high-performance" });
  if (!renderer.getContext()) throw new Error("WebGL unavailable");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.className = "gl";
  stage.prepend(canvas);

  const NAVY = new THREE.Color("#0A1440");
  const scene = new THREE.Scene();
  scene.background = NAVY.clone();
  scene.fog = new THREE.Fog(NAVY, 40, 90);

  const camera = new THREE.PerspectiveCamera(30, 1, .1, 160);
  const TILT = .5; // radians from straight down

  // Lights
  const hemi = new THREE.HemisphereLight("#DDE5FF", "#26307A", 1.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#FFFFFF", 2.4);
  sun.position.set(-5, 14, 7);
  sun.castShadow = high;
  if (high) {
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera; s.left = -11; s.right = 11; s.top = 13; s.bottom = -13; s.near = 1; s.far = 40;
    sun.shadow.bias = -.0015;
    sun.shadow.normalBias = .02;
  }
  scene.add(sun);
  const rim = new THREE.DirectionalLight("#FF7AA8", .7);
  rim.position.set(6, 5, -10);
  scene.add(rim);

  // Big dark ground beyond the arena
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: "#0C1650", roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -.02; outer.receiveShadow = high;
  scene.add(outer);

  /* ---------- shared helpers ---------- */
  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(.35, "rgba(255,255,255,.45)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); return t;
  })();
  function glowDisc(color, size) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
      map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .85
    }));
    m.rotation.x = -Math.PI / 2; m.position.y = .02;
    return m;
  }
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .45, metalness: .15, ...extra });
  const shadowy = obj => { obj.traverse(o => { if (o.isMesh) { o.castShadow = high; } }); return obj; };

  /* ---------- arena ---------- */
  let arena = null, map = null, trimMat = null, trimBase = new THREE.Color("#FFC928");
  const wx = x => x - (map.cols - 1) / 2;
  const wz = y => y - (map.rows - 1) / 2;
  const WALL_H = .62;

  function floorTexture() {
    const P = 64, W = map.cols * P, H = map.rows * P;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    for (let x = 0; x < map.cols; x++) {
      g.fillStyle = x % 2 ? "#1D3BA6" : "#2346C0"; g.fillRect(x * P, 0, P, H);
      g.fillStyle = "rgba(10,20,64,.18)";
      for (let y = (x * 7) % 5; y < map.rows; y += 5) g.fillRect(x * P, y * P, P, 2);   // plank seams
    }
    // soft sheen
    const sheen = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * .7);
    sheen.addColorStop(0, "rgba(255,255,255,.10)"); sheen.addColorStop(1, "rgba(0,0,0,.18)");
    g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    // court markings
    g.strokeStyle = "rgba(245,247,255,.32)"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, P * 2.1, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W / 2, 0, P * 3.4, 0, Math.PI); g.stroke();
    g.beginPath(); g.arc(W / 2, H, P * 3.4, Math.PI, 0); g.stroke();
    g.strokeRect(P * .5, P * .5, W - P, H - P);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  function buildArena(m) {
    map = m;
    if (arena) { scene.remove(arena); arena.traverse(o => { o.geometry && o.geometry.dispose(); }); }
    arena = new THREE.Group();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.cols, map.rows),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: .38, metalness: .05 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = high;
    arena.add(floor);

    const walls = [];
    for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) if (!map.open(x, y)) walls.push([x, y]);
    const side = std("#16237A", { roughness: .6 });
    const top = std("#2B3DB0", { roughness: .5 });
    const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_H, 1), [side, side, top, side, side, side], walls.length);
    const M = new THREE.Matrix4();
    walls.forEach(([x, y], i) => { M.makeTranslation(wx(x), WALL_H / 2, wz(y)); wallMesh.setMatrixAt(i, M); });
    wallMesh.castShadow = high; wallMesh.receiveShadow = high;
    arena.add(wallMesh);

    // Yellow padding trims along every edge that faces the floor
    const trims = [];
    for (const [x, y] of walls) {
      if (map.open(x, y - 1)) trims.push([wx(x), wz(y) - .47, 0]);
      if (map.open(x, y + 1)) trims.push([wx(x), wz(y) + .47, 0]);
      if (map.open(x - 1, y)) trims.push([wx(x) - .47, wz(y), 1]);
      if (map.open(x + 1, y)) trims.push([wx(x) + .47, wz(y), 1]);
    }
    trimMat = new THREE.MeshBasicMaterial({ color: "#FFC928" });
    const trimMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, .08, .08), trimMat, trims.length);
    const q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    trims.forEach(([x, z, rot], i) => {
      q.setFromAxisAngle(yAxis, rot ? Math.PI / 2 : 0);
      M.compose(v.set(x, WALL_H + .005, z), q, s);
      trimMesh.setMatrixAt(i, M);
    });
    arena.add(trimMesh);

    scene.add(arena);
    fitCamera();
  }

  /* ---------- pickups ---------- */
  const tokenGeo = new THREE.CylinderGeometry(.24, .24, .08, 28).rotateX(Math.PI / 2);
  const tokenRingGeo = new THREE.TorusGeometry(.15, .025, 8, 24);
  const tokenMat = std("#FFC928", { metalness: .25, roughness: .3, emissive: "#FFB000", emissiveIntensity: .45 });
  const tokenRingMat = std("#FFE9A0", { metalness: .2, roughness: .3, emissive: "#C98E00", emissiveIntensity: .5 });
  const tokenPool = [];
  function tokenMesh() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(tokenGeo, tokenMat));
    const r1 = new THREE.Mesh(tokenRingGeo, tokenRingMat); r1.position.z = .041; g.add(r1);
    const r2 = new THREE.Mesh(tokenRingGeo, tokenRingMat); r2.position.z = -.041; g.add(r2);
    shadowy(g);
    const glow = glowDisc("#FFC928", .9); glow.material.opacity = .35;
    const holder = new THREE.Group(); holder.add(g); holder.add(glow); holder.userData.coin = g;
    scene.add(holder); return holder;
  }

  const gem = new THREE.Group();
  {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(.26), std("#43E6FF", { emissive: "#0B7F99", emissiveIntensity: 1, metalness: .3, roughness: .15, flatShading: true }));
    m.scale.y = 1.35; m.name = "core"; gem.add(shadowy(m));
    const d = glowDisc("#43E6FF", 1.3); d.position.y = -.32; gem.add(d);
    gem.visible = false; scene.add(gem);
  }

  const powers = {};
  const boltShape = new THREE.Shape();
  [[.08, .3], [-.14, -.02], [0, -.02], [-.08, -.3], [.16, .06], [.02, .06]].forEach(([x, y], i) => i ? boltShape.lineTo(x, y) : boltShape.moveTo(x, y));
  const makePower = (kind, color, icon) => {
    const g = new THREE.Group();
    icon.name = "icon"; g.add(shadowy(icon));
    const disc = glowDisc(color, 1.5); disc.position.y = -.4; g.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.36, .03, 8, 36), new THREE.MeshBasicMaterial({ color }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -.38; g.add(ring);
    g.visible = false; scene.add(g); powers[kind] = g;
  };
  makePower("boost", "#7CFF6B", new THREE.Mesh(new THREE.ExtrudeGeometry(boltShape, { depth: .08, bevelEnabled: false }).center(),
    std("#7CFF6B", { emissive: "#2E8A1F", emissiveIntensity: .9 })));
  {
    const s = new THREE.Group();
    s.add(new THREE.Mesh(new THREE.SphereGeometry(.17, 20, 14), std("#5BA8FF", { emissive: "#1F4FA0", emissiveIntensity: .9 })));
    const t = new THREE.Mesh(new THREE.TorusGeometry(.26, .03, 8, 30), std("#E8F2FF", { emissive: "#5BA8FF", emissiveIntensity: .5 }));
    t.rotation.x = Math.PI / 2.4; s.add(t);
    makePower("shield", "#5BA8FF", s);
  }
  {
    const s = new THREE.Group();
    const u = new THREE.Mesh(new THREE.TorusGeometry(.16, .065, 10, 20, Math.PI), std("#FF8A3D", { emissive: "#8A3A00", emissiveIntensity: .7 }));
    u.rotation.z = Math.PI; s.add(u);
    [-.16, .16].forEach(x => { const tip = new THREE.Mesh(new THREE.BoxGeometry(.13, .1, .13), std("#F5F7FF")); tip.position.set(x, .04, 0); s.add(tip); });
    makePower("magnet", "#FF8A3D", s);
  }
  makePower("freeze", "#CFF6FF", new THREE.Mesh(new THREE.IcosahedronGeometry(.24, 0),
    std("#CFF6FF", { emissive: "#4FB6D6", emissiveIntensity: .8, flatShading: true, roughness: .1 })));

  /* ---------- hazards ---------- */
  const pinkMat = std("#FF3D7F", { emissive: "#FF1F6B", emissiveIntensity: .45, metalness: .2, roughness: .3 });
  const iceMat = std("#A8EEFF", { emissive: "#3C8FB0", emissiveIntensity: .6, roughness: .1, metalness: .2 });
  const hubMat = std("#0A1440");
  const redMat = std("#D11F4B", { metalness: .35, roughness: .3, emissive: "#3A0010", emissiveIntensity: .8 });
  const visorMat = new THREE.MeshBasicMaterial({ color: "#FF3030" });
  const hazardMeshes = new Map();

  function spinnerMesh() {
    const g = new THREE.Group(), body = new THREE.Group();
    body.add(new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .09, 20), pinkMat));
    const coneGeo = new THREE.ConeGeometry(.075, .18, 4).rotateZ(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, c = new THREE.Mesh(coneGeo, pinkMat);
      c.position.set(Math.cos(a) * .33, 0, Math.sin(a) * .33); c.rotation.y = -a; body.add(c);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .14, 12), hubMat); body.add(hub);
    body.name = "body"; g.add(body);
    g.userData.tint = mat => body.traverse(o => { if (o.isMesh && o !== hub) o.material = mat; });
    return shadowy(g);
  }
  function hunterMesh() {
    const g = new THREE.Group(), body = new THREE.Group();
    body.add(new THREE.Mesh(new THREE.SphereGeometry(.3, 22, 16), redMat));
    const visor = new THREE.Mesh(new THREE.BoxGeometry(.36, .1, .14), visorMat); visor.position.set(0, .05, .23); body.add(visor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.3, .04, 8, 26), hubMat); ring.rotation.x = Math.PI / 2; ring.position.y = -.08; body.add(ring);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .22), hubMat); ant.position.y = .38; body.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 8), visorMat); tip.position.y = .5; body.add(tip);
    body.name = "body"; g.add(body);
    g.userData.tint = mat => { body.children[0].material = mat === iceMat ? iceMat : redMat; };
    return shadowy(g);
  }

  /* ---------- player ---------- */
  const player = new THREE.Group();
  const skinMat = std(opts.skin || "#F5F7FF", { roughness: .3, emissive: opts.skin || "#F5F7FF", emissiveIntensity: .45 });
  const pBody = new THREE.Group(); player.add(pBody);
  pBody.add(new THREE.Mesh(new THREE.SphereGeometry(.34, 28, 20), skinMat));
  { const band = new THREE.Mesh(new THREE.TorusGeometry(.342, .055, 10, 36), std("#FFC928", { metalness: .2, roughness: .3, emissive: "#FFB000", emissiveIntensity: .35 }));
    band.rotation.x = Math.PI / 2; pBody.add(band); }
  const eyeW = std("#FFFFFF", { roughness: .2 }), eyeP = std("#0A1440");
  [-.11, .11].forEach(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(.075, 14, 10), eyeW); e.position.set(x, .1, .26); pBody.add(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(.04, 10, 8), eyeP); p.position.set(x, .1, .325); pBody.add(p);
  });
  shadowy(player);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(.5, 24, 16), new THREE.MeshStandardMaterial({
    color: "#5BA8FF", emissive: "#2B6FD6", emissiveIntensity: .6, transparent: true, opacity: .28, depthWrite: false }));
  player.add(bubble);
  const magnetAura = glowDisc("#FF8A3D", 5.4); magnetAura.position.y = -.3; player.add(magnetAura);
  const boostAura = glowDisc("#7CFF6B", 1.6); boostAura.position.y = -.3; player.add(boostAura);
  const stars = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(.06), new THREE.MeshBasicMaterial({ color: "#FFC928" }));
    player.add(s); stars.push(s);
  }
  scene.add(player);
  let facing = 0;

  /* ---------- particles and rings ---------- */
  const partGeo = new THREE.BoxGeometry(.08, .08, .08);
  const matCache = {};
  const partMat = c => matCache[c] || (matCache[c] = new THREE.MeshBasicMaterial({ color: c }));
  const parts = [];
  for (let i = 0; i < 110; i++) {
    const m = new THREE.Mesh(partGeo, partMat("#FFFFFF")); m.visible = false; scene.add(m);
    parts.push({ m, life: 0, vx: 0, vy: 0, vz: 0 });
  }
  let partIdx = 0;
  function burst(x, y, color, n, speed = 2.6, up = 2.5) {
    for (let i = 0; i < n; i++) {
      const p = parts[partIdx++ % parts.length];
      const a = Math.random() * Math.PI * 2, s = speed * (.4 + Math.random() * .8);
      p.m.material = partMat(color);
      p.m.position.set(wx(x), .4, wz(y));
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = up * (.5 + Math.random());
      p.life = p.max = .5 + Math.random() * .4;
      p.m.visible = true;
    }
  }
  const rings = [];
  for (let i = 0; i < 5; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 40), new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    r.rotation.x = -Math.PI / 2; r.position.y = .05; r.visible = false; scene.add(r); rings.push({ m: r, life: 0 });
  }
  let ringIdx = 0;
  function ring(x, y, color, size = 1.6) {
    const r = rings[ringIdx++ % rings.length];
    r.m.material.color.set(color); r.m.position.x = wx(x); r.m.position.z = wz(y);
    r.life = .6; r.size = size; r.m.visible = true;
  }

  /* ---------- camera fit ---------- */
  let W = 1, H = 1, baseDist = 20, shake = 0;
  const target = new THREE.Vector3();
  const camDir = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));
  function fitCamera() {
    if (!map) return;
    camera.aspect = W / H; camera.updateProjectionMatrix();
    const hx = map.cols / 2 - .55, hz = map.rows / 2 - .45; // outer barrier may crop slightly
    const pts = [];
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [0, WALL_H]) pts.push(new THREE.Vector3(x, y, z));
    target.set(0, 0, .35);
    let lo = 5, hi = 120;
    for (let i = 0; i < 28; i++) {
      const d = (lo + hi) / 2;
      camera.position.copy(target).addScaledVector(camDir, d); camera.lookAt(target); camera.updateMatrixWorld();
      const fits = pts.every(p => { const v = p.clone().project(camera); return Math.abs(v.x) < .99 && Math.abs(v.y) < .93; });
      fits ? hi = d : lo = d;
    }
    baseDist = hi * 1.01;
  }

  function resize() {
    W = Math.max(1, stage.clientWidth); H = Math.max(1, stage.clientHeight);
    renderer.setSize(W, H, false);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    fitCamera();
  }
  resize();

  /* ---------- events from the engine ---------- */
  function onEvent(e) {
    switch (e.type) {
      case "token": burst(e.x, e.y, "#FFC928", e.magnet ? 4 : 7, 2, 2); break;
      case "gem": burst(e.x, e.y, "#43E6FF", 16, 3, 3); ring(e.x, e.y, "#43E6FF", 1.8); break;
      case "power": burst(e.x, e.y, { boost: "#7CFF6B", shield: "#5BA8FF", magnet: "#FF8A3D", freeze: "#CFF6FF" }[e.kind], 18, 3, 3);
        ring(e.x, e.y, "#FFFFFF", e.kind === "freeze" ? 9 : 2.2); break;
      case "hit": burst(e.x, e.y, "#FF3D7F", 16, 3.4, 3); shake = opts.reducedMotion ? 0 : .3; break;
      case "shieldBreak": burst(e.x, e.y, "#5BA8FF", 22, 3.6, 3); ring(e.x, e.y, "#5BA8FF", 2.4); break;
      case "spawn": ring(e.x, e.y, e.kind === "hunter" ? "#FF3030" : "#FF3D7F", 2.6); burst(e.x, e.y, "#FF3D7F", 12, 2, 4); break;
    }
  }

  /* ---------- per-frame ---------- */
  let lastHazardFrozen = false;
  function render(round, dt, now) {
    const t = now / 1000;
    if (!map) return;

    if (round) {
      // Tokens
      while (tokenPool.length < round.tokens.length) tokenPool.push(tokenMesh());
      round.tokens.forEach((c, i) => {
        const g = tokenPool[i];
        const grow = Math.min(1, (round.elapsed - (c.born || 0)) * 5);
        g.visible = true;
        g.scale.setScalar(Math.max(.01, grow));
        g.position.set(wx(c.x), 0, wz(c.y));
        g.userData.coin.position.y = .38 + Math.sin(t * 3 + i) * .05;
        g.userData.coin.rotation.set(-.45, Math.sin(t * 2.2 + i) * 1.1, 0);
      });
      for (let i = round.tokens.length; i < tokenPool.length; i++) tokenPool[i].visible = false;

      // Gem
      const gm = round.gem;
      gem.visible = !!gm && (gm.life > 2 || Math.floor(t * 8) % 2 === 0);
      if (gm) {
        gem.position.set(wx(gm.x), .45 + Math.sin(t * 4) * .07, wz(gm.y));
        gem.getObjectByName("core").rotation.y = t * 2;
      }

      // Power-up
      for (const [k, g] of Object.entries(powers)) {
        const pw = round.power;
        g.visible = !!pw && pw.kind === k && (pw.life > 2 || Math.floor(t * 8) % 2 === 0);
        if (g.visible) {
          g.position.set(wx(pw.x), .45 + Math.sin(t * 3.5) * .08, wz(pw.y));
          g.getObjectByName("icon").rotation.y = t * 2.4;
        }
      }

      // Hazards
      const frozen = round.freeze > 0;
      for (const h of round.hazards) {
        let g = hazardMeshes.get(h.id);
        if (!g) { g = h.kind === "hunter" ? hunterMesh() : spinnerMesh(); g.userData.born = t; scene.add(g); hazardMeshes.set(h.id, g); if (frozen) g.userData.tint(iceMat); }
        const p = posOf(h);
        const grow = Math.min(1, (t - g.userData.born) * 3);
        g.scale.setScalar(Math.max(.01, grow));
        const body = g.getObjectByName("body");
        if (h.kind === "hunter") {
          g.position.set(wx(p.x), .36 + Math.sin(t * 5 + h.id) * .05, wz(p.y));
          if (h.dir) { const a = Math.atan2(h.dir.x, h.dir.y); g.rotation.y += angDiff(g.rotation.y, a) * Math.min(1, dt * 10); }
        } else {
          g.position.set(wx(p.x), .3, wz(p.y));
          if (!frozen) body.rotation.y = -h.spin * 1.4;
          body.rotation.z = Math.sin(t * 3 + h.id) * .12;
        }
      }
      if (frozen !== lastHazardFrozen) { hazardMeshes.forEach(g => g.userData.tint(frozen ? iceMat : pinkMat)); lastHazardFrozen = frozen; }

      // Player
      const P = round.player, pp = posOf(P);
      const moving = P.moving && P.stun <= 0;
      player.position.set(wx(pp.x), .34 + (moving ? Math.abs(Math.sin(t * 14)) * .06 : Math.sin(t * 3) * .02), wz(pp.y));
      pBody.scale.set(moving ? 1.05 : 1, moving ? .93 : 1, moving ? 1.05 : 1);
      const f = P.facing || { x: 0, y: 1 };
      facing += angDiff(facing, Math.atan2(f.x, f.y)) * Math.min(1, dt * 16);
      pBody.rotation.y = facing;
      pBody.rotation.z = P.stun > 0 ? Math.sin(t * 20) * .25 : 0;
      player.visible = !(P.invuln > 0 && P.stun <= 0 && Math.floor(t * 12) % 2);
      bubble.visible = P.shield;
      bubble.scale.setScalar(1 + Math.sin(t * 5) * .04);
      magnetAura.visible = P.magnet > 0; magnetAura.material.opacity = .25 + Math.sin(t * 8) * .1;
      boostAura.visible = P.boost > 0;
      stars.forEach((s, i) => {
        s.visible = P.stun > 0;
        const a = t * 7 + i * 2.1;
        s.position.set(Math.cos(a) * .3, .45, Math.sin(a) * .3); s.rotation.y = t * 5;
      });
      if (P.boost > 0 && moving && Math.random() < .5) burst(pp.x, pp.y, "#7CFF6B", 1, .6, .6);

      // Final rush: trims pulse pink
      const pulse = round.rush ? (Math.sin(t * 10) + 1) / 2 : 0;
      trimMat.color.copy(trimBase).lerp(new THREE.Color("#FF3D7F"), pulse);
    } else {
      tokenPool.forEach(g => g.visible = false);
      gem.visible = false; Object.values(powers).forEach(g => g.visible = false);
      player.visible = false;
      trimMat.color.copy(trimBase);
    }

    // Particles
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.vy -= 9 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y = Math.max(.04, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt;
      p.m.rotation.x += dt * 8; p.m.rotation.y += dt * 6;
      p.m.scale.setScalar(p.life / p.max);
    }
    for (const r of rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.life / .6;
      r.m.scale.setScalar(.2 + k * r.size); r.m.material.opacity = 1 - k;
    }

    // Camera: gentle follow + shake
    const follow = round ? posOf(round.player) : { x: (map.cols - 1) / 2, y: (map.rows - 1) / 2 };
    const fx = (wx(follow.x)) * .06, fz = (wz(follow.y)) * .05;
    camera.position.copy(target).addScaledVector(camDir, baseDist);
    camera.position.x += fx; camera.position.z += fz;
    const look = target.clone(); look.x += fx; look.z += fz;
    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      camera.position.x += (Math.random() - .5) * shake * .8;
      camera.position.y += (Math.random() - .5) * shake * .8;
    }
    camera.lookAt(look);
    renderer.render(scene, camera);
  }

  function clearHazards() { hazardMeshes.forEach(g => scene.remove(g)); hazardMeshes.clear(); lastHazardFrozen = false; }

  const v3 = new THREE.Vector3();
  return {
    kind: "3d",
    setMap(m) { clearHazards(); buildArena(m); },
    newRound() { clearHazards(); parts.forEach(p => { p.life = 0; p.m.visible = false; }); },
    setSkin(c) { skinMat.color.set(c); skinMat.emissive.set(c); },
    render, resize, onEvent,
    project(x, y, h = .7) {
      v3.set(wx(x), h, wz(y)).project(camera);
      return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * H };
    },
    dispose() { renderer.dispose(); canvas.remove(); }
  };
}

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
