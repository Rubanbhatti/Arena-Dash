// Leaderboard storage. Uses Firebase (shared, online) when configured,
// otherwise a local test board saved in this browser only.

const FB_VERSION = "10.12.2";
const FB_BASE = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;

// Turns a display name into a stable, Firestore-safe key.
export function nameKey(name) {
  return Array.from(name.trim().toLowerCase())
    .map(c => (/[a-z0-9]/.test(c) ? c : "-" + c.codePointAt(0).toString(36)))
    .join("")
    .slice(0, 60) || "player";
}

export function newAttemptId() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, b => abc[b % abc.length]).join("");
}

export function createBoard(cfg) {
  const fb = cfg.firebase || {};
  return fb.apiKey && fb.projectId ? firebaseBoard(fb) : localBoard();
}

/* ---------------- Firebase (online, shared) ---------------- */
function firebaseBoard(fbConfig) {
  let fs, db, uid;
  let readyP = null;

  const init = async () => {
    const [appMod, fsMod, authMod] = await Promise.all([
      import(FB_BASE + "firebase-app.js"),
      import(FB_BASE + "firebase-firestore.js"),
      import(FB_BASE + "firebase-auth.js")
    ]);
    const app = appMod.initializeApp(fbConfig);
    fs = fsMod;
    db = fs.getFirestore(app);
    const auth = authMod.getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) await authMod.signInAnonymously(auth);
    uid = auth.currentUser.uid;
  };
  // Retries the connection on the next call if it failed (e.g. no signal).
  const ready = () => readyP || (readyP = init().catch(e => { readyP = null; throw e; }));

  const bestCol = () => fs.collection(db, "best");

  return {
    mode: "online",
    ready,

    async isOpen() {
      await ready();
      const snap = await fs.getDoc(fs.doc(db, "config", "event"));
      return !snap.exists() || snap.data().enabled !== false;
    },

    async submit(r) {
      await ready();
      const key = nameKey(r.name);
      const bestRef = fs.doc(db, "best", `${uid}_${key}`);
      const prevSnap = await fs.getDoc(bestRef);
      const prevBest = prevSnap.exists() ? prevSnap.data().score : -1;

      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, "scores", r.attemptId), {
        name: r.name, score: r.score, coins: r.coins, gems: r.gems, hits: r.hits,
        uid, createdAt: fs.serverTimestamp()
      });
      batch.set(fs.doc(db, "limits", uid), { last: fs.serverTimestamp() });
      const improved = r.score > prevBest;
      if (improved) {
        batch.set(bestRef, {
          name: r.name, key, score: r.score, uid, attemptId: r.attemptId,
          updatedAt: fs.serverTimestamp()
        });
      }
      await batch.commit();

      const best = Math.max(prevBest, r.score);
      let rank = null, total = null;
      try {
        const [above, all] = await Promise.all([
          fs.getCountFromServer(fs.query(bestCol(), fs.where("score", ">", best))),
          fs.getCountFromServer(bestCol())
        ]);
        rank = above.data().count + 1;
        total = all.data().count;
      } catch (e) { console.warn("Rank lookup failed", e); }
      return { best, improved, rank, total, myId: `${uid}_${key}` };
    },

    // Live updates: cb(rows) on every change, onErr(error) on failure.
    subscribe(cb, onErr, n = 50) {
      let unsub = () => {};
      let cancelled = false;
      ready().then(() => {
        if (cancelled) return;
        const q = fs.query(bestCol(), fs.orderBy("score", "desc"), fs.limit(n));
        unsub = fs.onSnapshot(q, snap => {
          cb(sortRows(snap.docs.map(d => rowFrom(d.id, d.data()))));
        }, onErr);
      }).catch(onErr);
      return () => { cancelled = true; unsub(); };
    },

    async fetchAll(n = 1000) {
      await ready();
      const q = fs.query(bestCol(), fs.orderBy("score", "desc"), fs.limit(n));
      const snap = await fs.getDocs(q);
      return sortRows(snap.docs.map(d => rowFrom(d.id, d.data())));
    },

    myIdFor(name) { return uid ? `${uid}_${nameKey(name)}` : null; }
  };
}

function rowFrom(id, d) {
  const t = d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : Date.now();
  return { id, name: d.name, score: d.score, time: t };
}

// Ties go to whoever reached the score first.
function sortRows(rows) {
  return rows.sort((a, b) => b.score - a.score || a.time - b.time);
}

/* ---------------- Local test mode (this device only) ---------------- */
function localBoard() {
  const KEY = "arenaDash.localBoard.v1";
  const listeners = new Set();

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const save = data => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  };
  const rows = () => sortRows(Object.entries(load()).map(([id, d]) => ({ id, ...d })));
  const emit = () => { const r = rows(); listeners.forEach(fn => fn(r.slice(0, 50))); };

  window.addEventListener("storage", e => { if (e.key === KEY) emit(); });

  return {
    mode: "local",
    ready: () => Promise.resolve(),
    async isOpen() { return true; },

    async submit(r) {
      const data = load();
      const id = "local_" + nameKey(r.name);
      const prev = data[id];
      const improved = !prev || r.score > prev.score;
      if (improved) data[id] = { name: r.name, score: r.score, time: Date.now() };
      save(data);
      emit();
      const all = rows();
      const best = data[id].score;
      return {
        best, improved,
        rank: all.filter(x => x.score > best).length + 1,
        total: all.length,
        myId: id
      };
    },

    subscribe(cb, _onErr, n = 50) {
      const fn = r => cb(r.slice(0, n));
      listeners.add(fn);
      fn(rows());
      return () => listeners.delete(fn);
    },

    async fetchAll() { return rows(); },
    myIdFor(name) { return "local_" + nameKey(name); }
  };
}
