/**
 * Vercel serverless function: /api/hud-entitlements
 * ----------------------------------------------------------------------
 * Server-side fetch of HUD's authoritative grantee datasets from HUD's
 * public ArcGIS Open Data site (same sources as
 * scripts/fetch-hud-entitlements.mjs, but at request time):
 *
 *   - CDBG Entitlement / Non-Entitlement Grantee Areas
 *   - HOME Program Participating Jurisdictions
 *
 * The dashboard's classifyLocation() consults this list FIRST, so the
 * urban/rural read comes from HUD's own grantee records rather than the
 * hand-maintained fallback lists. Cached at the edge for a day — these
 * datasets change rarely (annual qualification cycles).
 * ----------------------------------------------------------------------
 */

const DATASETS = [
  { key: "cdbg", program: "CDBG", itemId: "02646919444d4fddbc477987ef0ec1e1" },
  { key: "home", program: "HOME", itemId: "dfd882f226014c90bd7c912c32e25725" },
];

const PAGE_SIZE = 1000;
const MAX_PAGES = 6; // safety cap per dataset

async function resolveServiceUrl(itemId) {
  const res = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${itemId}?f=json`);
  if (!res.ok) throw new Error(`Item lookup failed (HTTP ${res.status}) for ${itemId}`);
  const json = await res.json();
  if (!json.url) throw new Error(`Item ${itemId} has no service URL`);
  return json.url.replace(/\/$/, "");
}

async function queryAllFeatures(serviceUrl) {
  const layerUrl = /\/\d+$/.test(serviceUrl) ? serviceUrl : `${serviceUrl}/0`;
  const features = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      f: "json",
      returnGeometry: "false",
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(offset),
    });
    const res = await fetch(`${layerUrl}/query?${params.toString()}`);
    if (!res.ok) throw new Error(`Query failed (HTTP ${res.status}) at offset ${offset}`);
    const json = await res.json();
    if (json.error) throw new Error(`ArcGIS error: ${JSON.stringify(json.error).slice(0, 200)}`);
    const batch = json.features || [];
    features.push(...batch);
    if (!json.exceededTransferLimit || batch.length === 0) break;
    offset += PAGE_SIZE;
  }
  return features;
}

function pick(attrs, keys, fallback = null) {
  for (const k of keys) {
    if (attrs && attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== "") return attrs[k];
  }
  return fallback;
}

// Confirmed live schema (2026-07): NAME (all-caps grantee name), STUSAB
// (postal state), STATE (FIPS), TYPE (HUD UOG code — "21" marks the
// state non-entitlement balance area, e.g. "AR NONENTITLEMENT").
const STATE_NAMES = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware",
  "florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky",
  "louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi",
  "missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico",
  "new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania",
  "rhode island","south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming","district of columbia",
  "puerto rico","guam","american samoa","northern mariana islands","u.s. virgin islands",
]);

function mapFeature(feature, program) {
  const a = feature.attributes || {};
  const name = pick(a, ["NAME", "GranteeName", "GRANTEE_NAME", "JURISDICTION", "GRANTEE"]);
  const typeCode = String(pick(a, ["TYPE", "GranteeType", "GRANTEE_TYPE"], ""));
  const lower = (name || "").toLowerCase();

  // Exclude records that must never yield an "urban entitlement" verdict:
  // state non-entitlement balance areas and state-level grantees.
  const isNonEntitlement = typeCode === "21" || lower.includes("nonentitlement") || lower.includes("non-entitlement");
  const isStateRecord = STATE_NAMES.has(lower);
  if (!name || isNonEntitlement || isStateRecord) return null;

  const type = lower.includes("county")
    ? "Urban County"
    : program === "HOME"
    ? "Participating Jurisdiction"
    : "Entitlement City";

  return {
    name,
    state: pick(a, ["STUSAB", "STUSPS", "ST", "STATE_ABBR"]), // postal abbr, NOT the FIPS "STATE" field
    type,
    program,
  };
}

export default async function handler(req, res) {
  const errors = [];
  const jurisdictions = [];
  const meta = [];
  let firstRawAttrs = null;

  const results = await Promise.allSettled(
    DATASETS.map(async (d) => {
      const serviceUrl = await resolveServiceUrl(d.itemId);
      const features = await queryAllFeatures(serviceUrl);
      return { ...d, serviceUrl, features };
    })
  );

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const { key, program, serviceUrl, features } = r.value;
      if (!firstRawAttrs && features[0]) firstRawAttrs = { dataset: key, attributes: features[0].attributes };
      meta.push({ key, serviceUrl, count: features.length });
      features.forEach((f) => {
        const j = mapFeature(f, program);
        if (j) jurisdictions.push(j);
      });
    } else {
      errors.push({ dataset: DATASETS[i].key, error: String(r.reason && r.reason.message ? r.reason.message : r.reason) });
    }
  });

  // Dedupe on name+state+program.
  const seen = new Set();
  let deduped = [];
  for (const j of jurisdictions) {
    const k = `${j.name}|${j.state}|${j.program}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(j);
  }

  // Optional ?state=GA filter (postal abbreviation) to slim the payload.
  const stateFilter = req.query && req.query.state ? String(req.query.state).toUpperCase() : null;
  if (stateFilter && stateFilter !== "US") {
    deduped = deduped.filter((j) => (j.state || "").toUpperCase() === stateFilter);
  }

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  res.status(200).json({
    fetchedAt: new Date().toISOString(),
    source: "HUD ArcGIS Open Data (CDBG grantee areas + HOME participating jurisdictions)",
    jurisdictionCount: deduped.length,
    jurisdictions: deduped,
    errors,
  });
}
