/**
 * Vercel serverless function: /api/locate?q=<city or county, state>
 * ----------------------------------------------------------------------
 * Authoritative urban/rural classification by geography, not name-matching:
 *
 *   1. Geocode the typed location to a lat/lon point
 *      (OpenStreetMap Nominatim, US-only, server-side).
 *   2. Ask HUD's own ArcGIS FeatureServers which CDBG grantee-area and
 *      HOME participating-jurisdiction polygons CONTAIN that point
 *      (spatial intersects query — HUD's server does the point-in-polygon).
 *
 * This resolves the urban-county-member-city problem exactly: Union City GA
 * has no HUD grantee named "Union City", but its point falls inside the
 * "FULTON COUNTY" urban-county polygon. Conversely, a point in the state
 * non-entitlement balance area (TYPE 21) is a POSITIVE confirmation of
 * non-entitlement status rather than an absence of match.
 *
 * Cached at the edge per query for a week (boundaries change ~annually).
 * ----------------------------------------------------------------------
 */

const DATASETS = [
  { key: "cdbg", program: "CDBG", itemId: "02646919444d4fddbc477987ef0ec1e1" },
  { key: "home", program: "HOME", itemId: "dfd882f226014c90bd7c912c32e25725" },
];

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "housing-grants-dashboard/1.0 (https://github.com/bhreynoldsai/housing-grants-dashboard)";

async function geocode(q) {
  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "1",
    countrycodes: "us",
    addressdetails: "1",
  });
  const res = await fetch(`${NOMINATIM}?${params}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) return null;
  const hit = json[0];
  return {
    lat: parseFloat(hit.lat),
    lon: parseFloat(hit.lon),
    displayName: hit.display_name,
  };
}

async function resolveServiceUrl(itemId) {
  const res = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${itemId}?f=json`);
  if (!res.ok) throw new Error(`Item lookup HTTP ${res.status}`);
  const json = await res.json();
  if (!json.url) throw new Error(`Item ${itemId} has no service URL`);
  return json.url.replace(/\/$/, "");
}

async function polygonAtPoint(itemId, lon, lat) {
  const serviceUrl = await resolveServiceUrl(itemId);
  const layerUrl = /\/\d+$/.test(serviceUrl) ? serviceUrl : `${serviceUrl}/0`;
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NAME,STUSAB,TYPE",
    returnGeometry: "false",
    f: "json",
  });
  const res = await fetch(`${layerUrl}/query?${params}`);
  if (!res.ok) throw new Error(`Spatial query HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`ArcGIS error: ${JSON.stringify(json.error).slice(0, 150)}`);
  const f = (json.features || [])[0];
  return f ? f.attributes : null;
}

function describe(attrs, program) {
  if (!attrs) return null;
  const name = attrs.NAME || null;
  const typeCode = String(attrs.TYPE || "");
  const lower = (name || "").toLowerCase();
  const nonEntitlement = typeCode === "21" || lower.includes("nonentitlement") || lower.includes("non-entitlement");
  return {
    program,
    name,
    state: attrs.STUSAB || null,
    typeCode,
    nonEntitlement,
    typeLabel: nonEntitlement
      ? "State Non-Entitlement Area"
      : lower.includes("county")
      ? "Urban County"
      : program === "HOME"
      ? "Participating Jurisdiction"
      : "Entitlement City",
  };
}

export default async function handler(req, res) {
  const q = req.query && req.query.q ? String(req.query.q).trim() : "";
  if (!q || q.length < 3) {
    res.status(400).json({ error: "Provide ?q=<city or county, state> (3+ chars)" });
    return;
  }

  try {
    const geo = await geocode(q);
    if (!geo) {
      res.setHeader("Cache-Control", "s-maxage=86400");
      res.status(200).json({ found: false, query: q });
      return;
    }

    const [cdbgRes, homeRes] = await Promise.allSettled([
      polygonAtPoint(DATASETS[0].itemId, geo.lon, geo.lat),
      polygonAtPoint(DATASETS[1].itemId, geo.lon, geo.lat),
    ]);

    const cdbg = cdbgRes.status === "fulfilled" ? describe(cdbgRes.value, "CDBG") : null;
    const home = homeRes.status === "fulfilled" ? describe(homeRes.value, "HOME") : null;
    const errors = [];
    if (cdbgRes.status === "rejected") errors.push({ dataset: "cdbg", error: String(cdbgRes.reason?.message || cdbgRes.reason) });
    if (homeRes.status === "rejected") errors.push({ dataset: "home", error: String(homeRes.reason?.message || homeRes.reason) });

    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=2592000");
    res.status(200).json({
      found: true,
      query: q,
      matched: geo.displayName,
      lat: geo.lat,
      lon: geo.lon,
      cdbg,
      home,
      errors,
      source: "Geocoded (OpenStreetMap Nominatim) point tested against HUD grantee boundaries (HUD ArcGIS Open Data)",
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ found: false, query: q, error: String(err && err.message ? err.message : err) });
  }
}
