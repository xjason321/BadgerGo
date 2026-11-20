# Bike Nav
`npm install && npm run dev` then open the printed URL. `npm test` runs the core tests.
- Change city in `src/config.ts` (BCycle system id from `gbfs.bcycle.com/<id>/gbfs.json`).
- `src/core/` is UI-free: gbfs, geocode, routing (provider interface), planner, pricing.

## Routing
- `src/core/planner.ts`: if one ride won't fit your limit, it searches for chains of swap docks (dock, re-rent, ride on), with no cap on how many, where every ride fits, ranked by total time (least detour first). From each dock it asks the router about the docks near where your limit would run out, tries the most promising states first (weighted A*), and drops any that can't beat the best chain found or that reach a dock no faster than an earlier path. There's a per-pick-up-dock request budget to protect the routing server. The straight-through ride is always listed for comparison.
- Road preferences (`src/core/prefs.ts`) are passed to the public Valhalla router (`valhalla1.openstreetmap.de`). If it is down or slow, the app falls back to OSRM, which ignores them (the UI says so).
- Free public servers: fine for personal use, but self-host Valhalla for anything heavier.

## BadgerGo UI notes
- Phones: the panel is a bottom sheet (drag the handle or tap it to cycle peek / half / full). Desktop (900 px+): left column.
- Tap a dock for its bikes/docks and an "Open in BCycle" link. Long-press (right-click on desktop) anywhere on the map to set it as start or end.
- Dock outlines: only once a route is selected, its pick-up dock is green / yellow / red by bikes (more than 2 / 1-2 / none) and its swap or end docks by open docks. Every other dock (and all docks before a route exists) the ring is a gauge: blue up to the share of bikes, white above.
- City limits (`BOUNDARY_OSM_ID` in `src/config.ts`) come from OpenStreetMap on first load and are cached in the browser. Outside them is dimmed 40%.
- Logo: `public/badgergo-logo.png`. The Inter font loads from Google Fonts (see `index.html`).
- A copy of the project from before this redesign is in `backups/2026-11-17-before-badgergo/`.

## Analytics dashboard

Anonymous usage counts, shown at `https://badgergo.app/analytics` (anyone with the link can open it; it is marked `noindex`).

- **What is counted:** per day, how many devices opened the app (unique over 1/7/30/90 days), new devices, devices open by hour, device kind, browser vs Home Screen app, and counts of a few features (routes planned, rides started, shares, edits, timer, alerts, nearest bike/dock). No identifiers, places, or routes are sent. Browsers with Do Not Track / Global Privacy Control on, automated browsers and bots are not counted.
- **Two deploys, on purpose:** the site is built and deployed by Cloudflare from GitHub (Node 22, pinned in `.node-version` because wrangler needs it); the stats Worker is deployed by hand with `npm run deploy:stats`. Its config is `wrangler.stats.jsonc`, not `wrangler.jsonc`, so the site's `wrangler deploy` never picks it up.
- **How:** a separate Cloudflare Worker (`worker/`, config in `wrangler.stats.jsonc`) on the route `badgergo.app/api/*` keeps the counts in a SQLite Durable Object. The site itself stays static. The page and the reporting code live in `src/analytics/` and `src/ui/usage.ts`.
- **Deploy the counter once** (the zone `badgergo.app` must be on your Cloudflare account):
  ```
  npm install
  npx wrangler login
  npm run deploy:stats
  ```
  Then deploy the site as usual. Numbers start from the first visit after both are live.
- `npm run build` type-checks the app and the worker; `npm test` covers both.

## Bike timer notifications

While the bike timer runs and the rider has switched to another app, phones freeze BadgerGo after about a minute, so the page can't update its own notification. Instead the same Worker pushes it (Web Push): once a minute it sends the countdown, and at 10 min, 5 min, time-up and each extra charge it sends a louder alert. Without this set up the app falls back to updating the notification itself, which stops about a minute after the rider leaves the app.

- **One-time setup** (after `npm run deploy:stats` works):
  ```
  npm run vapid          # prints the two commands below with your new key pair
  npx wrangler secret put VAPID_PUBLIC_KEY -c wrangler.stats.jsonc
  npx wrangler secret put VAPID_PRIVATE_JWK -c wrangler.stats.jsonc
  npm run deploy:stats
  ```
  Until both secrets exist, `/api/push/key` answers 404 and the app uses its own notifications. Keep the private value out of the repo.
- **iPhone:** web push only works for the Home Screen app (iOS 16.4 or later). In Safari the app keeps its old behaviour.
- **What the server keeps:** only while a ride is on, the phone's push address and the ride's start time. They are deleted when the rider taps Stop, when the phone drops the subscription, or after 3 hours. Only real push services (Google, Apple, Mozilla, Microsoft) are accepted as destinations.
