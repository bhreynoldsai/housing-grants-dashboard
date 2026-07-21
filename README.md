# Housing Grants & Programs Registry

A dashboard for finding federal, state, and local **housing grants and programs** —
covering both **rural** (USDA Rural Development-style) and **urban** (HUD entitlement
community-style) funding — searchable by city or county. Built for the Rural
Prosperity HUB Initiative's grant strategy work, but the data model generalizes to
any state.

## What's included

- **React + Vite + Tailwind** single-page dashboard (`src/App.jsx`)
- **Curated program dataset** (`src/data/programs.js`) — ~32 programs across USDA
  Rural Development, HUD, VA, Treasury/CDFI, DOE, Georgia DCA/OneGeorgia, and
  Missouri Housing Development Commission (MHDC), each sourced to the
  administering agency's own page
- **Two real, working scrapers**:
  - `scripts/fetch-grants.mjs` — calls Grants.gov's public `search2` API (no key
    required) to pull *currently open/forecasted* housing-related opportunities
    into `src/data/liveOpportunities.json`
  - `scripts/fetch-hud-entitlements.mjs` — pulls HUD's actual CDBG Entitlement
    Community and HOME Participating Jurisdiction lists from HUD's public
    ArcGIS Open Data site into `src/data/hudEntitlementCommunities.json`,
    superseding the hand-typed fallback lists for *any* state, not just Georgia
- City/county search with a rural-vs-urban classifier — uses the live HUD
  dataset when present, and falls back to static Georgia/Missouri jurisdiction
  lists otherwise

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

## Refreshing live data

```bash
npm run fetch-grants   # open/forecasted opportunities from Grants.gov
npm run fetch-hud      # real CDBG/HOME entitlement jurisdictions from HUD
npm run fetch-all      # both, one after the other
```

**`fetch-grants`** calls `https://api.grants.gov/v1/api/search2` (public,
unauthenticated) with a set of housing-related keyword searches and writes the
results to `src/data/liveOpportunities.json`. It also writes
`src/data/_debug-raw-sample.json` — a raw sample response — so you (or Claude
Code) can quickly fix the field mapping in `mapHit()` if Grants.gov ever changes
its response shape.

Edit the `QUERIES` array at the top of `scripts/fetch-grants.mjs` to add, remove,
or narrow keyword searches (e.g., add a specific state or CFDA number).

**`fetch-hud`** resolves HUD's CDBG Entitlement Community and HOME Participating
Jurisdiction datasets (public ArcGIS Open Data items) to their current
FeatureServer URLs, queries every jurisdiction's attributes, and writes them to
`src/data/hudEntitlementCommunities.json`. Once populated, `classifyLocation()`
in `src/App.jsx` uses this real, nationwide dataset first — for *any* state, not
just Georgia/Missouri — before falling back to the static lists. It also writes
`src/data/_debug-hud-raw-sample.json` for the same reason as above: HUD's
attribute field names aren't a fixed contract, so check that file if `name` /
`state` / `type` come back blank after a refresh.

## Building for production

```bash
npm run build
npm run preview
```

Outputs a static `dist/` folder deployable anywhere (Vercel, Netlify, GitHub Pages,
S3, etc.) — this is a fully static site; there is no backend/server component.

## Extending the dataset

- **Add a program**: append an object to the `PROGRAMS` array in
  `src/data/programs.js`. Each entry needs `id`, `code`, `name`, `agency`, `level`
  (`Federal` / `State` / `Federal (State-administered)` / `Federal
  (State-allocated)`), `area` (`["Rural"]`, `["Urban"]`, or both), `category` (must
  match one of `CATEGORIES`), `funding`, `eligibility`, `description`, and `link`.
- **Add another state's entitlement list**: `GA_ENTITLEMENT` in
  `src/data/programs.js` is Georgia-specific. To support another state well,
  duplicate the pattern (e.g. `TX_ENTITLEMENT`) and extend `classifyLocation()` in
  `src/App.jsx` to branch on `state`.
- **Widen live search**: add more `{ keyword: "..." }` entries to `QUERIES` in
  `scripts/fetch-grants.mjs`, or add other `search2` parameters (e.g.
  `agencies: "HUD"`, `aln: "14.239"`) — see
  <https://www.grants.gov/api/api-guide>.

## Important caveats (read before using this for a real submission)

- **The static dataset is hand-curated, not live.** Every entry lists a
  `sourceUrl` and `lastVerified` date in `programs.js` — re-check the source before
  citing a dollar figure in a proposal, since programs like VA disability-housing
  grants and state down-payment assistance amounts change annually (or more often).
- **The static Georgia/Missouri entitlement-jurisdiction lists are illustrative**,
  built from general knowledge of larger cities/counties in each state — they're
  a fallback for when `hudEntitlementCommunities.json` is empty. Run
  `npm run fetch-hud` to replace them with HUD's real, current list.
- **Live opportunity data depends on Grants.gov's API staying stable.** The public
  `search2` endpoint is documented but its exact response field names aren't
  formally versioned — that's why `fetch-grants.mjs` saves a raw debug sample and
  maps fields defensively instead of assuming one fixed shape.

## Tech stack

- React 18, Vite 5
- Tailwind CSS 3
- lucide-react (icons)
- Node 18+ for the fetch script (built-in `fetch`, no extra HTTP library)
