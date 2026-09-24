/*
 * ARENA DASH — event settings
 * Edit this file before the event. Everything else can stay as-is.
 */
window.ARENA_CONFIG = {
  // Branding
  eventName: "Arena Dash",
  eventSubtitle: "Collect tokens, dodge the spinners, top the board.",

  // Local on/off switch. For a remote switch, use the config/event document
  // in Firestore (see README) — that one works without redeploying.
  enabled: true,

  // Gameplay rules
  roundSeconds: 60,
  maxAttemptsPerName: 0,        // 0 = unlimited replays (checked per device)
  points: { coin: 10, gem: 40, hitPenalty: 10 },

  // Label shown on the name field
  nameLabel: "Your name or participant ID",

  // Firebase project settings (Project settings → General → Your apps → Web app).
  // Leave apiKey empty to run in local test mode (scores stay on this device only).
  firebase: {
    apiKey: "AIzaSyAhE_si2BKgyt4BgtdZz5otVODnGwBQb8Y",
  authDomain: "arena-dash-9f3b3.firebaseapp.com",
  projectId: "arena-dash-9f3b3",
  storageBucket: "arena-dash-9f3b3.firebasestorage.app",
  messagingSenderId: "842610119088",
  appId: "1:842610119088:web:1373560419814d404d0675",
  measurementId: "G-S2WB34F2N2"
  }
};
