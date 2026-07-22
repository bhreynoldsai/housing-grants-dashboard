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

function mapFeature(feature, program) {
  const a = feature.attributes || {};
  return {
    name: pick(a, ["NAME", "GranteeName", "GRANTEE_NAME", "GRANTEE_NM", "JURISDICTION", "ENTITY_NAME", "GRANTEE", "PLACENAME", "PLACE_NAME"]),
    state: pick(a, ["ST", "STATE", "State", "STATE_ABBR", "STUSPS", "STATE_NM", "ST_ABBREV"]),
    type: pick(a, ["TYPE", "GranteeType", "GRANTEE_TYPE", "GRANTEE_TY", "ENTITLEMENT", "CATEGORY", "STATUS", "PROGRAM_TY"]),
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
        if (j.name) jurisdictions.push(j);
      });
    } else {
      errors.push({ dataset: DATASETS[i].key, error: String(r.reason && r.reason.message ? r.reason.message : r.reason) });
    }
  });

  // Temporary: inspect HUD's live attribute schema via /api/hud-entitlements?debug=1
  if (req.query && req.query.debug) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      meta,
      firstRawAttrs,
      mappedSample: jurisdictions.slice(0, 5),
      unmappedNameCount: meta.reduce((s, m) => s + m.count, 0) - jurisdictions.length,
      errors,
    });
    return;
  }

  // Dedupe on name+state+program.
  const seen = new Set();
  const deduped = [];
  for (const j of jurisdictions) {
    const k = `${j.name}|${j.state}|${j.program}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(j);
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
