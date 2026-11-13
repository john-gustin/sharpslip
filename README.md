# SharpSlip

A free mobile web app that finds value bets, safer picks, and auto-built parlays at the book you choose. There's no login and no server. Each person uses their own free odds key from the-odds-api.com.

## Share it with friends (free, about 5 minutes)
1. Create a free GitHub account, then a new **public** repository (e.g. `sharpslip`).
2. Click **Add file → Upload files** and drag in everything in this folder. Then click **Commit**.
3. Go to **Settings → Pages**. Under "Branch" choose `main` and `/ (root)`, then click **Save**.
4. About a minute later your app is live at `https://YOUR-NAME.github.io/sharpslip/`. Text that link to friends.
5. On the phone, open the link. On iPhone (Safari) tap **Share → Add to Home Screen**. On Android (Chrome) tap **⋮ → Install app**.

Netlify Drop (app.netlify.com/drop) works too: drag the folder in.

## Each user's first-time setup
- Pick your book (DraftKings, FanDuel, Hard Rock, PrizePicks, Kalshi, …).
- Settings → paste a free key from https://the-odds-api.com (500 credits per month free).

## Where to change things (app.js)
- `BOOKS`: the book list and which Odds API region each one is in
- `BOOK_WEIGHT`: how much each book counts toward the "fair" price
- `SPORTS`: leagues and which player-prop markets to load
- `DEFAULTS`: default settings (minimum edge, safe-mode limits, etc.)
- After changing files, bump `CACHE` in `sw.js` (e.g. `sharpslip-v2`) so installed copies pick up the update.
