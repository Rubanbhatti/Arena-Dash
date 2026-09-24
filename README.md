# Arena Dash

A 60-second arcade game for live events. Players scan a QR code, enter a name, collect tokens and dodge spinners on their phone, and their best score goes onto a shared live leaderboard.

- `index.html` is the game (phones, tablets, desktop).
- `leaderboard.html` is the big-screen leaderboard for a TV or projector, with a QR code and CSV export.
- `config.js` holds the event name, round length, point values and your Firebase keys.

Out of the box the game runs in **test mode**: scores are saved only on the device that played. Follow part 2 to make the leaderboard shared across everyone.

## 1. Put it on GitHub Pages

1. Create a new public repository on GitHub, for example `arena-dash`.
2. Upload every file and the `js` folder to the repository root (drag and drop on the repo page, then **Commit changes**). Keep the empty `.nojekyll` file.
3. Open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute your game is live at `https://YOUR-USERNAME.github.io/arena-dash/` and the big screen at `https://YOUR-USERNAME.github.io/arena-dash/leaderboard.html`.

## 2. Turn on the shared leaderboard (Firebase, free tier)

GitHub Pages only serves files, so the scores live in Firebase Firestore.

1. Go to <https://console.firebase.google.com>, click **Create a project**, and follow the steps (Google Analytics is optional).
2. **Build → Firestore Database → Create database.** Pick a location near your event and start in **production mode**.
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.** Players don't sign in themselves; this just gives each phone an ID so the rules can rate-limit submissions.
4. Still in Authentication, open **Settings → Authorized domains** and add `YOUR-USERNAME.github.io`.
5. **Firestore Database → Rules**: delete what's there, paste the contents of `firestore.rules`, and click **Publish**.
6. **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app (no hosting needed) and copy the `firebaseConfig` values into the `firebase` block of `config.js`.
7. Commit the updated `config.js` to GitHub. Wait a minute, reload the game, and the yellow "Test mode" note disappears.

The Firebase web keys in `config.js` are meant to be public; the security rules are what protect the data.

## Event-day checklist

- Set `eventName`, `eventSubtitle`, `roundSeconds` and `maxAttemptsPerName` in `config.js`.
- Play a few test rounds on two or three different Android phones and an iPhone.
- **Reset the board before doors open:** Firestore Database → Data → delete the `best`, `scores` and `limits` collections.
- Open `leaderboard.html` on the display PC and press F11 for full screen. It shows a QR code that points to the game.
- Print that QR code (or generate one for your game URL) for signage.

## Running the event

| Task | How |
| --- | --- |
| Close the game after the event | Firestore → Data → **Start collection** `config`, document ID `event`, field `enabled` (boolean) = `false`. New scores are rejected and players see an "event has ended" screen. Set it back to `true` to reopen. |
| Remove a fake or offensive entry | Firestore → Data → `best` → select the document → delete. |
| Export results | Open `leaderboard.html` and click **Download CSV**. |
| Change round length or points | Edit `config.js` and commit. If you make rounds much longer, raise `maxScore()` in `firestore.rules`. |

## How the leaderboard works

Each finished round writes three things in one atomic batch: a private round record in `scores`, a timestamp in `limits`, and, if it beats the player's previous best, an entry in `best`. The public board reads `best`, so each player appears once with their top score. Ties go to whoever reached the score first. Players are identified by phone plus name, so several people can share one kiosk tablet.

The rules reject malformed data, names over 16 characters, scores above the cap, edits or deletions of existing scores, and more than one submission per phone every 45 seconds. Like every browser game, a determined person with developer tools could still fake a plausible score, so if there's a prize, check the winners' entries in the `scores` collection (token, gem and hit counts) before announcing.

## Controls

- **Phone:** the on-screen arrow pad (you can slide your thumb between arrows), or swipe on the arena. The game goes full screen, locks to portrait and keeps the screen awake on Android.
- **Desktop:** arrow keys or WASD. P or Esc pauses.

Players can also use Chrome's **Add to Home screen** to launch it like an app.

## Free-tier capacity

Firestore's free tier allows 50,000 reads and 20,000 writes per day. Each round costs up to 3 writes and a few reads; each leaderboard view reads up to 50 entries plus 1 per change while open. That comfortably covers a few hundred players. For thousands of players, switch the Firebase project to the pay-as-you-go Blaze plan (still very cheap at this scale).

## Files

```
index.html          game page
leaderboard.html    big-screen leaderboard
style.css           styles
config.js           event settings + Firebase keys
js/game.js          game engine, controls, screens
js/board.js         leaderboard storage (Firebase or local test mode)
firestore.rules     database security rules
manifest.webmanifest, icon.svg   home-screen icon
```
