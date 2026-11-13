/* =====================================================================
   SharpSlip shared odds server: a Cloudflare Worker.
   Fetches odds from The Odds API ONCE, caches them, and serves the same
   copy to every phone running the app. Your API key stays here as a
   secret and is never sent to the app.

   Required:  secret  ODDS_API_KEY   (your key from the-odds-api.com)
   Recommended: KV namespace binding named ODDS_CACHE (shared cache)
   Optional variables (Settings → Variables), defaults shown in CONFIG_DEFAULTS.
   ===================================================================== */

const CONFIG_DEFAULTS = {
  LINES_TTL_MIN: 10,              // how long game lines stay cached (minutes)
  PROPS_TTL_MIN: 30,              // how long player props stay cached (minutes)
  HOURS_AHEAD: 48,                // only fetch games starting within this many hours
  LINE_REGIONS: 'us,us2,us_ex',   // sportsbooks + Kalshi/Polymarket/exchanges
  PROP_REGIONS: 'us,us2,us_dfs',  // sportsbooks + PrizePicks/Underdog/Pick6
  RESERVE_CREDITS: 25,            // never spend below this many credits
  RESET_DAY: 1,                   // day of month your Odds API credits reset
  ALLOWED_ORIGIN: '*',            // e.g. https://yourname.github.io to only allow your app
};

const API = 'https://api.the-odds-api.com/v4';
const LINE_MARKETS = ['h2h', 'spreads', 'totals'];
// Must match SPORTS in the app's app.js
const SPORT_PROPS = {
  americanfootball_nfl: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_anytime_td'],
  americanfootball_ncaaf: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds'],
  basketball_nba: ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  basketball_ncaab: ['player_points', 'player_rebounds', 'player_assists'],
  basketball_wnba: ['player_points', 'player_rebounds', 'player_assists'],
  baseball_mlb: ['batter_hits', 'batter_total_bases', 'batter_home_runs', 'pitcher_strikeouts'],
  icehockey_nhl: ['player_points', 'player_shots_on_goal', 'player_goal_scorer_anytime'],
  soccer_epl: ['player_goal_scorer_anytime', 'player_shots_on_target'],
  soccer_usa_mls: ['player_goal_scorer_anytime'],
  soccer_uefa_champs_league: ['player_goal_scorer_anytime'],
  soccer_spain_la_liga: [],
  mma_mixed_martial_arts: [],
  boxing_boxing: [],
};

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const cfg = (env, k) => {
  const v = env[k], d = CONFIG_DEFAULTS[k];
  if (v == null || v === '') return d;
  return typeof d === 'number' ? Number(v) : String(v);
};
const list = s => String(s).split(',').map(x => x.trim()).filter(Boolean);
const isoNoMs = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const today = () => new Date().toISOString().slice(0, 10);

// ---------- storage: in-memory first, then KV (shared across all Cloudflare locations) ----------
const mem = new Map();
const store = {
  async get(env, key, ttlMs) {
    const m = mem.get(key);
    if (m && Date.now() - m.at < ttlMs) return m;
    if (env.ODDS_CACHE) {
      const v = await env.ODDS_CACHE.get(key, 'json');
      if (v) { mem.set(key, v); return v; }
    }
    return m || null;
  },
  async put(env, key, value) {
    mem.set(key, value);
    if (env.ODDS_CACHE) await env.ODDS_CACHE.put(key, JSON.stringify(value), { expirationTtl: 3 * 86400 });
  },
};

// ---------- credit budget: spreads remaining credits evenly over the rest of the month ----------
function daysLeft(env) {
  const now = new Date(), day = cfg(env, 'RESET_DAY');
  let reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (reset <= now) reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));
  return Math.max(1, Math.ceil((reset - now) / 86400000));
}
async function getMeta(env) {
  const m = (await store.get(env, 'meta', 0)) || { at: 0 };
  if (m.day !== today()) { m.day = today(); m.spentToday = 0; m.dayStart = m.remaining ?? null; }
  return m;
}
const saveMeta = (env, m) => { m.at = Date.now(); return store.put(env, 'meta', m); };
function dailyBudget(env, m) {
  if (m.dayStart == null) return Infinity;
  return Math.floor((m.dayStart - cfg(env, 'RESERVE_CREDITS')) / daysLeft(env));
}
function canSpend(env, m, cost) {
  if (cost <= 0) return true;
  if (m.remaining != null && m.remaining - cost < cfg(env, 'RESERVE_CREDITS')) return false;
  return m.spentToday + cost <= Math.max(dailyBudget(env, m), m.spentToday === 0 ? cost : 0);
}
function creditSummary(env, m) {
  const b = dailyBudget(env, m);
  return { remaining: m.remaining ?? null, used: m.used ?? null, spentToday: m.spentToday || 0, dailyBudget: Number.isFinite(b) ? b : null, daysLeft: daysLeft(env) };
}

async function oddsFetch(env, meta, path, params = {}) {
  if (!env.ODDS_API_KEY) throw new HttpError(500, 'Server is missing the ODDS_API_KEY secret.');
  const u = new URL(API + path);
  u.searchParams.set('apiKey', env.ODDS_API_KEY);
  for (const k in params) u.searchParams.set(k, params[k]);
  const res = await fetch(u.toString());
  const rem = res.headers.get('x-requests-remaining'), used = res.headers.get('x-requests-used'), last = res.headers.get('x-requests-last');
  if (rem != null) {
    meta.remaining = Number(rem);
    meta.used = Number(used);
    meta.spentToday = (meta.spentToday || 0) + Number(last || 0);
    if (meta.dayStart == null) meta.dayStart = meta.remaining + Number(last || 0);
  }
  if (res.status === 401) throw new HttpError(502, 'The Odds API rejected the server key.');
  if (res.status === 429) throw new HttpError(503, 'The Odds API credits are used up for now.');
  if (!res.ok) throw new HttpError(502, `Odds API error ${res.status}`);
  return res.json();
}

// Serve from cache when fresh; otherwise fetch (if the budget allows) or fall back to the last copy.
async function cached(env, key, ttlMin, cost, fetcher) {
  const ttl = ttlMin * 60000;
  const entry = await store.get(env, key, ttl);
  if (entry && Date.now() - entry.at < ttl) return { ...entry, stale: false };
  const meta = await getMeta(env);
  if (!canSpend(env, meta, cost)) {
    if (entry) return { ...entry, stale: true, reason: 'Saving credits; showing the last odds fetched.' };
    throw new HttpError(503, 'Daily credit budget reached. Fresh odds will load later.');
  }
  try {
    const data = await fetcher(meta);
    const e = { at: Date.now(), data };
    await store.put(env, key, e);
    await saveMeta(env, meta);
    return { ...e, stale: false };
  } catch (err) {
    await saveMeta(env, meta);
    if (entry) return { ...entry, stale: true, reason: err.message };
    throw err;
  }
}

// ---------- routes ----------
async function route(url, env) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;

  if (p === '/' || p === '/status') {
    const m = await getMeta(env);
    return { ok: true, name: 'SharpSlip odds server', keySet: !!env.ODDS_API_KEY, sharedCache: !!env.ODDS_CACHE, credits: creditSummary(env, m) };
  }

  if (p === '/sports') {
    const r = await cached(env, 'sports', 360, 0, meta => oddsFetch(env, meta, '/sports'));
    return { at: r.at, data: r.data.map(s => s.key) };
  }

  const sport = q.get('sport') || '';
  if (!(sport in SPORT_PROPS)) throw new HttpError(400, 'Unknown sport.');

  if (p === '/odds') {
    const regions = list(cfg(env, 'LINE_REGIONS'));
    const r = await cached(env, 'odds:' + sport, cfg(env, 'LINES_TTL_MIN'), LINE_MARKETS.length * regions.length, meta =>
      oddsFetch(env, meta, `/sports/${sport}/odds`, {
        regions: regions.join(','), markets: LINE_MARKETS.join(','), oddsFormat: 'decimal',
        commenceTimeFrom: isoNoMs(Date.now()), commenceTimeTo: isoNoMs(Date.now() + cfg(env, 'HOURS_AHEAD') * 3600000),
      }));
    return { at: r.at, stale: r.stale, reason: r.reason, data: r.data, credits: creditSummary(env, await getMeta(env)) };
  }

  if (p === '/props') {
    const event = q.get('event') || '';
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(event)) throw new HttpError(400, 'Bad event id.');
    // Only allow props for games we already know about, so nobody can burn credits with made-up ids.
    const lines = await store.get(env, 'odds:' + sport, Infinity);
    const ev = (lines?.data || []).find(e => e.id === event);
    if (!ev) throw new HttpError(404, 'Game not found. Refresh game lines first.');
    const markets = SPORT_PROPS[sport];
    if (!markets.length) return { at: Date.now(), data: { bookmakers: [] } };
    const regions = list(cfg(env, 'PROP_REGIONS'));
    const r = await cached(env, 'props:' + event, cfg(env, 'PROPS_TTL_MIN'), markets.length * regions.length, async meta => {
      const d = await oddsFetch(env, meta, `/sports/${sport}/events/${event}/odds`, { regions: regions.join(','), markets: markets.join(','), oddsFormat: 'decimal' });
      return { bookmakers: d.bookmakers || [] };
    });
    return { at: r.at, stale: r.stale, reason: r.reason, data: r.data, credits: creditSummary(env, await getMeta(env)) };
  }

  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const headers = {
      'Access-Control-Allow-Origin': cfg(env, 'ALLOWED_ORIGIN'),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers });
    try {
      return new Response(JSON.stringify(await route(new URL(request.url), env)), { headers });
    } catch (e) {
      const status = e.status || 500;
      return new Response(JSON.stringify({ error: e.message || 'Server error' }), { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
  },
};
