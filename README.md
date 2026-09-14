# nfl_prediction

NFL pick'em pool for friends and family. Everyone picks a winner for each game, picks lock when the week's first game kicks off, and the site keeps the season record.

- **Picks**: one grid per week, one column per player. Load a week's games from ESPN with one click, or type them in.
- **Locks**: every pick for the week locks when its first game kicks off. You can switch to locking each game at its own kickoff in `config.js`.
- **Hidden picks**: until you've picked every open game, you only see whether other players have picked, not what they picked.
- **Automatic results**: ESPN games get marked final when they end. You can still set or fix a winner by clicking a team name.
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

- **Pick as yourself**: choose your name under **Picking as**, above the grid. Each browser remembers the choice. Only your own column has menus; to enter picks for someone else, switch to their name. If no name is chosen, the first player you add becomes you.
- **Add players** at the bottom of the Picks tab. Click a name to rename it, or ✕ to remove it and all of their picks.
- **Load games**: on an empty week, click **Load week N from ESPN**. **Edit games** lets you add, remove, or type matchups one per line ("Bills at Ravens", "BUF @ BAL").
- **Locks**: with `LOCK_AT = "first-game"` in `config.js` (the default), every pick for the week locks when its first game kicks off, usually Thursday night. Set `LOCK_AT = "each-game"` to lock each game at its own kickoff instead.
- **Hidden picks**: other players' columns show only "✓ Picked" or "Not yet" for games that haven't locked, until you've picked every open game. After that, or once games lock, everyone's picks show. You can still change your picks until they lock.
- **Results** fill in on their own for ESPN games while anyone has the site open, including catching up on older weeks. Click a team name to set or clear a winner by hand; a winner you set by hand is never overwritten.
- **Lock week** locks every pick in the week right away. It's most useful for games you typed in without kickoff times.
- **Allow late picks** reopens a week after kickoff, for picks people made beforehand but didn't enter yet. It applies to everyone, so click **Stop late picks** when you're done.
- **More than one pool**: add `?pool=name` to the link, e.g. `https://sngjyoon.github.io/nfl_prediction/?pool=family`. Each name is a separate pool.
- **New season**: change `SEASON` and `WEEK1_START` in `config.js`. Each season starts a fresh board; old seasons stay in the database.

## Backups

**Download backup** saves the pool as a JSON file. **Restore backup** replaces the pool with a file you saved earlier. The free Firebase plan has no undo, so download a backup every few weeks.

## Good to know

- Picking as a name, hidden picks, and locks all run in the browser, so they work on trust. Anyone with the link can choose any player's name, turn on late picks, or see hidden picks by downloading a backup or using the browser's developer tools. Making that airtight would need Google sign-in tied to each player plus stricter database rules.
- To limit abuse of your Firebase project, restrict the API key to your GitHub Pages domain in Google Cloud Console → APIs & Services → Credentials.
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
| `pool.js` | Teams, game parsing, ESPN parsing, locks, scoring |
| `config.js` | Firebase config, season, and lock settings |
| `database.rules.json` | Firebase Realtime Database security rules |
