/**
 * Vercel serverless function: /api/grants
 * ----------------------------------------------------------------------
 * Server-side proxy to Grants.gov's public `search2` API. Runs the same
 * housing keyword searches as scripts/fetch-grants.mjs, but at REQUEST
 * time on Vercel's servers — so the dashboard's "Live Opportunities"
 * panel is genuinely live for every visitor, with no build-time script
 * and no browser CORS problem (the browser calls this same-origin
 * endpoint; this function calls Grants.gov).
 *
 * Response is edge-cached (see Cache-Control) so repeat visits don't
 * hammer the public endpoint.
 * ----------------------------------------------------------------------
 */

const SEARCH_ENDPOINT = "https://api.grants.gov/v1/api/search2";

const QUERIES = [
  { keyword: "rural housing" },
  { keyword: "affordable housing" },
  { keyword: "community development block grant" },
  { keyword: "farm labor housing" },
  { keyword: "homeless housing" },
  { keyword: "housing capacity building" },
  { keyword: "home repair" },
];

// Grants.gov search2 expects oppStatuses as a pipe-delimited STRING.
const STATUSES = "forecasted|posted";

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
    detailUrl: id ? `https://www.grants.gov/search-results-detail/${id}` : null,
  };
}

async function searchRaw(query) {
  const body = { ...query, oppStatuses: STATUSES, rows: 25 };
  const res = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Grants.gov search2 returned HTTP ${res.status}`);
  }
  return res.json();
}

function extractHits(json) {
  return (
    json?.data?.oppHits ||
    json?.oppHits ||
    json?.data?.hits ||
    json?.hits ||
    json?.data?.opportunities ||
    (Array.isArray(json?.data) ? json.data : null) ||
    []
  );
}

export default async function handler(req, res) {
  const errors = [];
  const all = [];
  let firstRaw = null;

  // Run all keyword searches concurrently; a failure of one doesn't sink the rest.
  const results = await Promise.allSettled(QUERIES.map((q) => searchRaw(q)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (!firstRaw) firstRaw = r.value;
      extractHits(r.value).forEach((hit) => all.push(mapHit(hit)));
    } else {
      errors.push({ query: QUERIES[i], error: String(r.reason && r.reason.message ? r.reason.message : r.reason) });
    }
  });

  // Temporary: expose the raw response structure so field mapping can be
  // confirmed against the live API. Access via /api/grants?debug=1
  if (req.query && req.query.debug) {
    const hits = extractHits(firstRaw);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      errorcode: firstRaw ? firstRaw.errorcode : null,
      msg: firstRaw ? firstRaw.msg : null,
      dataHitCount: firstRaw && firstRaw.data ? firstRaw.data.hitCount : null,
      dataErrorMsgs: firstRaw && firstRaw.data ? firstRaw.data.errorMsgs : null,
      hitCount: Array.isArray(hits) ? hits.length : 0,
      sampleHitKeys: Array.isArray(hits) && hits[0] ? Object.keys(hits[0]) : null,
      sampleHit: Array.isArray(hits) && hits[0] ? hits[0] : null,
      errors,
    });
    return;
  }

  // Dedupe by id (fallback to number, then title).
  const seen = new Set();
  const opportunities = [];
  for (const o of all) {
    const key = o.id || o.number || o.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    opportunities.push(o);
  }

  // Soonest-closing first.
  opportunities.sort((a, b) => {
    if (!a.closeDate) return 1;
    if (!b.closeDate) return -1;
    return new Date(a.closeDate) - new Date(b.closeDate);
  });

  // Edge-cache for an hour; serve stale while revalidating for a day.
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({
    fetchedAt: new Date().toISOString(),
    source: "grants.gov/search2",
    opportunityCount: opportunities.length,
    opportunities: opportunities.slice(0, 40),
    errors,
  });
}
