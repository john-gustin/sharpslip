# Set up the shared odds server (Cloudflare, free)

Once this is running, the app fetches odds **once** and every friend shares that copy. Friends don't need their own key, and your key stays hidden on the server.

Takes about 10 minutes. Cloudflare's buttons may be worded slightly differently from what's below.

## 1. Create the Worker
1. Log in at **dash.cloudflare.com**.
2. In the left menu, open **Workers & Pages** (under "Compute"), then click **Create** → **Create Worker** (or "Start with Hello World").
3. Name it **`sharpslip-odds`**, then click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, paste in the whole contents of [`worker.js`](worker.js), then click **Deploy**.

## 2. Add your Odds API key (as a secret)
1. Open the Worker, then go to **Settings** → **Variables and Secrets** → **Add**.
2. Set **Type** to **Secret**, **Name** to `ODDS_API_KEY`, and **Value** to your key from the-odds-api.com.
3. Click **Deploy** (or Save).

## 3. Add the shared cache (KV)
1. In the left menu, go to **Storage & Databases** → **KV**, then click **Create** (or "Create namespace").
2. Name it `sharpslip-cache` and click **Add** / **Create**.
3. Go back to your Worker, then **Settings** (or the **Bindings** tab) → **Add binding** → **KV namespace**.
4. Set **Variable name** to `ODDS_CACHE` and **KV namespace** to `sharpslip-cache`. Save/Deploy.

## 4. Check it
Open `https://sharpslip-odds.<your-subdomain>.workers.dev/status` in a browser. Cloudflare shows this address on the Worker's page.

You should see `"keySet":true` and `"sharedCache":true`.

Send that address (without `/status`) to Claude so it can be built into the app. Or paste it into the app under Settings → "Shared server address".

## Optional settings (Worker → Settings → Variables, type "Text")
| Name | Default | What it does |
|---|---|---|
| `LINES_TTL_MIN` | 10 | Minutes game lines stay cached |
| `PROPS_TTL_MIN` | 30 | Minutes player props stay cached |
| `RESET_DAY` | 1 | Day of the month your Odds API credits reset (see your Odds API account) |
| `RESERVE_CREDITS` | 25 | Never spend below this |
| `ALLOWED_ORIGIN` | * | Set to `https://john-gustin.github.io` so only your app can use the server from a browser |
| `LINE_REGIONS` | us,us2,us_ex | Sportsbooks + Kalshi/Polymarket |
| `PROP_REGIONS` | us,us2,us_dfs | Sportsbooks + PrizePicks/Underdog/Pick6 |

## How many credits does it use?
- **Game lines:** 9 credits per sport each time they refresh (at most every 10 minutes, and only when someone has the app open).
- **Player props:** about 9–15 credits per game, loaded only when someone taps Load. They're then shared for 30 minutes.
- The server **spreads your remaining credits evenly over the days left in the month**. When today's share is used up, everyone sees the last saved odds until the next day, so it can't run dry early.
- A **free key** (500 a month) gives about 25 credits a day, roughly 2–3 refreshes a day, so expect older odds. The **$30/month plan** (20,000 credits) gives about 650 a day, which is plenty for a group of friends.
