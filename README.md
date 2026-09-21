# Artist Ecosystem Dashboards

One view of an artist across the three systems that each hold a piece of the picture:

| Source | Layer it covers |
|---|---|
| **Sprout Social** | Owned social — followers, impressions, engagements, post performance |
| **Chartmetric** | Consumption — Spotify monthly listeners, followers, listener geography |
| **RealCount** | Live — ticket counts, capacity, sell-through by show |

Sprout is scoped to a single group (Alter Music Group), and everything is grouped **by
artist** rather than by profile. Inside each artist you can toggle between **all
accounts, artist-owned, and fan accounts**, filter by platform, and turn individual
accounts in or out of the ecosystem.

The view that justifies putting all three in one app is **Demand to live conversion**:
each tour market's ticket sell-through plotted against that city's monthly listeners.
Heavy listening plus soft ticket sales is a marketing problem; a sellout against a
modest listener base means the room was too small.

---

## Artist tabs

Clicking into an artist gives three tabs:

- **Overview** — reach, audience over time, consumption.
- **Posts** — every post from the selected accounts, as a grid or a table, with search
  and sort by views / likes / comments / shares / engagement rate.
- **UGC** — what creators are doing with the artist's music: top sounds, who is
  using them, the top creators, and the actual videos for any sound.
- **Live** — box office, demand-to-live conversion, markets and shows.
- **Accounts** — every Sprout profile behind this artist. Toggle one off to remove it
  from every number, or correct a wrong artist/fan call. Changes persist server-side.

Overview and Posts are scoped by two filters that sit above them: **platform**
(All / Instagram / TikTok / …) and **account type** (All / Artist-owned / Fan accounts),
each showing how many accounts sit behind it.

Chartmetric and RealCount are artist-level — a fan page has no streams or box office —
so Consumption and the whole Live tab are deliberately **not** scoped by those filters.
The Live tab shows only the date range, and Overview says so whenever a filter is active.

## How artist vs fan accounts are decided

Sprout has no account-type field, so this is inferred. Four signals, highest confidence
first — whichever fires first wins, and the Accounts tab shows which one it was:

| Priority | Signal | Set it via |
|---|---|---|
| 1 | Manual correction | The **Accounts** tab (persisted server-side) |
| 2 | Per-artist config | `fanProfileIds` / `artistProfileIds` in `config/artists.json` |
| 3 | Sprout sub-group | `SPROUT_ARTIST_GROUP_ID` / `SPROUT_FAN_GROUP_ID` |
| 4 | Profile name | Fan-page conventions: `fan`, `updates`, `daily`, `news`, `archive`, `source`, `charts`, `tracker`, `nation`, `army` |

If your Sprout group already splits artist-owned from fan-run into sub-groups, set the
two group IDs and it stops guessing from names entirely. `npm run verify:apis` prints
the classification for every profile so you can check it before anyone trusts a number.

Those same fan-page words are stripped when folding profiles into artists, so
"Halcyon Grove Updates" lands on Halcyon Grove instead of becoming its own roster row.

## Running it locally

Needs **Node 20+** (`node --version` to check; if you're short, use `nvm install 22`).

```bash
git clone https://github.com/gwagner08/artist_ecosystem_dashboards.git
cd artist_ecosystem_dashboards
npm install
npm run dev
```

Open **http://localhost:5173**. That's it — no credentials needed. It boots on
generated demo data and every screen says so in an amber banner. The demo artists are
invented placeholders prefixed `DEMO`; no real roster, client or revenue data is in
this repo.

`npm run dev` runs two processes together: the API on `:8787` and the UI on `:5173`.
The UI proxies `/api` to the server, so you only ever open `:5173`. Ctrl-C stops both.

When you're ready for real data, `cp .env.example .env`, fill in what you have, and
restart. Each provider is independent — Sprout alone is enough to be useful, and the
other two keep serving demo data until you add them.

**If something won't start:**

| Symptom | Fix |
|---|---|
| `EADDRINUSE :8787` or `:5173` | Something else is on the port. `PORT=8788 npm run dev`, or kill the old process. |
| Blank page, console 500s | The API didn't start. Look at the `server` lines in the terminal. |
| `Cannot find module` | `rm -rf node_modules package-lock.json && npm install` |
| Changes not appearing | The server does not hot-reload config or `.env`. Restart `npm run dev`. |

## Going live

1. **Fill in `.env`.** See `.env.example` — each provider is independent, so you can
   turn them on one at a time.
2. **Run the verifier.**
   ```bash
   npm run verify:apis
   ```
   This is the important step. It reads only, and it reports:
   - your Sprout customer IDs and every group ID + name, so you can find Alter Music Group's
   - how many profiles are in that group, by network
   - **which metrics your Sprout plan actually supports**, probed one at a time
   - how profiles folded into artists, and which artists are missing IDs
   - Chartmetric auth and whether the response shapes parse
   - which roster names resolve to RealCount events, with next show and sell-through
3. **Check the matching.** Neither Chartmetric nor RealCount needs per-artist config
   to start: Chartmetric artists are resolved from the artist name, and RealCount
   filters events by name. `verify:apis` reports which names resolved. Pin an ID in
   `config/artists.json` only for the ones it reports as unmatched or wrong.

### Why the verifier exists

Sprout's profile metrics are **not uniform across networks**, and a single
unsupported metric name makes the whole request return 400. TikTok suffixes its
interaction metrics (`video_views_total`, `likes_total`), Instagram does not
(`video_views`, `likes`), and YouTube exposes almost nothing at profile level
beyond `lifetime_snapshot.followers_count`. So the app issues one request per
network, using the map in `server/src/clients/sprout.ts`.

Metric availability also varies by Sprout plan. If `verify:apis` reports a metric
as rejected, delete it from `NETWORK_PROFILE_METRICS` and it stops being requested.

### Chartmetric

UGC uses `/artist/{id}/top-tracks/tiktok` for sounds,
`/artist/{id}/tiktok-influencer-stats` for the creator breakdown,
`/artist/{id}/tiktok-top-influencers` for the creators themselves, and
`/track/{id}/topVideos` (or `/track/youtube/{id}/topShorts`) for the videos using one
sound. These are **premium** endpoints: a plan without them returns empty rather than
an error, which is indistinguishable from an artist nobody has made content with, so
the UGC tab says as much instead of claiming there is no activity.

The video drill-down is a separate request, made only when a sound is opened, so the
artist page does not pay for it. The roster skips UGC entirely.

**What the date range does and does not scope.** Sounds are all-time — the
`top-tracks` endpoint takes no date filter, so no range can narrow it. Videos and the
influencer breakdown do honour the range, via `postedWithinDaysAgo` and `periodDays`.
The UGC tab says which is which rather than letting the range look broken. YouTube
Shorts have no server-side date filter at all, so a windowed request pulls by recency
with a wide limit, cuts to the window, then re-sorts by the requested metric —
filtering after an all-time sort would return the top videos and discard nearly all
of them.

The panel's own age, gender and language mix is presented as a demographics card —
gender donut, age pyramid with the two genders mirrored about a shared centre, and
ranked language shares — with a chart/table toggle. Gender takes the two poles of the
brand palette rather than a categorical slot, so the two series separate in greyscale
and under any colour-vision deficiency. It reports the influencers' OWN demographics;
Chartmetric's equivalent card shows their audiences', which is a different aggregate
this endpoint does not return, so the two are named apart.

**The influencer panel is not a creator count.** `tiktok-influencer-stats` and
`tiktok-top-influencers` cover accounts Chartmetric classifies as influencers, which
is a small fraction of everyone who used a sound, skewed to large accounts in major
markets. The UI labels it a panel and says so, because reading it as total creator
reach understates the real number badly and misrepresents the geography — the videos
section routinely shows creators absent from the panel.

Endpoints used: `/artist/{id}` for artwork, `/artist/{id}/cmStats` for the headline
monthly-listener count, `/artist/{id}/stat/spotify` for the time series, and
`/artist/{id}/where-people-listen?latest=true` for listener geography.

Listener cities are keyed by city NAME in that response — the row itself has no city
field — and since August 2024 Spotify supplies only estimates at city level, with
Chartmetric modelling the gaps. Good enough to rank markets against ticket sales; not
a number to quote as fact.

Artist artwork on the roster comes from `GET /api/artist/{id}` (`image_url`), cached
for a day. Photos render black and white and lift to colour on hover, per the brand's
imagery rules; an artist with no photo falls back to initials.

Artist names are resolved to Chartmetric IDs automatically, and the result is cached
for a day. **Only an exact name match is used** — ignoring case and punctuation. A
fuzzy top-result match would quietly attribute another artist's streams to yours,
which is worse than showing nothing, so anything less than exact returns candidates
for you to pin as `chartmetricArtistId` in `config/artists.json` instead.

Accents are folded before comparison, and if the name as written finds no exact
match the search retries plainer spellings (ASCII, and without a leading "The").
Where several artists share a name exactly, the most prominent wins — Chartmetric's
rank where present, otherwise Spotify monthly listeners.

Artists that still do not match are named in a banner on the roster, with their
closest Chartmetric names and IDs, since those are the cards with no photo and no
streaming numbers.

**To sanity-check the whole roster**, run `npm run check:chartmetric`. It uses the
same resolver the app does, so it proves what the dashboard is actually reading, and
prints each artist's matched Chartmetric name, monthly listeners, followers and a
direct link. Two things get flagged before the table: one Chartmetric record claimed
by two roster artists, and a match whose name came back different. Listener counts are
the fastest tell — an artist you know does 200K showing 40M is a bad match.

The artist page also links its Chartmetric ID beside the streaming chart, so any
single number can be confirmed in one click. An automatic match is
labelled "matched by name" beside the streaming chart, so a wrong one is visible
rather than believed.

### RealCount

RealCount API v2, at `https://realcount.pro`. Credentials come from
[realcount.pro/settings/account](https://realcount.pro/settings/account) and go in as
`x-client-id` / `x-client-secret` headers.

Unlike the other two providers, **RealCount needs no per-artist ID** — it filters
events by artist name. So if an artist returns no events, that is almost always a name
mismatch rather than an empty calendar; set `realcountArtistName` in
`config/artists.json` to whatever RealCount books them under. `verify:apis` checks
every roster name against RealCount and reports which resolve.

**`/api/v2/events` sorts `performance_date` ASCENDING and has no date filter**, so
paging it plainly walks an artist's history from their earliest show forward — on a
catalogue account thousands of events deep, with the shows anyone cares about at the
far end. The client instead asks for the two slices that matter, `upcoming=true` and
`updated_since=<window start>`, and merges them, falling back to plain pagination
only when both are empty.

The event object already carries `capacity`, `total_count` and `percent_sold`, so
listing events covers every headline number.

**Gross is not read.** It is not available on this account, so displaying it would
mean displaying zero — which reads as "this tour grossed nothing" rather than "we
cannot see this". The Live tab shows shows-at-90%+ in its place.
`/api/v2/counts/{event_id}` is only called for sales velocity, on upcoming shows,
capped at 30 with a concurrency limit of 5 — otherwise a wide tour becomes a request
stampede.

## How artists are assembled

Sprout has profiles in groups, not artists, so the two have to be joined. There are
two modes and **the roster mode is the one you want**.

### Roster mode (recommended)

Put your roster in `config/artists.json` and it becomes authoritative: only those
artists appear, and any Sprout profile matching none of them is reported as
unassigned rather than inventing a roster row. This is what stops one artist showing
up three times because their accounts are named inconsistently.

Generate it from a plain list — one artist per line:

```bash
node tools/make-roster.mjs roster.txt
node tools/make-roster.mjs roster.txt --merge   # keeps IDs you've already pinned
```

Matching against a curated list can be looser than guessing, because the set is
closed: "Julien Baker Updates" and "Caamp, the band" attach to the right artist, and
the longest artist name wins so "King Alessi" never absorbs "Alessi Rose". Add
`sproutProfileNames` for accounts whose handle looks nothing like the artist name.

Then `npm run verify:apis` lists every profile that matched nobody — or fix them on
the roster screen itself: unassigned accounts appear in a banner with an **Assign
them** control, where each one can be attached to an existing artist or turned into a
new one. That writes a server-side override which beats every matching rule and
survives restarts, so it never needs a config edit.

### Discovery mode (the fallback)

With an empty artists list, profiles fold into artists by normalised name —
lowercased, accents folded, stripped of `official` / `music` / `band` and
punctuation, with fan-page words removed so "X Updates" lands on "X".

It is a guess and it gets things wrong: near-identical names split into separate
rows, and genuinely different acts with overlapping names can merge. `verify:apis`
reports suspected duplicates and never merges them for you — "Julien Baker" and
"Julien Baker and Torres" share every word and are different acts.

Set `"allowUnlistedArtists": true` to run both modes at once.

## Metric definitions

Worth knowing before anyone quotes these in a meeting:

- **Followers** — a snapshot, so the app takes the latest reading per profile and
  sums across profiles. Never a sum over days.
- **Engagements** — summed from whichever reaction metrics the network exposes
  (`ENGAGEMENT_PARTS` per network in `sprout.ts`). Not comparable across networks
  in absolute terms.
- **Post engagement rate** — engagements ÷ impressions, falling back to views as the
  denominator on networks with no impressions metric. The Posts table tooltip names
  which basis was used, so the number is never ambiguous.
- **Profile engagement rate** — engagements ÷ the best denominator each network offers,
  preferring **reach** (`impressions_unique`, unique viewers) over impressions, since
  impressions counts a repeat viewer more than once and flatters the rate. Instagram,
  Facebook and LinkedIn report reach; X reports impressions only; **TikTok reports
  neither at profile level**, so views (`video_views_total`) stand in rather than
  dropping TikTok from the number entirely, which is what used to happen. The UI names
  the denominator, and a per-network table shows the basis per row.

  Switching Instagram from impressions to reach raises its rate — on test data 2.6% to
  4.4% — because the denominator is smaller and more accurate. Expect historic
  comparisons against impressions-based rates to look low.

  Post-level rates use `lifetime.impressions_unique` where a network exposes it, which
  IS genuine reach on TikTok, and it is labelled as such.

  Networks reporting no denominator at all stay excluded TikTok and YouTube have no profile-level impressions
  metric, so they are excluded from both sides; including them inflates the rate
  badly. The UI names the excluded networks under the number.
- **Sell-through** — RealCount's own `percent_sold` where present (it arrives as
  0-100, not 0-1, and can exceed 100 on an oversold show), since it respects
  each event's comps and holds settings. Falls back to sold ÷ capacity. Clamped at 1.5.
- **Tickets per 1K listeners** — tickets sold in a market ÷ that market's monthly
  listeners × 1,000. Markets are matched to Chartmetric listener cities by
  **coordinates** (RealCount supplies Google Places lat/long, matched within 75km),
  falling back to city name. Hover the column to see which was used.
- **Market verdicts** — `underconverting` is sell-through < 60% with > 20K listeners;
  `underplayed` is sell-through ≥ 95%. Blunt on purpose; the thresholds are two
  constants in `server/src/ecosystem.ts`.

Deltas compare the selected window against the immediately preceding window of the
same length.

## Architecture

```
shared/types.ts          Types shared by both sides
server/src/
  config.ts              Env + config/artists.json loading (zod-validated)
  http.ts                fetch with timeout and backoff (retries 429/5xx only)
  cache.ts               In-process TTL cache — Sprout allows 60 req/min
  registry.ts            Profiles -> artists (folds fan pages onto their artist)
  accountType.ts         Artist-owned vs fan classification
  overrides.ts           Persisted manual account corrections
  ecosystem.ts           Composes the payload; the demand-to-live join
  clients/               sprout.ts, chartmetric.ts, realcount.ts - all vendor
                         quirks contained, nothing leaks outside
  fixtures/generate.ts   Deterministic demo data
  verify.ts              npm run verify:apis
web/src/
  charts/                Hand-rolled SVG — line, bar, scatter, sparkline
  views/                 Roster, artist Overview, Posts, UGC, Live, Accounts
```

API keys stay server-side; the browser only ever talks to `/api`.

**Endpoints:** `GET /api/health`, `GET /api/roster`,
`GET /api/artist/:slug?from=&to=&accountType=&network=`,
`PUT /api/accounts/:profileId` (`{ included?, accountType?, note? }`),
`DELETE /api/accounts/:profileId`, `POST /api/cache/clear`.

## Design

Firebird brand: red `#ED2124`, black `#000005`, white. Headlines are red ALL CAPS,
subtitles black/white ALL CAPS, body copy mixed case. Type is Montserrat Bold and
Lato — the brand guidelines' approved free substitutes for Algoria and Dual — loaded
from Google Fonts with a system fallback.

**The logo.** Drop the official wordmark into `web/public/brand/` and the header
picks it up; see the README in that folder for filenames and the Drive links. The
slot hides itself until then. Per brand rules the logo is never redrawn, which is why
this ships an empty slot rather than an approximation.

**One documented deviation.** Multi-series charts (followers and engagements by
network) use a categorical palette led by Firebird Red, because five networks cannot
be told apart in a single hue and colourblind separation is a hard requirement. The
order was validated for CVD separation and contrast against both the white and black
surfaces. Everything else holds the line: market verdicts, deltas and states read as
red vs black, with a text label carrying the meaning colour used to.

Every chart ships a legend, sparing direct labels, a hover tooltip and a table view —
identity is never colour alone.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + UI with hot reload |
| `npm run verify:apis` | Probe live credentials, report what works |
| `npm run check:chartmetric` | Confirm the right Chartmetric artist matched, per artist |
| `npm run check:chartmetric -- --search "name"` | Find a Chartmetric ID to pin |
| `node tools/sprout-keys.mjs` | Find your Sprout customer and group IDs (standalone) |
| `node tools/realcount-check.mjs` | Inspect what the RealCount ticket endpoints return (standalone) |
| `node tools/make-roster.mjs roster.txt` | Build config/artists.json from a list of names |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | Build the UI to `dist/web` |
| `npm start` | Production — serves the built UI from the API server |

## Deploying to Render

`render.yaml` is a working blueprint — commit it and use **New → Blueprint**, or create
a Web Service by hand with:

- **Build:** `npm ci --include=dev && npm run build`
- **Start:** `npm start`
- **Health check:** `/api/health`

Pick your plan first:

- **Starter (paid).** What the blueprint ships. Keeps a mounted disk, so account
  corrections survive deploys, and the service never sleeps.
- **Free.** Delete the `disk:` block, set `plan: free`, drop `OVERRIDES_PATH`.
  Everything works; Accounts-tab corrections reset on each deploy and the service
  sleeps after ~15 minutes idle, so the first load is slow.

Two things that will bite otherwise:

- **`--include=dev` is required.** Render sets `NODE_ENV=production`, which makes npm
  skip devDependencies — and `vite` and `typescript` live there, so the build fails
  without it. (`tsx` is a real dependency, not a dev one, because `npm start` runs on it.)
- **Mount a disk for account overrides.** The Accounts tab writes to a JSON file at
  `OVERRIDES_PATH`. Render's filesystem is ephemeral, so without a disk every manual
  correction is wiped on redeploy. The blueprint mounts one at `/var/data` and points
  `OVERRIDES_PATH` at it. The Accounts tab warns you when storage looks ephemeral.

`config/artists.json` is committed on purpose — it holds no secrets, only artist
names and integer IDs, and Render reads it from the repo. Without it in git a deploy
has no Chartmetric IDs and shows social data only.

Set the API keys as environment variables in the Render dashboard — they are marked
`sync: false` in the blueprint so they never land in git. One service serves both the
API and the UI, so the keys stay server-side.

## Known gaps

- The Chartmetric readers tolerate several key spellings because the published docs
  host was unreachable from the build environment. `verify:apis` will tell you if a
  shape doesn't parse; tighten the readers once confirmed. Chartmetric is now the only
  provider whose wire format has not been checked against its published spec.
- `/api/roster` fans out per artist sequentially to respect Sprout's rate limit, so
  a large roster takes a few seconds on a cold cache.
- Post thumbnails come from Sprout's `visual_media` field. Coverage varies by network
  and plan; if Sprout rejects the field the request retries without it and the cards
  fall back to a plain placeholder.
- The fan-account name heuristic is deliberately conservative — a false "fan" would
  silently drop the artist's real account out of the default view. Expect to correct a
  few on the Accounts tab, or set the Sprout sub-group IDs and skip the guessing.
