# OSRS Toolkit

An installable web app for Old School RuneScape. It works on your phone and your PC, and opens offline once installed.

- **Next**: a ranked to-do list built from your levels, quest log and diaries.
- **Skills**: enter your 24 levels. For each skill it shows the best training method now, the next method you'll unlock, the next quest or diary level target, and roughly how many hours to 99.
- **Quests**: all 184 quests and 19 miniquests. Tick them off, see what's ready, and see exactly what's blocking the rest.
- **Diaries**: all 48 achievement diary tiers (12 regions × 4 tiers), with what's still missing and what they reward.
- **PvM**: every boss on the hiscores (71), every Slayer-locked monster (50) and popular training spots, rated Ready, Almost, Locked or Later for your stats.
- **Alch**: a live, ranked list of the most profitable items to high alch, refreshed every minute from the OSRS Wiki's real-time prices.

Your levels and ticks are saved in your browser. Nothing is uploaded anywhere.

## Put it on GitHub Pages (one time, about 2 minutes)

1. On github.com, click **New repository**. Name it something like `osrs-toolkit` and set it to **Public**. GitHub Pages is free for public repos.
2. On the new repo's page, click **uploading an existing file** and drag in **everything inside this folder**, including the `icons` and `proxy` folders. Then click **Commit changes**.
   - Or, from a terminal in this folder:
     ```
     git remote add origin https://github.com/YOUR-NAME/osrs-toolkit.git
     git push -u origin main
     ```
3. In the repo, go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the **main** branch and the **/ (root)** folder, and click **Save**.
4. After a minute your app is live at `https://YOUR-NAME.github.io/osrs-toolkit/`.

## Install it as an app

- **Android (Chrome):** open the link, then tap **⋮ → Add to Home screen → Install**.
- **iPhone (Safari):** open the link, then tap **Share → Add to Home Screen**.
- **PC (Chrome or Edge):** click the install icon at the right end of the address bar.

It opens full-screen with its own icon, and still works without internet. Only the live prices need a connection.

## Moving your data

- **From the desktop app:** go to **Skills → Sync & backup settings → Import backup / desktop config** and pick `osrs_helper_config.json` from the folder next to the .exe or .py.
- **Between devices:** **Export backup** on one device, then **Import** on the other. Each browser keeps its own copy.

## Live sync (optional)

The **Sync** button tries to pull your levels and kill counts from the official hiscores, and your completed quests and diaries from the OSRS Wiki's **WikiSync**. For WikiSync to have your data, install the WikiSync plugin in RuneLite and log in once.

Browsers block websites from reading another site's data unless that site allows it, and the OSRS hiscores don't allow it. So the Sync button will most likely say *blocked by the browser*. Typing your levels works fine without it. To enable live sync, set up the small free proxy in `proxy/worker.js`:

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
2. Go to **Workers & Pages → Create → Create Worker**, name it (for example `osrs-proxy`), and click **Deploy**.
3. Click **Edit code**, replace everything with the contents of `proxy/worker.js`, put your name in `USER_AGENT`, and click **Deploy**.
4. Copy the worker's URL (`https://osrs-proxy.<you>.workers.dev`) into the app under **Skills → Sync & backup settings → Live-data proxy URL**, then press **Sync**.

The worker only forwards requests to the hiscores and WikiSync, so nobody can use it as a general proxy. The free tier allows 100,000 requests a day.

The **Alch** tab doesn't need the proxy, because the Wiki's price API allows websites to read it.

## Updating

Edit the files and push them to GitHub. Installed copies pick up the new version the next time they're opened. All the game data lives in `data.js` as plain tables (quests, miniquests, diaries, PvM, training methods), so you can add to or correct it directly.

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app itself |
| `logic.js` | The advice engine (a direct port of the desktop app's `Account` class) |
| `data.js` | All game data |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable and work offline |
| `proxy/worker.js` | Optional live-sync proxy (Cloudflare Worker) |

## Credits

Quest, miniquest and diary requirements come from the [RuneLite Quest Helper](https://github.com/Zoinkwiz/quest-helper) plugin and the [OSRS Wiki](https://oldschool.runescape.wiki). Boss and Slayer data comes from the OSRS Wiki and RuneLite. Prices come from the [OSRS Wiki real-time prices API](https://prices.runescape.wiki). XP rates and "recommended levels" are rough guides.

This is a fan-made tool and isn't affiliated with Jagex. Old School RuneScape is a trademark of Jagex Ltd.
