'use strict';
/* =====================================================================
   SharpSlip — finds +EV / high-probability bets at YOUR book by comparing
   its prices to the no-vig consensus of the rest of the market.
   Data: a shared SharpSlip odds server (Cloudflare Worker, see /server) that
   caches The Odds API for everyone, or a personal Odds API key, or demo data.
   Settings are stored locally in the browser; no login.
   ===================================================================== */

const API = 'https://api.the-odds-api.com/v4';
// ▼▼ Paste your Cloudflare Worker address here after deploying it (see server/SETUP.md) ▼▼
const SERVER_URL = 'https://sharpslip-odds.littlegus12.workers.dev';

// ---------- CONFIG (edit freely) ----------
// region = which Odds API region the book lives in. type: book | dfs | exchange
const BOOKS = [
  { key: 'draftkings', name: 'DraftKings', region: 'us', type: 'book' },
  { key: 'fanduel', name: 'FanDuel', region: 'us', type: 'book' },
  { key: 'hardrockbet', name: 'Hard Rock Bet', region: 'us2', type: 'book' },
  { key: 'betmgm', name: 'BetMGM', region: 'us', type: 'book' },
  { key: 'williamhill_us', name: 'Caesars', region: 'us', type: 'book' },
  { key: 'espnbet', name: 'ESPN BET / theScore', region: 'us', type: 'book' },
  { key: 'fanatics', name: 'Fanatics', region: 'us', type: 'book' },
  { key: 'betrivers', name: 'BetRivers', region: 'us', type: 'book' },
  { key: 'ballybet', name: 'Bally Bet', region: 'us2', type: 'book' },
  { key: 'fliff', name: 'Fliff', region: 'us2', type: 'book' },
  { key: 'bovada', name: 'Bovada', region: 'us', type: 'book' },
  { key: 'betonlineag', name: 'BetOnline', region: 'us', type: 'book' },
  { key: 'prizepicks', name: 'PrizePicks', region: 'us_dfs', type: 'dfs' },
  { key: 'underdog', name: 'Underdog Fantasy', region: 'us_dfs', type: 'dfs' },
  { key: 'pick6', name: 'DraftKings Pick6', region: 'us_dfs', type: 'dfs' },
  { key: 'kalshi', name: 'Kalshi', region: 'us_ex', type: 'exchange' },
  { key: 'polymarket', name: 'Polymarket', region: 'us_ex', type: 'exchange' },
  { key: 'novig', name: 'Novig', region: 'us_ex', type: 'exchange' },
  { key: 'prophetx', name: 'ProphetX', region: 'us_ex', type: 'exchange' },
];
// How much each book counts toward the "fair" consensus. Sharp books count more; DFS prices are indicative only (0).
const BOOK_WEIGHT = { pinnacle: 3, betfair_ex_eu: 2, betfair_ex_uk: 2, novig: 2, prophetx: 2, circasports: 2, lowvig: 1.5, betonlineag: 1.5, prizepicks: 0, underdog: 0, pick6: 0, betr_us_dfs: 0 };

const SPORTS = [
  { key: 'americanfootball_nfl', name: 'NFL', icon: '🏈', props: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_anytime_td'] },
  { key: 'americanfootball_ncaaf', name: 'NCAAF', icon: '🏈', props: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds'] },
  { key: 'basketball_nba', name: 'NBA', icon: '🏀', props: ['player_points', 'player_rebounds', 'player_assists', 'player_threes'] },
  { key: 'basketball_ncaab', name: 'NCAAB', icon: '🏀', props: ['player_points', 'player_rebounds', 'player_assists'] },
  { key: 'basketball_wnba', name: 'WNBA', icon: '🏀', props: ['player_points', 'player_rebounds', 'player_assists'] },
  { key: 'baseball_mlb', name: 'MLB', icon: '⚾', props: ['batter_hits', 'batter_total_bases', 'batter_home_runs', 'pitcher_strikeouts'] },
  { key: 'icehockey_nhl', name: 'NHL', icon: '🏒', props: ['player_points', 'player_shots_on_goal', 'player_goal_scorer_anytime'] },
  { key: 'soccer_epl', name: 'EPL', icon: '⚽', props: ['player_goal_scorer_anytime', 'player_shots_on_target'] },
  { key: 'soccer_usa_mls', name: 'MLS', icon: '⚽', props: ['player_goal_scorer_anytime'] },
  { key: 'soccer_uefa_champs_league', name: 'Champions Lg', icon: '⚽', props: ['player_goal_scorer_anytime'] },
  { key: 'soccer_spain_la_liga', name: 'La Liga', icon: '⚽', props: [] },
  { key: 'mma_mixed_martial_arts', name: 'UFC / MMA', icon: '🥊', props: [] },
  { key: 'boxing_boxing', name: 'Boxing', icon: '🥊', props: [] },
];
const MARKET_LABEL = {
  h2h: 'Moneyline', spreads: 'Spread', totals: 'Total',
  player_pass_yds: 'Pass Yds', player_rush_yds: 'Rush Yds', player_reception_yds: 'Rec Yds', player_receptions: 'Receptions',
  player_anytime_td: 'Anytime TD', player_pass_tds: 'Pass TDs', player_points: 'Points', player_rebounds: 'Rebounds',
  player_assists: 'Assists', player_threes: '3-Pointers', player_points_rebounds_assists: 'Pts+Reb+Ast',
  batter_hits: 'Hits', batter_total_bases: 'Total Bases', batter_home_runs: 'Home Runs', pitcher_strikeouts: 'Strikeouts',
  player_shots_on_goal: 'Shots on Goal', player_goal_scorer_anytime: 'Anytime Goal', player_shots_on_target: 'Shots on Target',
};
const ONE_SIDED_VIG = 1.07; // assumed margin when a market only lists one side (e.g. anytime TD "Yes")

const DEFAULTS = {
  source: 'auto', serverUrl: '', apiKey: '', demo: true, book: '', mode: 'value',
  sports: ['americanfootball_nfl', 'americanfootball_ncaaf', 'basketball_nba', 'basketball_ncaab', 'baseball_mlb', 'icehockey_nhl', 'soccer_epl', 'mma_mixed_martial_arts'],
  markets: { h2h: true, spreads: true, totals: true, props: true },
  minBooks: 3, minEV: 1.0, safeMaxFav: -300, safeMinEV: -3,
  oneLegPerGame: true, bankroll: 0, kellyFrac: 0.25, cacheMin: 15, hoursAhead: 48,
  useSharp: false, extraRegions: '',
  dfsPayouts: '2:3, 3:6, 4:10, 5:20, 6:37.5',
};

// ---------- STATE ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / private mode */ } },
};
const S = Object.assign({}, DEFAULTS, LS.get('ss_settings', {}));
S.markets = Object.assign({}, DEFAULTS.markets, S.markets || {});
const state = {
  tab: 'picks',
  games: LS.get('ss_games', {}),   // sportKey -> {at, regions, data:[events]}
  props: LS.get('ss_props', {}),   // eventId  -> {at, regions, sport, data:{bookmakers}}
  credits: LS.get('ss_credits', null),
  activeSports: LS.get('ss_active', null),
  seenBooks: LS.get('ss_seen', {}),
  slip: LS.get('ss_slip', []),
  parlay: { n: 3, legs: [], banned: [], stake: LS.get('ss_stake', 10), target: LS.get('ss_target', 25) },
  filter: { sport: 'all', market: 'all' },
  loading: false, error: '', demoData: null, cands: [],
};
const saveSettings = () => LS.set('ss_settings', S);

// ---------- HELPERS ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decToAm = d => { if (!(d > 1)) return '—'; return d >= 2 ? '+' + Math.round((d - 1) * 100) : '-' + Math.round(100 / (d - 1)); };
const amToDec = a => (a >= 0 ? 1 + a / 100 : 1 + 100 / -a);
const pct = (p, dp = 0) => (p * 100).toFixed(dp) + '%';
const sgnPct = (p, dp = 1) => (p >= 0 ? '+' : '') + (p * 100).toFixed(dp) + '%';
const money = v => '$' + (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2));
const isoNoMs = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sportOf = k => SPORTS.find(s => s.key === k) || { key: k, name: k.split('_').slice(1).join(' ').toUpperCase(), icon: '🎲', props: [] };
const bookOf = k => BOOKS.find(b => b.key === k) || { key: k, name: state.seenBooks[k] || k, region: 'us', type: 'book' };
const myBook = () => bookOf(S.book);
const isDFS = () => myBook().type === 'dfs';
const fmtTime = t => { const d = new Date(t); return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago'; };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }
function dfsTable() {
  const t = {};
  String(S.dfsPayouts).split(',').forEach(p => { const [n, x] = p.split(':').map(Number); if (n > 1 && x > 1) t[n] = x; });
  return t;
}
// Best per-leg decimal "price" a DFS pick earns (used to judge single picks at DFS sites)
function dfsLegDec() { const t = dfsTable(); let best = 1.8; for (const n in t) best = Math.max(best, Math.pow(t[n], 1 / n)); return best; }

const serverUrl = () => String(S.serverUrl || SERVER_URL).trim().replace(/\/+$/, '');
// Where odds come from: 'server' (shared, no key needed), 'key' (personal Odds API key) or 'demo'.
function source() {
  const srv = !!serverUrl(), key = !!String(S.apiKey).trim();
  if (S.source === 'server') return srv ? 'server' : 'demo';
  if (S.source === 'key') return key ? 'key' : 'demo';
  if (S.source === 'demo') return 'demo';
  return srv ? 'server' : key && !S.demo ? 'key' : 'demo';
}

function regionsNeeded() {
  const r = new Set(['us']);
  if (S.book) r.add(myBook().region);
  if (S.useSharp) r.add('eu');
  String(S.extraRegions).split(',').map(x => x.trim()).filter(Boolean).forEach(x => r.add(x));
  return [...r];
}

// ---------- API ----------
async function apiGet(path, params) {
  const u = new URL(API + path);
  u.searchParams.set('apiKey', S.apiKey.trim());
  for (const k in params) u.searchParams.set(k, params[k]);
  let res;
  try { res = await fetch(u); } catch { throw new Error('Network error — check your connection.'); }
  const rem = res.headers.get('x-requests-remaining'), used = res.headers.get('x-requests-used');
  if (rem != null) { state.credits = { remaining: +rem, used: +used, at: Date.now() }; LS.set('ss_credits', state.credits); }
  if (res.status === 401) throw new Error('API key rejected. Check it in Settings.');
  if (res.status === 429) throw new Error('Out of API credits (or too many requests). Try later or upgrade your Odds API plan.');
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).message || m; } catch { } throw new Error('Odds API: ' + m); }
  return res.json();
}

async function serverGet(path, params = {}) {
  const u = new URL(serverUrl() + path);
  for (const k in params) u.searchParams.set(k, params[k]);
  let res, body;
  try { res = await fetch(u); body = await res.json(); } catch { throw new Error('Could not reach the odds server. Check your connection.'); }
  if (body && body.credits) { state.credits = { ...body.credits, at: Date.now() }; LS.set('ss_credits', state.credits); }
  if (!res.ok) throw new Error(body?.error || 'Odds server error ' + res.status);
  if (body.stale) state.stale = body.reason || 'Showing saved odds.';
  return body;
}

// The shared server does the real caching, so phones re-check it every 2 minutes at most.
const fresh = (entry, regions) => entry && Date.now() - entry.at < (source() === 'server' ? 2 : S.cacheMin) * 60000 && regions.every(r => (entry.regions || []).includes(r));

async function refresh(force = false) {
  const src = source();
  if (src === 'demo') { loadDemo(); return; }
  if (state.loading) return;
  state.demoData = null;
  state.loading = true; state.error = ''; state.stale = ''; renderStatus();
  const srv = src === 'server';
  const regions = srv ? ['server'] : regionsNeeded();
  try {
    // The sports list is free (doesn't use credits) — use it to skip out-of-season leagues.
    try {
      const list = srv ? (await serverGet('/sports')).data : (await apiGet('/sports', {})).map(s => s.key);
      state.activeSports = list; LS.set('ss_active', list);
    } catch (e) { if (/key|reach/.test(e.message)) throw e; }
    const want = S.sports.filter(k => !state.activeSports || state.activeSports.includes(k));
    const mk = ['h2h', 'spreads', 'totals'].filter(m => S.markets[m]);
    if (!mk.length) mk.push('h2h');
    for (const sk of want) {
      if (!force && fresh(state.games[sk], regions)) continue;
      if (srv) {
        const r = await serverGet('/odds', { sport: sk });
        state.games[sk] = { at: Date.now(), oddsAt: r.at, regions, data: r.data };
        noteBooks(r.data); LS.set('ss_games', state.games);
        continue;
      }
      const data = await apiGet(`/sports/${sk}/odds`, {
        regions: regions.join(','), markets: mk.join(','), oddsFormat: 'decimal',
        commenceTimeFrom: isoNoMs(Date.now()), commenceTimeTo: isoNoMs(Date.now() + S.hoursAhead * 3600000),
      });
      state.games[sk] = { at: Date.now(), regions, data };
      noteBooks(data);
      LS.set('ss_games', state.games);
    }
    for (const k in state.games) if (!S.sports.includes(k)) delete state.games[k];
    LS.set('ss_games', state.games);
  } catch (e) { state.error = e.message; }
  state.loading = false;
  recompute(); render();
}

async function loadProps(eventIds) {
  const src = source();
  if (src === 'demo') { toast('Demo mode already includes props.'); return; }
  const srv = src === 'server';
  const regions = srv ? ['server'] : regionsNeeded();
  state.loading = true; state.error = ''; renderStatus();
  let n = 0;
  try {
    for (const id of eventIds) {
      const ev = findEvent(id); if (!ev) continue;
      const markets = sportOf(ev.sport_key).props;
      if (!markets.length) continue;
      const data = srv
        ? (await serverGet('/props', { sport: ev.sport_key, event: id })).data
        : await apiGet(`/sports/${ev.sport_key}/events/${id}/odds`, { regions: regions.join(','), markets: markets.join(','), oddsFormat: 'decimal' });
      state.props[id] = { at: Date.now(), regions, sport: ev.sport_key, data: { bookmakers: data.bookmakers || [] } };
      noteBooks([data]); n++;
    }
  } catch (e) { state.error = e.message; }
  // drop props for games that have started
  for (const id in state.props) if (!findEvent(id)) delete state.props[id];
  LS.set('ss_props', state.props);
  state.loading = false;
  if (n) toast(`Loaded props for ${n} game${n > 1 ? 's' : ''}`);
  recompute(); render();
}

function noteBooks(events) {
  for (const ev of events) for (const b of ev.bookmakers || []) state.seenBooks[b.key] = b.title;
  LS.set('ss_seen', state.seenBooks);
}

// ---------- DATA ASSEMBLY ----------
function allEvents() {
  if (state.demoData) return state.demoData;
  const out = [];
  const now = Date.now();
  for (const sk of S.sports) {
    for (const ev of state.games[sk]?.data || []) {
      const t = new Date(ev.commence_time).getTime();
      if (t < now || t > now + S.hoursAhead * 3600000) continue; // skip started games and games too far out
      const p = state.props[ev.id]?.data?.bookmakers;
      out.push(p ? { ...ev, bookmakers: mergeBooks(ev.bookmakers, p) } : ev);
    }
  }
  return out.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
}
function findEvent(id) { for (const sk in state.games) { const e = (state.games[sk].data || []).find(x => x.id === id); if (e) return e; } return (state.demoData || []).find(x => x.id === id); }
function mergeBooks(a = [], b = []) {
  const m = new Map();
  for (const bk of [...a, ...b]) {
    const cur = m.get(bk.key);
    if (cur) cur.markets = [...cur.markets, ...bk.markets]; else m.set(bk.key, { ...bk, markets: [...bk.markets] });
  }
  return [...m.values()];
}

const groupKey = (mk, o) => mk === 'h2h' ? 'h2h' : mk === 'spreads' ? 'sp|' + Math.abs(o.point) : mk === 'totals' ? 'to|' + o.point : 'pp|' + (o.description || '') + '|' + (o.point ?? '');
const outKey = (mk, o) => [mk, o.description || '', o.name, o.point ?? ''].join('|');
const isProp = mk => !['h2h', 'spreads', 'totals', 'h2h_lay'].includes(mk);

function selLabel(ev, mk, o) {
  const pt = o.point;
  if (mk === 'h2h') return o.name === 'Draw' ? 'Draw' : `${o.name} ML`;
  if (mk === 'spreads') return `${o.name} ${pt > 0 ? '+' : ''}${pt}`;
  if (mk === 'totals') return `${o.name} ${pt}`;
  const lab = MARKET_LABEL[mk] || mk.replace(/^(player|batter|pitcher)_/, '').replace(/_/g, ' ');
  if (o.name === 'Yes' || o.name === 'No') return `${o.description} ${o.name === 'No' ? 'NO ' : ''}${lab}`;
  return `${o.description} ${o.name} ${pt ?? ''} ${lab}`.replace(/\s+/g, ' ');
}

/* Core math:
   1. For every book, remove the vig from each market (normalise implied probs to 100%).
   2. Average those no-vig probabilities across books (sharp books weighted higher), excluding YOUR book.
   3. Compare to your book's price: EV = fairProb × decimalOdds − 1.            */
function recompute() {
  const mine = S.book;
  const cands = [];
  if (!mine) { state.cands = []; return; }
  const dfs = isDFS(), legDec = dfsLegDec();
  for (const ev of allEvents()) {
    const fair = new Map();
    for (const bm of ev.bookmakers || []) {
      const w = BOOK_WEIGHT[bm.key] ?? 1;
      if (w <= 0 || bm.key === mine) continue;
      for (const m of bm.markets || []) {
        const groups = {};
        for (const o of m.outcomes || []) if (o.price > 1) (groups[groupKey(m.key, o)] ||= []).push(o);
        for (const g of Object.values(groups)) {
          const imp = g.map(o => 1 / o.price), sum = imp.reduce((a, b) => a + b, 0);
          const one = g.length < 2;
          g.forEach((o, i) => {
            const p = one ? imp[i] / ONE_SIDED_VIG : imp[i] / sum;
            const k = outKey(m.key, o);
            (fair.get(k) || fair.set(k, []).get(k)).push({ p, w, one, price: o.price, book: bm.key });
          });
        }
      }
    }
    const bm = (ev.bookmakers || []).find(b => b.key === mine);
    if (!bm) continue;
    for (const m of bm.markets || []) {
      const prop = isProp(m.key);
      if (prop ? !S.markets.props : !S.markets[m.key]) continue;
      if (dfs && !prop) continue;
      for (const o of m.outcomes || []) {
        const entries = fair.get(outKey(m.key, o));
        if (!entries || entries.length < S.minBooks) continue;
        const W = entries.reduce((a, e) => a + e.w, 0);
        const fp = entries.reduce((a, e) => a + e.p * e.w, 0) / W;
        const price = dfs ? legDec : o.price;
        if (!(price > 1)) continue;
        cands.push({
          id: ev.id + '|' + outKey(m.key, o), eventId: ev.id, group: groupKey(m.key, o),
          sport: ev.sport_key, home: ev.home_team, away: ev.away_team, time: ev.commence_time,
          market: m.key, prop, label: selLabel(ev, m.key, o), point: o.point,
          price, fair: Math.min(fp, 0.995), ev: fp * price - 1,
          books: entries.length, best: Math.max(...entries.map(e => e.price)),
          oneSided: entries.some(e => e.one),
        });
      }
    }
  }
  state.cands = cands;
}

function filtered() {
  const f = state.filter;
  return state.cands.filter(c => (f.sport === 'all' || c.sport === f.sport) &&
    (f.market === 'all' || (f.market === 'props' ? c.prop : c.market === f.market)));
}
function ranked(list = filtered()) {
  if (S.mode === 'value') return list.filter(c => c.ev >= S.minEV / 100).sort((a, b) => b.ev - a.ev);
  const minDec = amToDec(Number(S.safeMaxFav) || -300);
  return list.filter(c => (isDFS() || c.price >= minDec) && c.ev >= S.safeMinEV / 100).sort((a, b) => b.fair - a.fair || b.ev - a.ev);
}
const kelly = (p, d) => { const b = d - 1; const f = (b * p - (1 - p)) / b; return Math.max(0, f) * S.kellyFrac * S.bankroll; };

// ---------- PARLAY ----------
/* Target-win-chance builder: the slider sets the chance ALL legs hit (e.g. 25%).
   Each leg needs roughly target^(1/legs) (25% over 3 legs ≈ 63% per leg). We pick legs near
   that, favouring better value, then swap legs until the combined chance lands on the target. */
const targetPool = () => {
  const floor = S.mode === 'value' ? 0 : S.safeMinEV / 100; // never take badly-priced legs
  return filtered().filter(c => c.ev >= floor && !state.parlay.banned.includes(c.id));
};
const perLegTarget = () => Math.pow(state.parlay.target / 100, 1 / state.parlay.n);
function parlayScore(legs, logT) {
  const lp = legs.reduce((a, l) => a + Math.log(l.fair), 0);
  return Math.abs(lp - logT) - legs.reduce((a, l) => a + 0.5 * l.ev + (l._j || 0), 0); // lower is better
}
function fits(c, legs) {
  return !legs.some(l => l.id === c.id || l.eventId + l.group === c.eventId + c.group || (S.oneLegPerGame && l.eventId === c.eventId));
}
function buildParlay(randomize = false, keep = []) {
  const P = state.parlay, n = P.n, logT = Math.log(P.target / 100), lp = Math.log(perLegTarget());
  // Shuffle = give every candidate a random bonus so a different (still on-target) combo wins.
  const pool = targetPool()
    .map(c => { c._j = randomize ? Math.random() * 0.12 : 0; return { c, s: Math.abs(Math.log(c.fair) - lp) - 0.5 * c.ev - c._j }; })
    .sort((a, b) => a.s - b.s).slice(0, 300).map(x => x.c);
  let legs = pickLegs(pool, n, keep);
  // Local search: swap one leg at a time while it moves the parlay closer to the target.
  for (let iter = 0; iter < 25; iter++) {
    let best = parlayScore(legs, logT), swap = null;
    for (let i = keep.length; i < legs.length; i++) {
      const others = legs.filter((_, j) => j !== i);
      for (const c of pool) {
        if (!fits(c, others)) continue;
        const trial = [...others.slice(0, i), c, ...others.slice(i)];
        const s = parlayScore(trial, logT);
        if (s < best - 1e-6) { best = s; swap = trial; }
      }
    }
    if (!swap) break;
    legs = swap;
  }
  P.legs = legs;
}
function pickLegs(pool, n, start) {
  const legs = [...start];
  const ev = new Set(legs.map(l => l.eventId)), gr = new Set(legs.map(l => l.eventId + l.group));
  for (const c of pool) {
    if (legs.length >= n) break;
    if (legs.some(l => l.id === c.id)) continue;
    if (S.oneLegPerGame && ev.has(c.eventId)) continue;
    if (gr.has(c.eventId + c.group)) continue; // never both sides of the same bet
    legs.push(c); ev.add(c.eventId); gr.add(c.eventId + c.group);
  }
  return legs;
}
function removeLeg(id) {
  const P = state.parlay;
  P.banned.push(id);
  buildParlay(false, P.legs.filter(l => l.id !== id));
}
function parlayMath(legs) {
  const prob = legs.reduce((a, l) => a * l.fair, 1);
  let dec;
  if (isDFS()) dec = dfsTable()[legs.length] || 0;
  else dec = legs.reduce((a, l) => a * l.price, 1);
  return { prob, dec, ev: dec ? prob * dec - 1 : -1 };
}

// ---------- DEMO DATA ----------
function loadDemo() {
  state.demoData = makeDemo();
  state.error = '';
  recompute(); render();
}
function makeDemo() {
  let seed = 7 + Math.floor(Date.now() / 3600000); // changes hourly
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const norm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const T = {
    americanfootball_nfl: ['Bills', 'Chiefs', 'Eagles', 'Cowboys', 'Ravens', 'Bengals', '49ers', 'Lions', 'Packers', 'Dolphins', 'Jets', 'Steelers'],
    basketball_nba: ['Celtics', 'Lakers', 'Nuggets', 'Knicks', 'Bucks', 'Suns', 'Heat', 'Warriors', 'Thunder', 'Mavericks'],
    icehockey_nhl: ['Rangers', 'Bruins', 'Oilers', 'Panthers', 'Avalanche', 'Stars', 'Kings', 'Leafs'],
    americanfootball_ncaaf: ['Georgia', 'Ohio State', 'Texas', 'Michigan', 'Alabama', 'Oregon', 'LSU', 'Penn State'],
  };
  const P = { americanfootball_nfl: [['QB', 'player_pass_yds', 245], ['RB', 'player_rush_yds', 62], ['WR', 'player_reception_yds', 64], ['WR', 'player_receptions', 5.5]], basketball_nba: [['G', 'player_points', 24.5], ['F', 'player_rebounds', 8.5], ['G', 'player_assists', 6.5], ['G', 'player_threes', 2.5]], icehockey_nhl: [['C', 'player_shots_on_goal', 3.5], ['W', 'player_points', 0.5]], americanfootball_ncaaf: [['QB', 'player_pass_yds', 255], ['RB', 'player_rush_yds', 78]] };
  const TOT = { americanfootball_nfl: 44.5, basketball_nba: 226.5, icehockey_nhl: 6.5, americanfootball_ncaaf: 52.5 };
  const SPR = { americanfootball_nfl: 14, basketball_nba: 22, icehockey_nhl: 1.5, americanfootball_ncaaf: 30 };
  const books = [...new Set(['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'espnbet', 'hardrockbet', 'fanatics', 'betrivers', 'pinnacle', 'kalshi', 'polymarket', 'prizepicks', 'underdog', S.book].filter(Boolean))];
  const titles = Object.fromEntries(BOOKS.map(b => [b.key, b.name])); titles.pinnacle = 'Pinnacle';
  const r2 = x => Math.round(x * 2) / 2;
  const pair = (p, vig, noise) => { const q = Math.min(.97, Math.max(.03, p + norm() * noise)); return [1 / (q * (1 + vig / 2)), 1 / ((1 - q) * (1 + vig / 2))]; };
  const events = [];
  let gid = 0;
  for (const sk in T) {
    const teams = [...T[sk]].sort(() => rnd() - .5);
    for (let i = 0; i + 1 < teams.length; i += 2) {
      const home = teams[i], away = teams[i + 1];
      const pH = .25 + rnd() * .5;
      const spread = -r2((pH - .5) * SPR[sk]) || -1.5;
      const total = r2(TOT[sk] + norm() * TOT[sk] * .04);
      const props = [];
      (P[sk] || []).forEach(([pos, mk, base], j) => {
        const team = j % 2 ? away : home;
        props.push({ name: `${team} ${pos}${j + 1}`, mk, line: base < 1 ? 0.5 : r2(base * (0.85 + rnd() * .3)) });
      });
      const ev = { id: 'demo' + (gid++), sport_key: sk, home_team: home, away_team: away, commence_time: new Date(Date.now() + (2 + rnd() * 40) * 3600000).toISOString(), bookmakers: [] };
      for (const bk of books) {
        const meta = bookOf(bk), sharp = bk === 'pinnacle';
        const vig = sharp ? .025 : meta.type === "exchange" ? .02 : .048, noise = sharp ? .006 : .014;
        const markets = [];
        if (meta.type !== 'dfs') {
          const [h, a] = pair(pH, vig, noise);
          markets.push({ key: 'h2h', outcomes: [{ name: home, price: h }, { name: away, price: a }] });
          if (meta.type === 'book' || sharp) {
            const [sh, sa] = pair(.5, vig, noise);
            markets.push({ key: 'spreads', outcomes: [{ name: home, price: sh, point: spread }, { name: away, price: sa, point: -spread }] });
            const [o, u] = pair(.5, vig, noise);
            markets.push({ key: 'totals', outcomes: [{ name: 'Over', price: o, point: total }, { name: 'Under', price: u, point: total }] });
          }
        }
        if (meta.type !== 'exchange') {
          const pm = {};
          props.forEach((pr, j) => {
            const truth = .5 + Math.sin(gid * 7 + j * 3) * .07;
            const [o, u] = pair(truth, meta.type === 'dfs' ? .08 : vig + .02, noise * 1.2);
            (pm[pr.mk] ||= []).push({ name: 'Over', description: pr.name, price: o, point: pr.line }, { name: 'Under', description: pr.name, price: u, point: pr.line });
          });
          for (const k in pm) markets.push({ key: k, outcomes: pm[k] });
        }
        ev.bookmakers.push({ key: bk, title: titles[bk] || bk, markets });
      }
      events.push(ev);
    }
  }
  return events.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
}

// ---------- RENDER ----------
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  document.querySelectorAll('.seg [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  $('#bookBtn').textContent = (S.book ? myBook().name : 'Pick your book') + ' ▾';
  $('#modehelp').textContent = S.mode === 'value'
    ? `Bets where ${S.book ? myBook().name : 'your book'} pays MORE than the fair price. Best long-term.`
    : `Most likely to hit, while skipping bad prices. Hits more, pays less.`;
  renderStatus();
  const v = $('#view');
  if (state.tab === 'settings') v.innerHTML = viewSettings();
  else if (!S.book) v.innerHTML = `<div class="empty"><div class="e">📒</div><p>First, choose the sportsbook you bet with.</p><button class="btn" data-act="pickbook">Choose my book</button></div>`;
  else if (state.tab === 'picks') v.innerHTML = viewPicks();
  else if (state.tab === 'parlay') v.innerHTML = viewParlay();
  else if (state.tab === 'props') v.innerHTML = viewProps();
  $('#refreshBtn').classList.toggle('spin', state.loading);
}

function renderStatus() {
  const st = $('#status');
  st.classList.toggle('err', !!state.error);
  if (state.error) { st.textContent = '⚠️ ' + state.error; return; }
  if (state.loading) { st.textContent = 'Loading odds…'; return; }
  const src = source();
  if (src === 'demo') { st.innerHTML = '🧪 Demo data (sample odds). Live odds are set up in Settings.'; return; }
  const ts = Object.values(state.games).map(g => g.oddsAt || g.at);
  const parts = [];
  if (src === 'server') parts.push('🌐 Shared odds');
  if (ts.length) parts.push('Odds from ' + ago(Math.min(...ts)));
  parts.push(allEvents().length + ' games');
  if (src === 'key' && state.credits) parts.push(state.credits.remaining + ' credits left');
  if (state.stale) parts.push('saving credits, some odds older');
  st.textContent = parts.join(' · ');
}

function filterChips(withMarkets = true) {
  const sports = [...new Set(state.cands.map(c => c.sport))];
  const f = state.filter;
  let h = `<div class="chips"><button class="chip ${f.sport === 'all' ? 'on' : ''}" data-fs="all">All sports</button>` +
    sports.map(s => `<button class="chip ${f.sport === s ? 'on' : ''}" data-fs="${s}">${sportOf(s).icon} ${esc(sportOf(s).name)}</button>`).join('') + '</div>';
  if (withMarkets) {
    const ms = isDFS() ? [['all', 'All'], ['props', 'Player props']] : [['all', 'All bets'], ['h2h', 'Moneyline'], ['spreads', 'Spread'], ['totals', 'Over/Under'], ['props', 'Player props']];
    h += `<div class="chips">` + ms.map(([k, l]) => `<button class="chip ${f.market === k ? 'on' : ''}" data-fm="${k}">${l}</button>`).join('') + '</div>';
  }
  return h;
}

function card(c) {
  const inSlip = state.slip.includes(c.id);
  const sp = sportOf(c.sport), dfs = isDFS();
  const k = !dfs && S.bankroll > 0 ? kelly(c.fair, c.price) : 0;
  const meta = [];
  if (!dfs) meta.push('Fair ' + decToAm(1 / c.fair));
  meta.push(c.books + ' books compared');
  if (!dfs && c.best > c.price + 0.005) meta.push('Best elsewhere ' + decToAm(c.best));
  if (k >= 0.5) meta.push('Suggested bet ' + money(k));
  return `<div class="card">
    <div class="row1"><span>${sp.icon} ${esc(sp.name)}</span><span>${fmtTime(c.time)}</span></div>
    <div class="match">${esc(c.away)} @ ${esc(c.home)}</div>
    <div class="sel">${esc(c.label)} <span class="mkt">${esc(MARKET_LABEL[c.market] || 'Prop')}</span></div>
    <div class="stats">
      ${dfs ? `<div class="odds">${c.point != null ? 'Line ' + c.point : 'Yes'}</div>` : `<div class="odds">${decToAm(c.price)}</div>`}
      <div class="prob">Win chance <b>${pct(c.fair)}</b></div>
      <div class="edge ${c.ev >= 0 ? 'pos' : 'neg'}">${sgnPct(c.ev)} ${dfs ? 'vs breakeven' : 'edge'}</div>
    </div>
    <div class="bar"><i style="width:${(c.fair * 100).toFixed(1)}%"></i></div>
    <div class="meta">${meta.join(' · ')}${c.oneSided ? ' · <span class="tag">one-sided market, estimate</span>' : ''}</div>
    <button class="add ${inSlip ? 'in' : ''}" data-add="${esc(c.id)}">${inSlip ? '✓ Slip' : '+ Slip'}</button>
  </div>`;
}

function noPicksMsg() {
  if (!allEvents().length) return `<div class="empty"><div class="e">🗓️</div><p>No games loaded yet. Tap ↻ to fetch odds.</p></div>`;
  if (!state.cands.length) {
    if (isDFS()) return `<div class="empty"><div class="e">👤</div><p>${esc(myBook().name)} only offers player props. Load props in the <b>Props</b> tab.</p></div>`;
    return `<div class="empty"><div class="e">🔍</div><p>No odds from ${esc(myBook().name)} found in the data. Check the book, or make sure your region includes it in Settings.</p></div>`;
  }
  return `<div class="empty"><div class="e">🤷</div><p>Nothing passes your filters right now. Try the other mode, another sport, or lower "Minimum edge" in Settings.</p></div>`;
}

function viewPicks() {
  const list = ranked().slice(0, 60);
  return filterChips() +
    (list.length ? `<h3>${list.length} ${S.mode === 'value' ? 'best value' : 'safest'} picks at ${esc(myBook().name)}</h3>` + list.map(card).join('') : noPicksMsg());
}

function legRow(l, i, removable) {
  const dfs = isDFS();
  return `<div class="leg"><div class="n">${i + 1}</div>
    <div class="body"><b>${esc(l.label)}</b><small>${sportOf(l.sport).icon} ${esc(l.away)} @ ${esc(l.home)} · ${fmtTime(l.time)}</small></div>
    <div class="right">${dfs ? '' : `<b>${decToAm(l.price)}</b><br>`}<span class="muted">${pct(l.fair)}</span></div>
    ${removable ? `<button class="x" data-${removable}="${esc(l.id)}" aria-label="Remove">✕</button>` : ''}</div>`;
}

function summary(legs, label) {
  const P = state.parlay, dfs = isDFS();
  const m = parlayMath(legs);
  const stake = Number(P.stake) || 0;
  const payout = stake * m.dec;
  const k = !dfs && S.bankroll > 0 && m.dec ? kelly(m.prob, m.dec) : 0;
  return `<div class="summary">
    <div class="muted small">${label}</div>
    <div class="big">${m.dec ? (dfs ? m.dec + 'x' : decToAm(m.dec)) : '—'}</div>
    <div class="grid">
      <div><span>Chance all hit</span><b>${pct(m.prob, 1)}</b></div>
      <div><span>Expected value</span><b class="${m.ev >= 0 ? 'pos' : 'neg'}">${m.dec ? sgnPct(m.ev) : '—'}</b></div>
      <div><span>$${stake} pays</span><b>${m.dec ? money(payout) : '—'}</b></div>
      <div><span>${dfs ? 'Payout' : 'Suggested stake'}</span><b>${dfs ? (m.dec ? m.dec + 'x power play' : 'n/a for ' + legs.length) : (k >= 0.5 ? money(k) : '—')}</b></div>
    </div>
  </div>`;
}

function targetHint() {
  const T = state.parlay.target / 100;
  return `Each leg needs about <b>${pct(perLegTarget())}</b> to hit · a fair payout at ${pct(T)} is about <b>${decToAm(1 / T)}</b>`;
}
function parlayOut() {
  const P = state.parlay;
  if (!P.legs.length) return targetPool().length ? '' : noPicksMsg();
  let h = '';
  if (P.legs.length < P.n) h += `<div class="note">Only found ${P.legs.length} qualifying legs. Try another mode, more sports, or load more props.</div>`;
  const got = parlayMath(P.legs).prob * 100;
  if (Math.abs(got - P.target) > Math.max(2, P.target * 0.15)) h += `<div class="note">Closest match available: <b>${got.toFixed(1)}%</b> (target ${P.target}%). Change the number of legs or the filters to get closer.</div>`;
  return h + summary(P.legs, `${P.legs.length}-leg parlay at ${esc(myBook().name)} · target ${P.target}%`) +
    P.legs.map((l, i) => legRow(l, i, 'rm')).join('') +
    `<button class="btn ghost" data-act="toslip">Copy legs to My Slip</button>`;
}
function updateTarget(v) {
  const P = state.parlay;
  P.target = v;
  $('#tgtVal').textContent = v + '%';
  $('#target').style.setProperty('--fill', (v - 1) / 79 * 100 + '%');
  $('#tgtHint').innerHTML = targetHint();
  if (P.legs.length) { P.banned = []; buildParlay(false); $('#parlayOut').innerHTML = parlayOut(); }
}

function viewParlay() {
  const P = state.parlay;
  const slip = state.slip.map(id => state.cands.find(c => c.id === id)).filter(Boolean);
  let h = `<h2>Auto parlay builder</h2>
    <div class="stepper"><button data-act="nminus">−</button><div class="val">${P.n} legs</div><button data-act="nplus">+</button></div>
    <div class="slider">
      <div class="slidehead"><span>Chance to win</span><b id="tgtVal">${P.target}%</b></div>
      <input type="range" id="target" min="1" max="80" step="1" value="${P.target}" style="--fill:${(P.target - 1) / 79 * 100}%">
      <div class="slidelabels"><span>🚀 Long shot</span><span>⚖️ Balanced</span><span>🛡️ Safer</span></div>
      <div class="muted small" id="tgtHint">${targetHint()}</div>
    </div>
    ${filterChips()}
    <div class="field"><label>Stake ($)</label><input type="number" inputmode="decimal" id="stake" value="${esc(P.stake)}"></div>
    <div class="btnrow"><button class="btn" data-act="build">Build ${P.n}-leg parlay</button>${P.legs.length ? '<button class="btn ghost" data-act="reroll">🎲 Shuffle</button>' : ''}</div>
    <div id="parlayOut">${parlayOut()}</div>`;
  h += `<h2>My slip</h2>`;
  if (slip.length) {
    h += summary(slip, `Your ${slip.length}-leg parlay`) + slip.map((l, i) => legRow(l, i, 'unslip')).join('') + `<button class="btn ghost" data-act="clearslip">Clear slip</button>`;
  } else h += `<p class="muted small">Tap “+ Slip” on any pick to build your own parlay here.</p>`;
  h += `<div class="note">Parlay math assumes legs are independent. Same-game legs are often correlated, and books price those parlays differently. ${isDFS() ? 'DFS payouts come from the table in Settings. Check them against the app.' : 'Your book’s actual parlay price may differ slightly.'}</div>`;
  return h;
}

function viewProps() {
  const evs = allEvents().filter(e => sportOf(e.sport_key).props.length);
  const srv = source() === 'server';
  const regions = regionsNeeded().length;
  const missing = evs.filter(e => !state.props[e.id] && !state.demoData);
  const cost = e => sportOf(e.sport_key).props.length * regions;
  const credits = list => srv ? '' : ` (~${list.reduce((a, e) => a + cost(e), 0)} credits)`;
  const next5 = missing.slice(0, 5);
  let h = `<h2>Player props</h2><div class="note">` + (srv
    ? `Props load game by game. Once anyone in your group loads a game, it's saved on the shared server for everyone for about 30 minutes.`
    : `Props cost more API credits than game lines, about <b>1 credit per prop type per region per game</b>, so you load them game by game.`) +
    ` Picks from loaded games show up in Picks and Parlay automatically.</div>`;
  if (state.demoData) h += `<p class="muted small">Demo mode: props are already loaded for every game.</p>`;
  if (next5.length) h += `<button class="btn" data-act="props5">Load props for next ${next5.length} games${credits(next5)}</button>`;
  if (!evs.length) return h + `<div class="empty"><p>No games with props yet. Tap ↻ to load games.</p></div>`;
  h += '<h3>Games</h3>' + evs.map(e => {
    const sp = sportOf(e.sport_key), loaded = state.props[e.id] || state.demoData;
    return `<div class="game"><div class="body"><b>${esc(e.away_team)} @ ${esc(e.home_team)}</b><small>${sp.icon} ${esc(sp.name)} · ${fmtTime(e.commence_time)}</small></div>
      ${loaded ? `<span class="ok">✓ ${state.props[e.id] ? ago(state.props[e.id].at) : 'loaded'}</span>` : `<button data-prop="${esc(e.id)}">Load${srv ? '' : ` (~${cost(e)})`}</button>`}</div>`;
  }).join('');
  return h;
}

function viewSettings() {
  const regions = regionsNeeded();
  const mk = ['h2h', 'spreads', 'totals'].filter(m => S.markets[m]).length || 1;
  const perRefresh = S.sports.filter(k => !state.activeSports || state.activeSports.includes(k)).length * mk * regions.length;
  const chk = (id, on, label, sub = '') => `<label class="toggle"><span>${label}${sub ? `<br><span class="muted small">${sub}</span>` : ''}</span><input type="checkbox" data-set="${id}" ${on ? 'checked' : ''}></label>`;
  const num = (id, label, step = 1) => `<div class="field"><label>${label}</label><input type="number" step="${step}" inputmode="decimal" data-set="${id}" value="${esc(S[id])}"></div>`;
  return `
  <h2>Odds data</h2>
  <div class="field"><label>Where odds come from</label><select data-set="source">
    ${[['auto', 'Automatic (recommended)'], ['server', 'Shared odds server'], ['key', 'My own Odds API key'], ['demo', 'Demo data']].map(([v, l]) => `<option value="${v}" ${S.source === v ? 'selected' : ''}>${l}</option>`).join('')}
  </select></div>
  <p class="muted small">Now using: <b>${{ server: '🌐 Shared odds server (nothing to set up)', key: '🔑 Your own API key', demo: '🧪 Demo data' }[source()]}</b></p>
  ${source() === 'server' && state.credits && state.credits.remaining != null ? `<p class="muted small">Server credits left: <b>${state.credits.remaining}</b> · today ${state.credits.spentToday}/${state.credits.dailyBudget ?? '∞'} used · resets in ${state.credits.daysLeft} days</p>` : ''}
  ${SERVER_URL && S.source !== 'key' ? '' : `
  <div class="field"><label>Shared server address (from whoever runs the server)</label><input type="text" inputmode="url" autocomplete="off" data-set="serverUrl" value="${esc(S.serverUrl)}" placeholder="https://sharpslip-odds.yourname.workers.dev"></div>`}
  <details class="note"><summary><b>Use my own Odds API key instead</b></summary>
  <p>Get a free key at <a href="https://the-odds-api.com/#get-access" target="_blank" rel="noopener">the-odds-api.com</a> (500 credits per month), paste it here, and set "Where odds come from" to "My own Odds API key".</p>
  <div class="field"><label>The Odds API key</label><input type="password" autocomplete="off" data-set="apiKey" value="${esc(S.apiKey)}" placeholder="paste key here"></div>
  ${source() === 'key' ? (state.credits && state.credits.remaining != null && state.credits.used != null ? `<p class="muted small">Credits left this month: <b>${state.credits.remaining}</b> (used ${state.credits.used}). Each full refresh costs about ${perRefresh} credits. Odds are cached for ${S.cacheMin} min.</p>` : `<p class="muted small">Each full refresh costs about ${perRefresh} credits. Odds are cached for ${S.cacheMin} min.</p>`) : ''}
  </details>

  <h2>Your book</h2>
  <button class="btn ghost" data-act="pickbook">${S.book ? esc(myBook().name) + ' · change' : 'Choose my book'}</button>

  <h2>Sports</h2>
  <div class="checks">${SPORTS.map(s => `<label><input type="checkbox" data-sport="${s.key}" ${S.sports.includes(s.key) ? 'checked' : ''}> ${s.icon} ${esc(s.name)}</label>`).join('')}</div>
  <p class="muted small">Out-of-season leagues are skipped automatically and don't use credits.</p>

  <h2>Bet types</h2>
  <div class="checks">${[['h2h', 'Moneylines'], ['spreads', 'Spreads'], ['totals', 'Over/Unders'], ['props', 'Player props']].map(([k, l]) => `<label><input type="checkbox" data-mkt="${k}" ${S.markets[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>

  <h2>Pick rules</h2>
  ${num('minEV', 'Value mode: minimum edge (%)', 0.5)}
  ${num('safeMaxFav', 'Safe mode: skip favorites shorter than (e.g. -300)', 10)}
  ${num('safeMinEV', 'Safe mode: lowest edge allowed (%), e.g. -3', 0.5)}
  ${num('minBooks', 'Minimum other books to compare against', 1)}
  ${chk('oneLegPerGame', S.oneLegPerGame, 'Parlays: max one leg per game', 'Avoids correlated same-game legs')}
  ${num('hoursAhead', 'Look ahead (hours)', 6)}

  <h2>Bankroll (optional)</h2>
  ${num('bankroll', 'Bankroll ($). Set it to show suggested bet sizes (0 = off)', 10)}
  ${num('kellyFrac', 'Kelly fraction (0.25 = quarter Kelly, the conservative choice)', 0.05)}

  <h2>Advanced</h2>
  ${chk('useSharp', S.useSharp, 'Include Pinnacle (sharp) in fair price', 'More accurate, adds the EU region (more credits)')}
  ${num('cacheMin', 'Cache odds for (minutes)', 5)}
  <div class="field"><label>Extra regions (comma separated: us, us2, us_dfs, us_ex, eu, uk)</label><input type="text" data-set="extraRegions" value="${esc(S.extraRegions)}"></div>
  <div class="field"><label>DFS power-play payouts (picks:multiplier)</label><input type="text" data-set="dfsPayouts" value="${esc(S.dfsPayouts)}"></div>
  <button class="btn ghost" data-act="clearcache">Clear cached odds</button>
  ${Object.keys(state.seenBooks).length ? `<p class="muted small">Books seen in your data: ${Object.entries(state.seenBooks).map(([k, t]) => esc(t) + ' (' + esc(k) + ')').join(', ')}</p>` : ''}

  <h2>How picks work</h2>
  <div class="note">For every bet, SharpSlip takes each other book's odds, removes the bookmaker's built-in margin (the "vig") to get a fair win chance, then averages them across the market. Sharp books count more.<br><br>
  <b>Value mode</b> shows bets where your book's payout beats that fair chance. You win more than the odds say you should, so these are profitable over time.<br>
  <b>Safe mode</b> shows the outcomes most likely to hit, while skipping heavy favorites and bad prices.<br><br>
  No pick is guaranteed. Even +EV bets lose often. Bet only what you can afford to lose.</div>
  <div class="note">Must be 21+ (18+ in some states) and in a legal jurisdiction. Gambling problem? Call or text <b>1-800-GAMBLER</b>.</div>
  <p class="muted small" style="text-align:center">SharpSlip v1.3</p>`;
}

function openBooks() {
  const groups = [['book', 'Sportsbooks'], ['dfs', 'DFS / Pick’em (player props)'], ['exchange', 'Prediction markets & exchanges']];
  const extra = Object.keys(state.seenBooks).filter(k => !BOOKS.some(b => b.key === k));
  $('#bookList').innerHTML = groups.map(([t, l]) => `<h3>${l}</h3>` + BOOKS.filter(b => b.type === t).map(b =>
    `<button class="bookopt ${S.book === b.key ? 'on' : ''}" data-book="${b.key}"><span>${esc(b.name)}</span><small>${S.book === b.key ? '✓' : ''}</small></button>`).join('')).join('') +
    (extra.length ? '<h3>Other books in your data</h3>' + extra.map(k => `<button class="bookopt ${S.book === k ? 'on' : ''}" data-book="${esc(k)}"><span>${esc(state.seenBooks[k])}</span><small>${esc(k)}</small></button>`).join('') : '');
  $('#bookDialog').showModal();
}

// ---------- EVENTS ----------
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.tab) { state.tab = d.tab; render(); window.scrollTo(0, 0); return; }
  if (d.mode) { S.mode = d.mode; saveSettings(); state.parlay.legs = []; render(); return; }
  if (d.close != null) { $('#bookDialog').close(); return; }
  if (d.book) {
    const changed = S.book !== d.book;
    S.book = d.book; saveSettings(); $('#bookDialog').close();
    state.parlay.legs = []; state.parlay.banned = [];
    if (changed) { state.slip = []; LS.set('ss_slip', []); }
    state.filter.market = 'all';
    recompute(); render();
    if (source() === 'key' && !regionsNeeded().every(r => Object.values(state.games).every(g => (g.regions || []).includes(r)))) refresh(true);
    return;
  }
  if (d.fs) { state.filter.sport = d.fs; render(); return; }
  if (d.fm) { state.filter.market = d.fm; render(); return; }
  if (d.add) {
    const i = state.slip.indexOf(d.add);
    if (i >= 0) state.slip.splice(i, 1); else { state.slip.push(d.add); toast('Added to My Slip (Parlay tab)'); }
    LS.set('ss_slip', state.slip); render(); return;
  }
  if (d.unslip) { state.slip = state.slip.filter(x => x !== d.unslip); LS.set('ss_slip', state.slip); render(); return; }
  if (d.rm) { removeLeg(d.rm); render(); return; }
  if (d.prop) { loadProps([d.prop]); return; }
  switch (d.act) {
    case 'pickbook': openBooks(); break;
    case 'nminus': state.parlay.n = Math.max(2, state.parlay.n - 1); state.parlay.legs = []; render(); break;
    case 'nplus': state.parlay.n = Math.min(12, state.parlay.n + 1); state.parlay.legs = []; render(); break;
    case 'build': state.parlay.banned = []; buildParlay(false); render(); break;
    case 'reroll': buildParlay(true); render(); break;
    case 'toslip': state.parlay.legs.forEach(l => { if (!state.slip.includes(l.id)) state.slip.push(l.id); }); LS.set('ss_slip', state.slip); toast('Copied to My Slip'); render(); break;
    case 'clearslip': state.slip = []; LS.set('ss_slip', []); render(); break;
    case 'props5': loadProps(allEvents().filter(e => sportOf(e.sport_key).props.length && !state.props[e.id]).slice(0, 5).map(e => e.id)); break;
    case 'clearcache': state.games = {}; state.props = {}; LS.set('ss_games', {}); LS.set('ss_props', {}); recompute(); toast('Cache cleared'); render(); break;
  }
});
$('#refreshBtn').addEventListener('click', () => refresh(true));
// Slider updates live while dragging, without re-rendering the whole page.
document.addEventListener('input', e => { if (e.target.id === 'target') updateTarget(Number(e.target.value)); });
$('#bookDialog').addEventListener('click', e => { if (e.target.id === 'bookDialog') e.target.close(); });

document.addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if (t.id === 'target') { LS.set('ss_target', state.parlay.target); return; }
  if (t.id === 'stake') { state.parlay.stake = Math.max(0, Number(t.value) || 0); LS.set('ss_stake', state.parlay.stake); render(); return; }
  if (d.sport) { S.sports = t.checked ? [...new Set([...S.sports, d.sport])] : S.sports.filter(x => x !== d.sport); saveSettings(); return; }
  if (d.mkt) { S.markets[d.mkt] = t.checked; saveSettings(); recompute(); return; }
  if (d.set) {
    const k = d.set;
    if (t.type === 'checkbox') S[k] = t.checked;
    else if (t.type === 'number') S[k] = Number(t.value);
    else S[k] = t.value.trim();
    if (k === 'apiKey' && S.apiKey) S.demo = false;
    if (k === 'source' && S.source === 'key' && !S.apiKey) toast('Add your API key below');
    if (k === 'source' && S.source === 'server' && !serverUrl()) toast('Add the server address below');
    saveSettings();
    if (['apiKey', 'source', 'serverUrl'].includes(k)) {
      state.demoData = null; state.games = {}; state.props = {}; state.credits = null; state.error = '';
      LS.set('ss_games', {}); LS.set('ss_props', {});
      if (source() === 'demo') loadDemo(); else refresh(true);
      render();
    }
    else { recompute(); render(); }
  }
});

// ---------- BOOT ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
if (source() === 'demo') loadDemo(); else { recompute(); render(); refresh(false); }
if (!S.book) setTimeout(openBooks, 300);
