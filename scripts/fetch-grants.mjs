#!/usr/bin/env node
/**
 * fetch-grants.mjs
 * ----------------------------------------------------------------------
 * Pulls currently posted/forecasted housing-related funding opportunities
 * from Grants.gov's public `search2` REST API and writes them to
 * src/data/liveOpportunities.json for the dashboard to display.
 *
 * Endpoint: POST https://api.grants.gov/v1/api/search2
 * Auth: none required (this is Grants.gov's public, unauthenticated
 *       search endpoint — see https://www.grants.gov/api/api-guide).
 *
 * Requires Node 18+ (for built-in fetch). Run with:
 *   npm run fetch-grants
 *
 * NOTE ON FIELD MAPPING:
 * Grants.gov does not publish a formal JSON schema for search2's response,
 * and it has changed shape before. This script maps a handful of
 * plausible field-name variants defensively (see `mapHit`) and always
 * writes the *raw* first response to `src/data/_debug-raw-sample.json`
 * so you (or Claude Code) can quickly adjust the mapping if a field
 * comes back as `undefined` for your run.
 * ----------------------------------------------------------------------
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "src", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "liveOpportunities.json");
const DEBUG_FILE = path.join(DATA_DIR, "_debug-raw-sample.json");

const SEARCH_ENDPOINT = "https://api.grants.gov/v1/api/search2";

// Keyword searches run against Grants.gov. Edit/add to this list to widen
// or narrow what the dashboard's "Live Opportunities" panel shows.
const QUERIES = [
  { keyword: "rural housing" },
  { keyword: "affordable housing" },
  { keyword: "community development block grant" },
  { keyword: "farm labor housing" },
  { keyword: "homeless housing" },
  { keyword: "housing capacity building" },
  { keyword: "home repair" },
];

// Only keep opportunities in these statuses (adjust as needed).
const STATUSES = ["posted", "forecasted"];

async function searchOnce(query) {
  const body = { ...query, oppStatuses: STATUSES, rows: 25 };
  const res = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Grants.gov search2 returned HTTP ${res.status} for query ${JSON.stringify(query)}`);
  }

  return res.json();
}

// Grants.gov's response wraps hits under data.oppHits (array). Individual
// hit field names have varied across API iterations, so we try several
// plausible keys for each logical field.
function pick(obj, keys, fallback = null) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return fallback;
}

function mapHit(hit) {
  const id = pick(hit, ["id", "opportunityId", "oppId"]);
  const number = pick(hit, ["number", "opportunityNumber", "oppNumber"]);
  const title = pick(hit, ["title", "opportunityTitle", "oppTitle"]);
  const agency = pick(hit, ["agencyName", "agency", "agencyCode"]);
  const openDate = pick(hit, ["openDate", "postedDate", "postDate"]);
  const closeDate = pick(hit, ["closeDate", "closeDateDisplay"]);
  const status = pick(hit, ["oppStatus", "status"]);
  const cfda = pick(hit, ["cfdaList", "alnist", "aln"], []);

  return {
    id,
    number,
    title,
    agency,
    openDate,
    closeDate,
    status,
    cfda: Array.isArray(cfda) ? cfda : [cfda].filter(Boolean),
    // Grants.gov's public search UI resolves opportunities at this path.
    detailUrl: id ? `https://www.grants.gov/search-results-detail/${id}` : null,
    _raw: hit, // kept so nothing is lost if the mapping above missed a field
  };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const all = [];
  let firstRawResponse = null;
  const errors = [];

  for (const query of QUERIES) {
    try {
      console.log(`Searching Grants.gov for: ${JSON.stringify(query)}`);
      const json = await searchOnce(query);
      if (!firstRawResponse) firstRawResponse = json;

      const hits =
        json?.data?.oppHits ||
        json?.oppHits ||
        json?.data?.hits ||
        [];

      console.log(`  -> ${hits.length} result(s)`);
      hits.forEach((hit) => all.push(mapHit(hit)));

      // Be polite to the public endpoint.
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error(`  !! Query failed: ${err.message}`);
      errors.push({ query, error: err.message });
    }
  }

  // Dedupe by id (fallback to number, then title) across overlapping queries.
  const seen = new Set();
  const opportunities = [];
  for (const o of all) {
    const key = o.id || o.number || o.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    opportunities.push(o);
  }

  // Sort soonest-closing first when a close date is present.
  opportunities.sort((a, b) => {
    if (!a.closeDate) return 1;
    if (!b.closeDate) return -1;
    return new Date(a.closeDate) - new Date(b.closeDate);
  });

  const output = {
    fetchedAt: new Date().toISOString(),
    queries: QUERIES,
    statusesRequested: STATUSES,
    opportunityCount: opportunities.length,
    opportunities,
    errors,
    note:
      opportunities.length === 0
        ? "No opportunities parsed. Check src/data/_debug-raw-sample.json to see the raw Grants.gov response and confirm the field names used in mapHit() above still match."
        : "Generated by scripts/fetch-grants.mjs from the public Grants.gov search2 API.",
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${opportunities.length} opportunities to ${path.relative(process.cwd(), OUTPUT_FILE)}`);

  if (firstRawResponse) {
    await writeFile(DEBUG_FILE, JSON.stringify(firstRawResponse, null, 2));
    console.log(`Wrote a raw sample response to ${path.relative(process.cwd(), DEBUG_FILE)} for troubleshooting.`);
  }

  if (errors.length) {
    console.warn(`\n${errors.length} quer${errors.length === 1 ? "y" : "ies"} failed — see the "errors" array in liveOpportunities.json.`);
  }
}

main().catch((err) => {
  console.error("fetch-grants.mjs failed:", err);
  process.exit(1);
});
