// Pool logic with no DOM access: teams, parsing, ESPN results, and scoring.
//
// Data shape (same in Firebase and localStorage):
//   players/{playerId}           { name, n }            n = sort order
//   games/w{week}/{AWAY@HOME}    { a, h, n, kickoff?, espn?, w?, fin?, as?, hs?, detail? }
//   picks/w{week}/{AWAY@HOME}/{playerId}   "TEAM"
//   locked/w{week}               true   every pick in the week is locked
//   late/w{week}                 true   picks stay open after kickoff
// Week keys are prefixed with "w" so Firebase never turns them into arrays.

export const WEEKS = 18;

export const TEAMS = {
  ARI: ["Arizona", "Cardinals"], ATL: ["Atlanta", "Falcons"], BAL: ["Baltimore", "Ravens"],
  BUF: ["Buffalo", "Bills"], CAR: ["Carolina", "Panthers"], CHI: ["Chicago", "Bears"],
  CIN: ["Cincinnati", "Bengals"], CLE: ["Cleveland", "Browns"], DAL: ["Dallas", "Cowboys"],
  DEN: ["Denver", "Broncos"], DET: ["Detroit", "Lions"], GB: ["Green Bay", "Packers"],
  HOU: ["Houston", "Texans"], IND: ["Indianapolis", "Colts"], JAX: ["Jacksonville", "Jaguars"],
  KC: ["Kansas City", "Chiefs"], LAC: ["Los Angeles", "Chargers"], LAR: ["Los Angeles", "Rams"],
  LV: ["Las Vegas", "Raiders"], MIA: ["Miami", "Dolphins"], MIN: ["Minnesota", "Vikings"],
  NE: ["New England", "Patriots"], NO: ["New Orleans", "Saints"], NYG: ["New York", "Giants"],
  NYJ: ["New York", "Jets"], PHI: ["Philadelphia", "Eagles"], PIT: ["Pittsburgh", "Steelers"],
  SEA: ["Seattle", "Seahawks"], SF: ["San Francisco", "49ers"], TB: ["Tampa Bay", "Buccaneers"],
  TEN: ["Tennessee", "Titans"], WSH: ["Washington", "Commanders"]
};

const ABBR_FIX = { WAS: "WSH", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" };
export const normAbbr = ab => {
  const up = String(ab || "").toUpperCase();
  return ABBR_FIX[up] || up;
};
export const nick = ab => (TEAMS[ab] ? TEAMS[ab][1] : ab);
export const wk = w => "w" + w;
export const gameKey = g => g.a + "@" + g.h;

/* ---------------- typed games ---------------- */

// [regex, alias length, team]; longest aliases first so "kansas city" beats "kc".
const ALIASES = (() => {
  const cityCount = {};
  Object.values(TEAMS).forEach(([city]) => { cityCount[city] = (cityCount[city] || 0) + 1; });
  const list = [["WAS", "WSH"], ["JAC", "JAX"]];
  for (const [ab, [city, name]] of Object.entries(TEAMS)) {
    list.push([ab, ab], [name, ab]);
    if (cityCount[city] === 1) list.push([city, ab]);
  }
  return list
    .map(([alias, ab]) => [new RegExp("\\b" + alias.toLowerCase().replace(/ /g, "\\s+") + "\\b"), alias.length, ab])
    .sort((x, y) => y[1] - x[1]);
})();

// "Bills at Ravens", "BUF @ BAL", "Buffalo vs Baltimore" -> { a: "BUF", h: "BAL" }
export function parseLine(line) {
  const s = line.toLowerCase(), found = [];
  for (const [re, , ab] of ALIASES) {
    if (found.some(f => f.ab === ab)) continue;
    const m = re.exec(s);
    if (!m) continue;
    const i = m.index, end = i + m[0].length;
    if (found.some(f => i < f.end && end > f.i)) continue;
    found.push({ ab, i, end });
  }
  if (found.length !== 2) return null;
  found.sort((x, y) => x.i - y.i);
  return { a: found[0].ab, h: found[1].ab };
}

export function parseGames(text) {
  const seen = new Set(), out = [];
  for (const line of text.split("\n")) {
    const g = parseLine(line);
    if (!g || seen.has(gameKey(g))) continue;
    seen.add(gameKey(g));
    out.push(g);
  }
  return out;
}

/* ---------------- ESPN ---------------- */

export const espnUrl = (season, week) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`;

export function parseEspn(json) {
  const out = [];
  for (const e of json?.events || []) {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find(t => t.homeAway === "home");
    const away = c?.competitors?.find(t => t.homeAway === "away");
    if (!home || !away) continue;
    const a = normAbbr(away.team?.abbreviation), h = normAbbr(home.team?.abbreviation);
    if (!TEAMS[a] || !TEAMS[h]) continue;
    const st = e.status?.type || {};
    const state = st.state || "pre";
    const as = state === "pre" ? null : Number(away.score) || 0;
    const hs = state === "pre" ? null : Number(home.score) || 0;
    const fin = !!st.completed;
    let w = null;
    if (fin) w = away.winner ? a : home.winner ? h : as > hs ? a : hs > as ? h : "TIE";
    out.push({
      key: a + "@" + h, a, h, espn: String(e.id), kickoff: Date.parse(e.date) || null,
      state, detail: st.shortDetail || "", as, hs, fin, w
    });
  }
  return out.sort((x, y) => (x.kickoff || 0) - (y.kickoff || 0));
}

/* ---------------- reading the pool ---------------- */

export function playerList(pool) {
  return Object.entries(pool.players || {})
    .filter(([, p]) => p && typeof p.name === "string")
    .map(([id, p]) => ({ id, name: p.name, n: p.n || 0 }))
    .sort((x, y) => x.n - y.n || x.name.localeCompare(y.name));
}

export function weekGames(pool, w) {
  return Object.entries(pool.games?.[wk(w)] || {})
    .filter(([, g]) => g && TEAMS[g.a] && TEAMS[g.h])
    .map(([key, g]) => ({ ...g, key }))
    .sort((x, y) => (x.n ?? 0) - (y.n ?? 0) || (x.kickoff || 0) - (y.kickoff || 0) || x.key.localeCompare(y.key));
}

export const pickOf = (pool, w, key, pid) => pool.picks?.[wk(w)]?.[key]?.[pid] || "";
export const isDecided = g => !!g.w && (g.w === g.a || g.w === g.h);
export function firstKickoff(pool, w) {
  const times = weekGames(pool, w).map(g => g.kickoff).filter(Boolean);
  return times.length ? Math.min(...times) : null;
}

// mode "first-game": the whole week locks at its first kickoff.
// mode "each-game": each game locks at its own kickoff.
// A manual week lock always wins; late picks turn kickoff locks off.
export function isLocked(pool, w, g, now = Date.now(), mode = "first-game") {
  if (pool.locked?.[wk(w)]) return true;
  if (pool.late?.[wk(w)]) return false;
  const at = mode === "each-game" ? g.kickoff : firstKickoff(pool, w);
  return !!at && now >= at;
}

// Season standings. A missed pick counts as wrong. A week winner is awarded
// only once every game that week has a result.
export function standings(pool) {
  const rows = playerList(pool).map(p => ({ ...p, correct: 0, decided: 0, weekWins: 0, weeks: {} }));
  const weeks = [];
  for (let w = 1; w <= WEEKS; w++) {
    const games = weekGames(pool, w);
    if (!games.length) continue;
    const done = games.filter(isDecided);
    const complete = games.every(g => g.w);
    let best = 0;
    for (const r of rows) {
      const c = done.filter(g => pickOf(pool, w, g.key, r.id) === g.w).length;
      r.weeks[w] = c;
      r.correct += c;
      r.decided += done.length;
      best = Math.max(best, c);
    }
    const winners = complete && best > 0 ? rows.filter(r => r.weeks[w] === best).map(r => r.id) : [];
    rows.forEach(r => { if (winners.includes(r.id)) r.weekWins++; });
    weeks.push({ week: w, games: games.length, final: games.filter(g => g.w).length, decided: done.length, complete, best, winners });
  }
  rows.sort((x, y) => y.correct - x.correct || y.weekWins - x.weekWins || x.name.localeCompare(y.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.correct === r.correct && prev.weekWins === r.weekWins ? prev.rank : i + 1;
  });
  return { rows, weeks };
}

/* ---------------- writing (local mode) ---------------- */

// Applies a Firebase-style multi-path update: "a/b/c": value, null deletes,
// and parents left empty are removed.
export function applyUpdate(root, paths) {
  for (const [path, value] of Object.entries(paths)) {
    const parts = path.split("/").filter(Boolean);
    const last = parts.pop();
    const chain = [root];
    let node = root;
    for (const p of parts) {
      if (typeof node[p] !== "object" || node[p] === null) {
        if (value === null) { node = null; break; }
        node[p] = {};
      }
      node = node[p];
      chain.push(node);
    }
    if (!node || last === undefined) continue;
    if (value === null || value === undefined) delete node[last];
    else node[last] = JSON.parse(JSON.stringify(value));
    for (let i = parts.length - 1; i >= 0; i--) {
      if (Object.keys(chain[i + 1]).length) break;
      delete chain[i][parts[i]];
    }
  }
  return root;
}
