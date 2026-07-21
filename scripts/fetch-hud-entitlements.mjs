#!/usr/bin/env node
/**
 * fetch-hud-entitlements.mjs
 * ----------------------------------------------------------------------
 * Pulls HUD's actual CDBG Entitlement Community and HOME Participating
 * Jurisdiction boundaries/attributes from HUD's public ArcGIS Open Data
 * site, replacing the hand-typed `GA_ENTITLEMENT` list in
 * src/data/programs.js with a real, nationwide dataset.
 *
 * Why this two-step approach instead of one hardcoded URL:
 * HUD's open data portal (hudgis-hud.opendata.arcgis.com) is built on Esri
 * ArcGIS Hub, where each public dataset has a stable *item ID* but the
 * underlying FeatureServer URL can rotate. So instead of hardcoding a
 * FeatureServer URL that might go stale, this script:
 *   1. Resolves each item ID to its current service URL via Esri's public
 *      Sharing API: GET https://www.arcgis.com/sharing/rest/content/items/{id}?f=json
 *   2. Queries that service's attribute table (no geometry needed) via
 *      the standard ArcGIS REST query endpoint, paginating with
 *      resultOffset until `exceededTransferLimit` is false.
 *
 * Both of these are public, unauthenticated, standard Esri REST APIs.
 *
 * Datasets pulled (HUD's own item IDs, confirmed from the dataset "about"
 * pages on hudgis-hud.opendata.arcgis.com):
 *   - CDBG Entitlement / Non-Entitlement Grantee Areas: 02646919444d4fddbc477987ef0ec1e1
 *   - HOME Program Grantee Areas:                        dfd882f226014c90bd7c912c32e25725
 *
 * Run with: npm run fetch-hud
 *
 * FIELD-NAME CAVEAT (read this before trusting the output blindly):
 * HUD's attribute schema for these layers isn't published as a fixed,
 * versioned contract, so `mapFeature()` below guesses at a handful of
 * plausible field names. This script always writes the *raw* first
 * feature's attributes to `src/data/_debug-hud-raw-sample.json` — if
 * `name`/`state`/`type` come back blank in the output, open that file,
 * see the actual field names HUD is using this month, and adjust the
 * `pick(...)` calls in `mapFeature()` accordingly.
 * ----------------------------------------------------------------------
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "src", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "hudEntitlementCommunities.json");
const DEBUG_FILE = path.join(DATA_DIR, "_debug-hud-raw-sample.json");

const DATASETS = [
  { key: "cdbg", label: "CDBG Entitlement / Non-Entitlement Grantee Areas", itemId: "02646919444d4fddbc477987ef0ec1e1" },
  { key: "home", label: "HOME Program Grantee Areas", itemId: "dfd882f226014c90bd7c912c32e25725" },
];

async function resolveServiceUrl(itemId) {
  const res = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${itemId}?f=json`);
  if (!res.ok) throw new Error(`Item lookup failed (HTTP ${res.status}) for item ${itemId}`);
  const json = await res.json();
  if (!json.url) throw new Error(`Item ${itemId} has no service URL in its metadata (got: ${JSON.stringify(json).slice(0, 200)})`);
  return json.url.replace(/\/$/, ""); // strip trailing slash
}

async function queryAllFeatures(serviceUrl) {
  // If the item URL doesn't already point at a specific layer (…/FeatureServer/0),
  // default to layer 0, which is the typical convention for single-layer datasets.
  const layerUrl = /\/\d+$/.test(serviceUrl) ? serviceUrl : `${serviceUrl}/0`;

  const features = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      f: "json",
      returnGeometry: "false",
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });
    const res = await fetch(`${layerUrl}/query?${params.toString()}`);
    if (!res.ok) throw new Error(`Query failed (HTTP ${res.status}) at offset ${offset} for ${layerUrl}`);
    const json = await res.json();

    if (json.error) throw new Error(`ArcGIS query error: ${JSON.stringify(json.error)}`);

    const page = json.features || [];
    features.push(...page);

    if (!json.exceededTransferLimit || page.length === 0) break;
    offset += pageSize;

    // Be polite to the public service.
    await new Promise((r) => setTimeout(r, 300));
  }

  return features;
}

function pick(attrs, keys, fallback = null) {
  for (const k of keys) {
    if (attrs && attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== "") return attrs[k];
  }
  return fallback;
}

function mapFeature(feature, datasetKey) {
  const a = feature.attributes || {};
  return {
    name: pick(a, ["NAME", "GranteeName", "GRANTEE_NAME", "JURISDICTION", "ENTITY_NAME", "GRANTEE", "PLACENAME"]),
    state: pick(a, ["ST", "STATE", "State", "STATE_ABBR", "STUSPS"]),
    type: pick(a, ["TYPE", "GranteeType", "GRANTEE_TYPE", "ENTITLEMENT", "CATEGORY", "STATUS"]),
    program: datasetKey === "cdbg" ? "CDBG" : "HOME",
    _raw: a,
  };
}

async function fetchDataset({ key, label, itemId }) {
  console.log(`Resolving service URL for "${label}" (item ${itemId})...`);
  const serviceUrl = await resolveServiceUrl(itemId);
  console.log(`  -> ${serviceUrl}`);

  console.log(`Querying features...`);
  const rawFeatures = await queryAllFeatures(serviceUrl);
  console.log(`  -> ${rawFeatures.length} feature(s)`);

  return {
    label,
    itemId,
    serviceUrl,
    count: rawFeatures.length,
    firstRaw: rawFeatures[0] || null,
    jurisdictions: rawFeatures.map((f) => mapFeature(f, key)),
  };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const results = {};
  const errors = [];
  let debugSample = null;

  for (const dataset of DATASETS) {
    try {
      const r = await fetchDataset(dataset);
      results[dataset.key] = r;
      if (!debugSample && r.firstRaw) debugSample = { dataset: dataset.key, feature: r.firstRaw };
    } catch (err) {
      console.error(`  !! Failed to fetch "${dataset.label}": ${err.message}`);
      errors.push({ dataset: dataset.key, error: err.message });
    }
  }

  const allJurisdictions = Object.values(results).flatMap((r) => r.jurisdictions);

  const output = {
    fetchedAt: new Date().toISOString(),
    datasets: DATASETS.map((d) => ({
      key: d.key,
      label: d.label,
      itemId: d.itemId,
      serviceUrl: results[d.key]?.serviceUrl || null,
      count: results[d.key]?.count || 0,
    })),
    jurisdictionCount: allJurisdictions.length,
    jurisdictions: allJurisdictions,
    errors,
    note:
      allJurisdictions.length === 0
        ? "No jurisdictions parsed. Check src/data/_debug-hud-raw-sample.json for a raw feature and confirm field names in mapFeature() (scripts/fetch-hud-entitlements.mjs) still match HUD's current schema."
        : "Generated by scripts/fetch-hud-entitlements.mjs from HUD's public ArcGIS Open Data site.",
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${allJurisdictions.length} jurisdiction records to ${path.relative(process.cwd(), OUTPUT_FILE)}`);

  if (debugSample) {
    await writeFile(DEBUG_FILE, JSON.stringify(debugSample, null, 2));
    console.log(`Wrote a raw sample feature to ${path.relative(process.cwd(), DEBUG_FILE)} for troubleshooting.`);
  }

  if (errors.length) {
    console.warn(`\n${errors.length} dataset(s) failed — see the "errors" array in hudEntitlementCommunities.json.`);
    console.warn(`The dashboard will keep working off its static GA_ENTITLEMENT / MO_ENTITLEMENT fallback lists in src/data/programs.js.`);
  }
}

main().catch((err) => {
  console.error("fetch-hud-entitlements.mjs failed:", err);
  process.exit(1);
});
