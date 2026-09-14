# nfl_prediction

NFL pick'em pool for friends and family. Everyone picks a winner for each game, picks lock at kickoff, and the site keeps the season record.

- **Picks**: one grid per week, one column per player. Load a week's games from ESPN with one click, or type them in.
- **Automatic results**: games loaded from ESPN lock at kickoff and get marked final when they end. You can still set or fix a winner by clicking a team name.
- **Standings**: season leaderboard (correct picks, win %, week wins) and a week-by-week record.
- **Shared storage**: with Firebase set up, everyone who opens the link sees the same pool, live.
- **Backups**: download the whole pool as JSON and restore it any time.

## 1. Publish on GitHub Pages

1. Push this repo to GitHub. The repo must be public on a free GitHub plan.
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, pick **Deploy from a branch**, choose `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://sngjyoon.github.io/nfl_prediction/`.

Without step 2 below the site runs in **local mode**: it works, but each visitor's picks are saved only in their own browser. The footer says "Local mode" when that's the case.

## 2. Turn on shared storage (Firebase, free)

1. Go to <https://console.firebase.google.com>, click **Create a project**, and follow the prompts (Google Analytics is not needed).
2. **Build → Realtime Database → Create Database.** Pick a location and start in **locked mode**.
3. In the database's **Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json) and click **Publish**.
4. **Build → Authentication → Get started → Sign-in method**, enable **Anonymous**, and save.
5. **Project settings (gear icon) → General → Your apps**, click the web icon `</>`, register an app (no hosting needed), and copy the `firebaseConfig` object it shows.
6. Paste it into [`config.js`](config.js) as `FIREBASE_CONFIG`. Make sure it includes `databaseURL`; if it doesn't, copy the URL shown at the top of the Realtime Database page.
7. Commit and push. The footer should now say "Live".

The Firebase web config is meant to be public. The database rules only let signed-in visitors (the site signs everyone in anonymously) read and write pools, and they check the shape of the data.

## Using the site

- **Add players** at the bottom of the Picks tab. Click a name to rename it, or ✕ to remove it and all of their picks.
- **Load games**: on an empty week, click **Load week N from ESPN**. **Edit games** lets you add, remove, or type matchups one per line ("Bills at Ravens", "BUF @ BAL").
- **Results** fill in on their own for ESPN games while anyone has the site open, including catching up on older weeks. Click a team name to set or clear a winner by hand; a winner you set by hand is never overwritten.
- **Lock week** locks every pick in the week, which is useful for games you typed in without kickoff times.
- **Allow late picks** reopens a week's games after kickoff, for picks people made beforehand but didn't enter yet. It applies to everyone, so click **Lock at kickoff** when you're done. If you already use Firebase, re-publish `database.rules.json` so the setting can be saved.
- **More than one pool**: add `?pool=name` to the link, e.g. `https://sngjyoon.github.io/nfl_prediction/?pool=family`. Each name is a separate pool.
- **New season**: change `SEASON` and `WEEK1_START` in `config.js`. Each season starts a fresh board; old seasons stay in the database.

## Backups

**Download backup** saves the pool as a JSON file. **Restore backup** replaces the pool with a file you saved earlier. The free Firebase plan has no undo, so download a backup every few weeks.

## Good to know

- Anyone with the link can make picks for anyone and edit games. That's fine for friends and family, but don't treat it as secure. To limit abuse of your Firebase project, restrict the API key to your GitHub Pages domain in Google Cloud Console → APIs & Services → Credentials.
- Schedules and scores come from ESPN's public scoreboard feed, which is unofficial and could change. If it stops working, type games in and click team names to mark winners.
- Scoring: one point per correct pick. A missed pick counts as wrong. A tie counts for no one and isn't counted as a game. Week winners are awarded once every game that week has a result.

## Run it locally

The site uses JavaScript modules, so open it through a local web server rather than double-clicking the file:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout |
| `style.css` | Styles |
| `app.js` | UI, storage (Firebase or localStorage), ESPN sync |
| `pool.js` | Teams, game parsing, ESPN parsing, scoring |
| `config.js` | Firebase config and season settings |
| `database.rules.json` | Firebase Realtime Database security rules |
