// Pick'em pool UI. Data lives in Firebase Realtime Database when config.js has
// a Firebase config, otherwise in this browser's localStorage.
import { FIREBASE_CONFIG, SEASON, WEEK1_START, POOL_TITLE } from "./config.js";
import {
  WEEKS, nick, wk, gameKey, parseGames, espnUrl, parseEspn,
  playerList, weekGames, pickOf, isLocked, isDecided, standings, applyUpdate
} from "./pool.js";

const FIREBASE_VERSION = "12.19.0";
const MINUTE = 60e3;
const HOUR = 60 * MINUTE;

const params = new URLSearchParams(location.search);
const POOL_ID = (params.get("pool") || "main").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "main";
const DB_PATH = `pools/${SEASON}-${POOL_ID}`;
const USE_FIREBASE = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
// Weeks roll over Tuesday morning, after Monday Night Football.
const week1 = Date.parse(WEEK1_START + "T10:00:00Z");
const guessWeek = () => clamp(Math.floor((Date.now() - week1) / (7 * 24 * HOUR)) + 1, 1, WEEKS);

let pool = {};
let loaded = false;
let fatal = "";
let store = null;
let conn = "connecting", connNote = "";
let week = guessWeek();
let tab = location.hash === "#standings" ? "standings" : "picks";
let editing = false;
let boardStale = false;
let lockSig = "";
const live = {};       // week -> { gameKey: latest ESPN game }, for display only
const lastFetch = {};  // week -> time of the last ESPN fetch

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cleanName = s => String(s || "").trim().replace(/\s+/g, " ").slice(0, 20);

/* ---------------- storage ---------------- */

async function localStore(onData) {
  const key = "pickem:" + DB_PATH;
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
  let data = read();
  const emit = () => onData(structuredClone(data));
  const save = () => { try { localStorage.setItem(key, JSON.stringify(data)); } catch {} emit(); };
  addEventListener("storage", e => { if (e.key === key) { data = read(); emit(); } });
  setTimeout(emit);
  setConn("local");
  return {
    update: async paths => { applyUpdate(data, paths); save(); },
    replace: async next => { data = structuredClone(next); save(); }
  };
}

async function firebaseStore(onData) {
  const cdn = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [{ initializeApp }, { getDatabase, ref, onValue, update, set }, { getAuth, signInAnonymously }] =
    await Promise.all(["app", "database", "auth"].map(m => import(`${cdn}firebase-${m}.js`)));
  const app = initializeApp(FIREBASE_CONFIG);
  await signInAnonymously(getAuth(app));
  const db = getDatabase(app);
  const root = ref(db, DB_PATH);
  onValue(ref(db, ".info/connected"), s => setConn(s.val() ? "live" : conn === "live" ? "offline" : "connecting"));
  onValue(root, s => onData(s.val() || {}), err => {
    console.error(err);
    fatal = "The database rules blocked reading the pool. In Firebase, open Realtime Database > Rules and publish database.rules.json.";
    setConn("error", "Database rules blocked access");
    render();
  });
  return { update: paths => update(root, paths), replace: next => set(root, next) };
}

function onData(data) {
  pool = data && typeof data === "object" ? data : {};
  loaded = true;
  render();
  if (store) autoSync();
}

function write(paths) {
  const fail = e => {
    console.error(e);
    toast(/permission/i.test(String(e?.code || e?.message)) ? "Not saved: blocked by database rules" : "Not saved: " + (e?.message || e), true);
  };
  if (!store) return;
  try { Promise.resolve(store.update(paths)).catch(fail); } catch (e) { fail(e); }
}

/* ---------------- ESPN sync ---------------- */

// Fetches a week from ESPN. Stores kickoff times and final results for games
// already in the pool; with importNew, also adds games the pool doesn't have.
// A result set by hand (fin: true) is never overwritten.
async function syncWeek(w, importNew = false) {
  lastFetch[w] = Date.now();
  const res = await fetch(espnUrl(SEASON, w), { cache: "no-store" });
  if (!res.ok) throw new Error("ESPN responded " + res.status);
  const list = parseEspn(await res.json());
  live[w] = Object.fromEntries(list.map(g => [g.key, g]));

  const cur = pool.games?.[wk(w)] || {};
  const paths = {};
  let n = Object.keys(cur).length;
  for (const g of list) {
    const base = `games/${wk(w)}/${g.key}`;
    const c = cur[g.key];
    if (!c) {
      if (!importNew) continue;
      const rec = { a: g.a, h: g.h, n: n++, espn: g.espn };
      if (g.kickoff) rec.kickoff = g.kickoff;
      if (g.fin) Object.assign(rec, { fin: true, w: g.w, as: g.as, hs: g.hs, detail: g.detail });
      paths[base] = rec;
      continue;
    }
    if (c.espn !== g.espn) paths[base + "/espn"] = g.espn;
    if ((c.kickoff || null) !== g.kickoff) paths[base + "/kickoff"] = g.kickoff;
    if (g.fin && !c.fin) {
      Object.assign(paths, {
        [base + "/fin"]: true, [base + "/w"]: g.w,
        [base + "/as"]: g.as, [base + "/hs"]: g.hs, [base + "/detail"]: g.detail
      });
    }
  }
  if (Object.keys(paths).length) write(paths);
  render();
  return list.length;
}

// Keeps results current without anyone pressing a button: the week on screen
// refreshes every minute while games are being played (every 15 minutes
// otherwise), and older weeks with missing results are filled in.
let syncBusy = false;
async function autoSync() {
  if (!loaded || !store || fatal || syncBusy || document.hidden) return;
  syncBusy = true;
  try {
    const now = Date.now();
    for (let w = 1; w <= WEEKS; w++) {
      const open = weekGames(pool, w).filter(g => !g.fin);
      if (!open.length) continue;
      const since = now - (lastFetch[w] || 0);
      const inPlay = open.some(g => g.kickoff && g.kickoff <= now);
      const due = w === week && tab === "picks"
        ? since > (inPlay ? MINUTE : 15 * MINUTE)
        : open.some(g => g.kickoff && g.kickoff <= now - 4 * HOUR) && since > 15 * MINUTE;
      if (due) await syncWeek(w).catch(e => console.warn("ESPN sync failed for week " + w, e));
    }
  } finally {
    syncBusy = false;
  }
}

async function importEspn() {
  toast(`Loading week ${week} from ESPN…`);
  try {
    const n = await syncWeek(week, true);
    editing = false;
    toast(n ? `Week ${week}: ${n} games loaded from ESPN` : `ESPN doesn't list week ${week} games yet`, !n);
  } catch (e) {
    console.error(e);
    toast("Couldn't reach ESPN. Try again or enter games by hand.", true);
  }
  render();
}

/* ---------------- render ---------------- */

const CONN_TEXT = {
  connecting: "Connecting…",
  live: "Live · everyone with the link sees the same pool",
  offline: "Offline · changes will sync when you reconnect",
  local: "Local mode · saved in this browser only, so others won't see it (see README)",
  error: "Error"
};

function setConn(state, note = "") {
  conn = state;
  connNote = note;
  $("conn").innerHTML = `<span class="dot ${state}"></span>${esc(note || CONN_TEXT[state])}`;
}

function render() {
  const onPicks = tab === "picks";
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("weekNav").hidden = !onPicks;
  $("bar").hidden = !onPicks;
  $("addRow").hidden = !onPicks || !loaded;
  $("editor").hidden = !onPicks || !editing;
  if (onPicks) renderBar();

  // Don't rebuild the grid under an open pick menu; catch up once it loses focus.
  if (document.activeElement?.matches("#board select")) { boardStale = true; return; }
  boardStale = false;
  $("board").innerHTML = fatal ? emptyHtml("Couldn't load the pool", fatal)
    : !loaded ? emptyHtml("Loading…", "")
    : onPicks ? picksHtml() : standingsHtml();
}

function renderBar() {
  const games = weekGames(pool, week);
  const weekLocked = !!pool.locked?.[wk(week)];
  const late = !!pool.late?.[wk(week)];
  const timed = games.some(g => g.kickoff);
  let s = !loaded ? "Loading…" : !games.length ? "No games yet" : `${games.length} games · ${games.filter(g => g.w).length} final`;
  if (games.length) s += weekLocked ? " · week locked" : late ? " · late picks allowed" : timed ? " · picks lock at kickoff" : "";
  $("status").textContent = s;
  $("lateBtn").hidden = !timed || weekLocked;
  $("lateBtn").textContent = late ? "Lock at kickoff" : "Allow late picks";
  $("lateBtn").classList.toggle("on", late);
  $("lockBtn").hidden = !games.length;
  $("lockBtn").textContent = weekLocked ? "Unlock week" : "Lock week";
  $("editBtn").hidden = !loaded || !!fatal;
  $("weekSel").value = String(week);
  $("prev").disabled = week <= 1;
  $("next").disabled = week >= WEEKS;
}

const emptyHtml = (title, text, extra = "") =>
  `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}${extra}</div>`;

const fmtKick = ms => new Date(ms).toLocaleString(undefined,
  { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

function gameMeta(g, locked) {
  const L = live[week]?.[g.key];
  const score = (as, hs) => (as != null && hs != null ? ` · ${g.a} ${as}–${hs} ${g.h}` : "");
  if (g.fin) return esc(g.detail || "Final") + score(g.as, g.hs);
  if (L?.state === "in") return `<span class="live">Live</span> ${esc(L.detail)}${score(L.as, L.hs)}`;
  if (L?.state === "post") return esc(L.detail || "Final") + score(L.as, L.hs);
  if (g.kickoff) return (locked ? "Locked · " : "") + esc(fmtKick(g.kickoff));
  return locked ? "Locked" : "";
}

const teamBtn = (g, t) =>
  `<button class="team${g.w === t ? " win" : ""}" data-win="${esc(g.key)}|${t}" ` +
  `title="${g.w === t ? "Clear result" : `Mark ${nick(t)} as the winner`}">${nick(t)}</button>`;

function picksHtml() {
  const games = weekGames(pool, week);
  const people = playerList(pool);
  lockSig = games.map(g => (isLocked(pool, week, g) ? 1 : 0)).join("");

  if (!games.length) {
    return emptyHtml(`Week ${week} has no games yet`,
      "Load the schedule from ESPN for kickoff locks and automatic results, or type the matchups in.",
      `<div class="empty-acts"><button class="btn" data-act="espn">Load week ${week} from ESPN</button>` +
      `<button class="btn ghost" data-act="edit">Enter games by hand</button></div>`);
  }

  const { rows } = standings(pool);
  const season = Object.fromEntries(rows.map(r => [r.id, r]));
  const leader = rows.length && rows[0].correct > 0 ? rows[0].correct : null;
  const decided = games.filter(isDecided).length;
  const filler = people.length ? "" : "<td></td>";

  let head = `<tr><th class="mc">Week ${week}</th>`;
  for (const p of people) {
    head += `<th><button class="who" data-rename="${esc(p.id)}" title="Rename ${esc(p.name)}">${esc(p.name)}</button>` +
      `<button class="rm" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">&#10005;</button></th>`;
  }
  if (!people.length) head += `<th class="hint">Add a player below to start picking</th>`;
  head += "</tr>";

  let body = "";
  for (const g of games) {
    const locked = isLocked(pool, week, g);
    body += `<tr><td class="mc"><div class="matchup">${teamBtn(g, g.a)}<span class="at">at</span>${teamBtn(g, g.h)}</div>` +
      `<span class="meta">${gameMeta(g, locked)}</span></td>`;
    for (const p of people) {
      const pick = pickOf(pool, week, g.key, p.id);
      const cls = isDecided(g) && pick ? (pick === g.w ? " hit" : " miss") : "";
      body += `<td><select class="pick${cls}" data-pick="${esc(g.key)}|${esc(p.id)}" ` +
        `aria-label="${esc(p.name)}: ${nick(g.a)} at ${nick(g.h)}"${locked ? " disabled" : ""}>` +
        `<option value="">&mdash;</option>` +
        [g.a, g.h].map(t => `<option value="${t}"${pick === t ? " selected" : ""}>${nick(t)}</option>`).join("") +
        `</select></td>`;
    }
    body += filler + "</tr>";
  }

  body += `<tr class="sub"><td class="mc lab">Week ${week}</td>`;
  for (const p of people) body += `<td class="subnum">${season[p.id].weeks[week] ?? 0} <i>/ ${decided}</i></td>`;
  body += filler + "</tr>";

  let foot = `<tr><td class="mc lab">Season total</td>`;
  for (const p of people) {
    const r = season[p.id];
    const crown = leader !== null && r.correct === leader ? ' <span class="crown" title="Season leader">&#9733;</span>' : "";
    foot += `<td><div class="tot">${r.correct}${crown}</div><small>of ${r.decided}</small></td>`;
  }
  foot += filler + "</tr>";

  return `<div class="scroll"><table class="grid"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

function standingsHtml() {
  const { rows, weeks } = standings(pool);
  if (!rows.length) return emptyHtml("No players yet", "Add players on the Picks tab, then start picking.");
  if (!weeks.length) return emptyHtml("No games yet", "Load a week of games on the Picks tab.");

  const recent = [...weeks].reverse().find(w => w.decided);
  const top = rows[0].correct;
  const star = title => ` <span class="crown" title="${title}">&#9733;</span>`;

  let lb = `<table class="lb"><thead><tr><th class="mc">Player</th><th class="num">Correct</th>` +
    `<th class="num">Win %</th><th class="num">Week wins</th>${recent ? `<th class="num">Week ${recent.week}</th>` : ""}</tr></thead><tbody>`;
  for (const r of rows) {
    lb += `<tr><td class="mc"><span class="rk">${r.rank}</span>${esc(r.name)}${top > 0 && r.correct === top ? star("Season leader") : ""}</td>` +
      `<td class="num strong">${r.correct}<i> / ${r.decided}</i></td>` +
      `<td class="num">${r.decided ? Math.round((100 * r.correct) / r.decided) + "%" : "&ndash;"}</td>` +
      `<td class="num">${r.weekWins}</td>` +
      (recent ? `<td class="num">${r.weeks[recent.week]} <i>/ ${recent.decided}</i></td>` : "") + `</tr>`;
  }
  lb += "</tbody></table>";

  let wb = `<table class="wbw"><thead><tr><th class="mc">Player</th>` +
    weeks.map(w => `<th class="num"><button class="wklink" data-goweek="${w.week}" title="Open week ${w.week}">W${w.week}</button></th>`).join("") +
    `<th class="num">Total</th></tr></thead><tbody>`;
  for (const r of rows) {
    wb += `<tr><td class="mc">${esc(r.name)}</td>` + weeks.map(w => {
      const won = w.winners.includes(r.id);
      return `<td class="num${won ? " won" : ""}">${w.decided ? r.weeks[w.week] : "&ndash;"}${won ? star("Week winner") : ""}</td>`;
    }).join("") + `<td class="num strong">${r.correct}</td></tr>`;
  }
  wb += `</tbody><tfoot><tr><td class="mc lab">Games final</td>` +
    weeks.map(w => `<td class="num">${w.final}/${w.games}</td>`).join("") +
    `<td class="num">${weeks.reduce((s, w) => s + w.final, 0)}/${weeks.reduce((s, w) => s + w.games, 0)}</td></tr></tfoot></table>`;

  return `<section class="sec"><h2>Season leaderboard</h2><div class="scroll">${lb}</div></section>` +
    `<section class="sec"><h2>Week by week</h2>` +
    `<p class="note">&#9733; marks the week winner once every game that week is final. A missed pick counts as wrong.</p>` +
    `<div class="scroll">${wb}</div></section>`;
}

/* ---------------- toast ---------------- */

let toastTimer = null;
function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast"; }, 3500);
}

/* ---------------- actions ---------------- */

function setWeek(w) {
  week = clamp(w, 1, WEEKS);
  editing = false;
  render();
  autoSync();
}

function setTab(t) {
  tab = t;
  editing = false;
  history.replaceState(null, "", t === "standings" ? "#standings" : location.pathname + location.search);
  render();
  autoSync();
}

function openEditor() {
  $("draft").value = weekGames(pool, week).map(g => `${nick(g.a)} at ${nick(g.h)}`).join("\n");
  editing = true;
  updateParseInfo();
  render();
  $("draft").focus();
}

function updateParseInfo() {
  const txt = $("draft").value;
  const lines = txt.split("\n").filter(l => l.trim()).length;
  $("parseInfo").textContent = `${parseGames(txt).length} of ${lines} lines read`;
}

function saveGames() {
  const txt = $("draft").value;
  const parsed = parseGames(txt);
  const lines = txt.split("\n").filter(l => l.trim()).length;
  if (parsed.length < lines && !confirm(`${lines - parsed.length} line(s) couldn't be read and will be skipped. Save anyway?`)) return;

  const existing = pool.games?.[wk(week)] || {};
  const keys = new Set(parsed.map(gameKey));
  const dropped = Object.keys(existing).filter(k => !keys.has(k) && pool.picks?.[wk(week)]?.[k]);
  if (dropped.length && !confirm(`${dropped.length} game(s) with picks will be removed from week ${week}. Continue?`)) return;

  const next = {};
  parsed.forEach((g, i) => { next[gameKey(g)] = { ...(existing[gameKey(g)] || { a: g.a, h: g.h }), n: i }; });
  editing = false;
  write({ [`games/${wk(week)}`]: parsed.length ? next : null });
  render();
}

function addPlayer() {
  const name = cleanName($("newName").value);
  if (!name) return;
  if (playerList(pool).some(p => p.name.toLowerCase() === name.toLowerCase())) {
    toast(`${name} is already in the pool`, true);
    return;
  }
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  write({ [`players/${id}`]: { name, n: Date.now() } });
  $("newName").value = "";
}

function renamePlayer(id) {
  const p = pool.players?.[id];
  if (!p) return;
  const name = cleanName(prompt("Rename player", p.name));
  if (!name || name === p.name) return;
  if (playerList(pool).some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
    toast(`${name} is already in the pool`, true);
    return;
  }
  write({ [`players/${id}/name`]: name });
}

function removePlayer(id) {
  const p = pool.players?.[id];
  if (!p || !confirm(`Remove ${p.name} and all of their picks from the pool? This can't be undone.`)) return;
  const paths = { [`players/${id}`]: null };
  for (const [w, byGame] of Object.entries(pool.picks || {})) {
    for (const [key, byPlayer] of Object.entries(byGame || {})) {
      if (byPlayer && id in byPlayer) paths[`picks/${w}/${key}/${id}`] = null;
    }
  }
  write(paths);
}

function toggleWinner(key, team) {
  const g = weekGames(pool, week).find(x => x.key === key);
  if (!g) return;
  const clearing = g.w === team;
  if (!clearing && g.kickoff && Date.now() < g.kickoff &&
      !confirm(`${nick(g.a)} at ${nick(g.h)} hasn't kicked off yet. Mark the ${nick(team)} as the winner anyway?`)) return;
  const base = `games/${wk(week)}/${key}/`;
  write({ [base + "w"]: clearing ? null : team, [base + "fin"]: clearing ? null : true });
}

function setPick(sel) {
  const [key, pid] = sel.dataset.pick.split("|");
  const g = weekGames(pool, week).find(x => x.key === key);
  if (!g || isLocked(pool, week, g)) {
    toast("Picks for this game are locked", true);
    sel.blur();
    render();
    return;
  }
  write({ [`picks/${wk(week)}/${key}/${pid}`]: sel.value || null });
}

function exportBackup() {
  const backup = { app: "nfl-pickem", season: SEASON, pool: POOL_ID, exportedAt: new Date().toISOString(), data: pool };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `pickem-${SEASON}-${POOL_ID}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restoreBackup(file) {
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { toast("That file isn't valid JSON", true); return; }
  const data = backup?.app === "nfl-pickem" && backup.data && typeof backup.data === "object" ? backup.data : null;
  if (!data) { toast("That file isn't a pick'em backup", true); return; }
  const players = Object.keys(data.players || {}).length;
  const note = backup.season !== SEASON ? ` It's from the ${backup.season} season.` : "";
  if (!confirm(`Replace everything in this pool with the backup from ${String(backup.exportedAt).slice(0, 10)} (${players} players)?${note} Current picks and results will be overwritten.`)) return;
  const next = {};
  for (const k of ["players", "games", "picks", "locked", "late"]) if (data[k]) next[k] = data[k];
  try {
    await store.replace(next);
    toast("Backup restored");
  } catch (e) {
    console.error(e);
    toast("Restore failed: " + (e?.message || e), true);
  }
}

async function copyLink() {
  const url = location.origin + location.pathname + location.search;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied. Send it to your pool.");
  } catch {
    prompt("Copy this link:", url);
  }
}

/* ---------------- events ---------------- */

$("prev").onclick = () => setWeek(week - 1);
$("next").onclick = () => setWeek(week + 1);
$("weekSel").onchange = e => setWeek(Number(e.target.value));
$("lockBtn").onclick = () => write({ [`locked/${wk(week)}`]: pool.locked?.[wk(week)] ? null : true });
$("lateBtn").onclick = () => {
  const on = !!pool.late?.[wk(week)];
  if (!on && !confirm(`Allow picks for week ${week} games that have already kicked off? Use this to enter picks people made before kickoff. Everyone can change those picks until you turn it off.`)) return;
  write({ [`late/${wk(week)}`]: on ? null : true });
};
$("editBtn").onclick = openEditor;
$("cancelEdit").onclick = () => { editing = false; render(); };
$("saveEdit").onclick = saveGames;
$("draft").oninput = updateParseInfo;
$("addBtn").onclick = addPlayer;
$("newName").onkeydown = e => { if (e.key === "Enter") addPlayer(); };
$("shareBtn").onclick = copyLink;
$("exportBtn").onclick = exportBackup;
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file && store) restoreBackup(file);
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-tab],[data-act],[data-rm],[data-rename],[data-win],[data-goweek]");
  if (!el) return;
  const d = el.dataset;
  if (d.tab) return setTab(d.tab);
  if (!loaded || fatal) return;
  if (d.act === "espn") return importEspn();
  if (d.act === "edit") return openEditor();
  if (d.goweek) { week = Number(d.goweek); return setTab("picks"); }
  if (d.rm) return removePlayer(d.rm);
  if (d.rename) return renamePlayer(d.rename);
  if (d.win) return toggleWinner(...d.win.split("|"));
});

document.addEventListener("change", e => {
  const sel = e.target.closest("[data-pick]");
  if (sel) setPick(sel);
});

document.addEventListener("focusout", () => { if (boardStale) setTimeout(render); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) autoSync(); });

/* ---------------- boot ---------------- */

async function boot() {
  const title = `${POOL_TITLE} · ${SEASON} NFL`;
  document.title = title;
  $("title").textContent = title;
  if (POOL_ID !== "main") $("subtitle").textContent += ` Pool: ${POOL_ID}.`;
  for (let w = 1; w <= WEEKS; w++) $("weekSel").add(new Option("Week " + w, w));
  setConn("connecting");
  render();

  try {
    store = USE_FIREBASE ? await firebaseStore(onData) : await localStore(onData);
  } catch (e) {
    console.error(e);
    const code = String(e?.code || "");
    fatal = /operation-not-allowed|admin-restricted/.test(code)
      ? "Firebase blocked sign-in. In Firebase, open Authentication > Sign-in method and enable Anonymous."
      : "Couldn't connect to the database: " + (e?.message || e);
    setConn("error", "Not connected");
    render();
    return;
  }

  autoSync();
  setInterval(autoSync, MINUTE);
  // Re-render when a game kicks off so its picks lock without a reload.
  setInterval(() => {
    if (tab !== "picks" || !loaded) return;
    const sig = weekGames(pool, week).map(g => (isLocked(pool, week, g) ? 1 : 0)).join("");
    if (sig !== lockSig) render();
  }, 30e3);
}

boot();
