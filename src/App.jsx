import React, { useState, useMemo } from "react";
import {
  Search, MapPin, Filter, X, ExternalLink, Info, Star,
  Home, Building2, Landmark, DollarSign, RefreshCw,
  TreePine, Check, ClipboardList, Radio,
} from "lucide-react";
import { PROGRAMS, CATEGORIES, GA_ENTITLEMENT, MO_ENTITLEMENT, HUD_ENTITLEMENT_LIVE } from "./data/programs.js";
import liveData from "./data/liveOpportunities.json";

const STATE_LABELS = { GA: "Georgia", MO: "Missouri", US: "Other U.S. State" };
const STATIC_ENTITLEMENT = { GA: GA_ENTITLEMENT, MO: MO_ENTITLEMENT };

const AREA_STYLES = {
  Rural: { icon: TreePine, bg: "bg-rural", text: "text-[#EFEBDD]" },
  Urban: { icon: Building2, bg: "bg-slate", text: "text-[#EFEBDD]" },
};

const LEVEL_DOT = {
  Federal: "bg-navy",
  State: "bg-gold",
  "Federal (State-administered)": "bg-[#5B7B9A]",
  "Federal (State-allocated)": "bg-[#5B7B9A]",
};

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

const STATE_AGENCY_NAME = { GA: "GA DCA", MO: "MHDC" };

function classifyLocation(cityCounty, state) {
  if (!cityCounty.trim()) return null;
  const key = cityCounty.trim().toLowerCase();

  // Prefer live, machine-fetched HUD data (see scripts/fetch-hud-entitlements.mjs)
  // if it has been populated. Falls back to the static illustrative lists below.
  const liveJurisdictions = HUD_ENTITLEMENT_LIVE?.jurisdictions || [];
  if (liveJurisdictions.length > 0) {
    const match = liveJurisdictions.find((j) => {
      if (!j.name) return false;
      const nameMatch = j.name.toLowerCase().includes(key) || key.includes(j.name.toLowerCase());
      const stateMatch = state === "US" ? true : (j.state || "").toUpperCase() === state;
      return nameMatch && stateMatch;
    });
    if (match) {
      return {
        label: `HUD Entitlement Match (${match.program}${match.type ? `: ${match.type}` : ""})`,
        detail: `Matched against HUD's live ${match.program} grantee dataset (fetched ${new Date(HUD_ENTITLEMENT_LIVE.fetchedAt).toLocaleDateString()}). This jurisdiction receives ${match.program} funds directly.`,
        areaGuess: "Urban",
      };
    }
  }

  if (state === "GA" || state === "MO") {
    const list = STATIC_ENTITLEMENT[state];
    const agencyName = STATE_AGENCY_NAME[state];
    const isEntitlement = list.some((e) => key.includes(e) || e.includes(key));
    return isEntitlement
      ? {
          label: "Likely HUD Entitlement Jurisdiction",
          detail: `This city/county appears on ${STATE_LABELS[state]}'s list of larger, direct-funded HUD entitlement communities — it likely receives CDBG/HOME formula funds directly rather than applying through ${agencyName}.`,
          areaGuess: "Urban",
        }
      : {
          label: "Likely Non-Entitlement (Rural/Small Town)",
          detail: `Not recognized as a direct HUD entitlement jurisdiction — CDBG/HOME funding for this community typically flows through ${agencyName}, and it is likely eligible for USDA Rural Development programs (verify at rd.usda.gov's eligibility map).`,
          areaGuess: "Rural",
        };
  }
  return {
    label: "Verify Local Classification",
    detail:
      "Outside Georgia and Missouri, check your state's HUD entitlement list and USDA Rural Development's eligibility map (rd.usda.gov/eligibility) to confirm rural vs. urban designation for this location.",
    areaGuess: null,
  };
}

export default function App() {
  const [query, setQuery] = useState("");
  const [cityCounty, setCityCounty] = useState("");
  const [state, setState] = useState("GA");
  const [areaFilter, setAreaFilter] = useState("All");
  const [levelFilter, setLevelFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [shortlist, setShortlist] = useState([]);
  const [active, setActive] = useState(null);

  const locationInfo = useMemo(() => classifyLocation(cityCounty, state), [cityCounty, state]);

  const effectiveAreaFilter = useMemo(() => {
    if (areaFilter !== "All") return areaFilter;
    if (locationInfo?.areaGuess) return locationInfo.areaGuess;
    return "All";
  }, [areaFilter, locationInfo]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROGRAMS.filter((p) => {
      if (q) {
        const hay = `${p.name} ${p.agency} ${p.description} ${p.category} ${p.code}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (effectiveAreaFilter !== "All" && !p.area.includes(effectiveAreaFilter)) return false;
      if (levelFilter !== "All" && p.level !== levelFilter) return false;
      if (categoryFilter !== "All" && p.category !== categoryFilter) return false;
      if (p.stateTag && p.stateTag !== state) return false;
      return true;
    }).sort((a, b) => {
      if (a.flagship && !b.flagship) return -1;
      if (b.flagship && !a.flagship) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [query, effectiveAreaFilter, levelFilter, categoryFilter, state]);

  const stats = useMemo(() => {
    const federal = filtered.filter((p) => p.level.startsWith("Federal")).length;
    const stateCt = filtered.filter((p) => p.level === "State").length;
    const rural = filtered.filter((p) => p.area.includes("Rural")).length;
    const urban = filtered.filter((p) => p.area.includes("Urban")).length;
    return { total: filtered.length, federal, stateCt, rural, urban };
  }, [filtered]);

  function toggleShortlist(id) {
    setShortlist((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const liveOpportunities = liveData?.opportunities || [];
  const liveFetchedAt = liveData?.fetchedAt
    ? new Date(liveData.fetchedAt).toLocaleString()
    : null;

  return (
    <div className="min-h-screen w-full bg-[#F5F2EA] text-[#1B2430]" style={{ fontFamily: "'Source Sans Pro', ui-sans-serif, system-ui" }}>
      {/* ---------- HEADER ---------- */}
      <header className="border-b-4 border-navy bg-navy">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-gold">
              <Landmark className="h-6 w-6 text-navy" strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#F5F2EA] font-serif">
                Housing Grants &amp; Programs Registry
              </h1>
              <p className="text-sm text-[#B9C4D6]">
                Federal, state, and local housing funding — rural and urban, in one index.
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- LEGISLATIVE UPDATE BANNER ---------- */}
      <div className="border-b border-rural/40 bg-rural">
        <div className="mx-auto flex max-w-6xl items-start gap-2 px-6 py-2.5 text-[#EFEBDD]">
          <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <p className="text-xs leading-relaxed">
            <span className="font-bold uppercase tracking-wide text-gold">2025–26 legislative update:</span>{" "}
            The <strong>One Big Beautiful Bill Act (2025)</strong> permanently expanded LIHTC (9% ceiling +12%,
            4% bond test cut to 25%), and the <strong>21st Century ROAD to Housing Act</strong> (enacted July 11, 2026)
            reformed USDA rural preservation, HOME, CDBG, and vouchers — and added new programs (RCDI, MPR, PRICE,
            FHA small-dollar &amp; whole-home repair pilots). Look for the{" "}
            <span className="rounded-full bg-rural px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ring-[#EFEBDD]/50">New · 2026 Law</span>{" "}
            and <span className="font-semibold">Updated by Law</span> tags. Verify appropriations before citing figures.
          </p>
        </div>
      </div>

      {/* ---------- SEARCH BAR ---------- */}
      <div className="border-b border-[#DED7C4] bg-[#EFEBDD]">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_1fr]">
            <label className="flex items-center gap-2 rounded-sm border border-[#C7BEA0] bg-white px-3 py-2.5 shadow-sm">
              <MapPin className="h-4 w-4 shrink-0 text-[#8A6D1B]" />
              <input
                value={cityCounty}
                onChange={(e) => setCityCounty(e.target.value)}
                placeholder="Enter a city or county (e.g., Tifton, Berrien County)"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[#8A8577]"
              />
              {cityCounty && (
                <button onClick={() => setCityCounty("")} aria-label="Clear location">
                  <X className="h-4 w-4 text-[#8A8577] hover:text-[#1B2430]" />
                </button>
              )}
            </label>

            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="rounded-sm border border-[#C7BEA0] bg-white px-3 py-2.5 text-sm shadow-sm outline-none"
            >
              <option value="GA">Georgia</option>
              <option value="MO">Missouri</option>
              <option value="US">Other U.S. State</option>
            </select>

            <label className="flex items-center gap-2 rounded-sm border border-[#C7BEA0] bg-white px-3 py-2.5 shadow-sm">
              <Search className="h-4 w-4 shrink-0 text-[#8A6D1B]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search programs, agencies, or keywords (e.g., rehab, self-help, veterans)"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[#8A8577]"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search">
                  <X className="h-4 w-4 text-[#8A8577] hover:text-[#1B2430]" />
                </button>
              )}
            </label>
          </div>

          {locationInfo && (
            <div className="mt-3 flex items-start gap-2 rounded-sm border border-[#C7BEA0] bg-white/70 px-3 py-2.5 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#8A6D1B]" />
              <div>
                <span className="font-semibold">{locationInfo.label}.</span>{" "}
                <span className="text-[#4B4636]">{locationInfo.detail}</span>
              </div>
            </div>
          )}

          {/* Filter row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[#6B6552]">
              <Filter className="h-3.5 w-3.5" /> Filters:
            </span>

            {["All", "Rural", "Urban"].map((a) => (
              <button
                key={a}
                onClick={() => setAreaFilter(a)}
                className={classNames(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  areaFilter === a
                    ? "border-navy bg-navy text-[#F5F2EA]"
                    : "border-[#C7BEA0] bg-white text-[#4B4636] hover:border-navy"
                )}
              >
                {a === "Rural" && <TreePine className="mr-1 inline h-3 w-3" />}
                {a === "Urban" && <Building2 className="mr-1 inline h-3 w-3" />}
                {a}
              </button>
            ))}

            <span className="mx-1 h-4 w-px bg-[#C7BEA0]" />

            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="rounded-full border border-[#C7BEA0] bg-white px-3 py-1 text-xs font-medium text-[#4B4636] outline-none"
            >
              <option value="All">All Levels</option>
              <option value="Federal">Federal</option>
              <option value="Federal (State-administered)">Federal (State-administered)</option>
              <option value="Federal (State-allocated)">Federal (State-allocated)</option>
              <option value="State">State</option>
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-full border border-[#C7BEA0] bg-white px-3 py-1 text-xs font-medium text-[#4B4636] outline-none"
            >
              <option value="All">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            {(areaFilter !== "All" || levelFilter !== "All" || categoryFilter !== "All" || query || cityCounty) && (
              <button
                onClick={() => {
                  setAreaFilter("All"); setLevelFilter("All"); setCategoryFilter("All");
                  setQuery(""); setCityCounty("");
                }}
                className="ml-1 text-xs font-medium text-[#8A6D1B] underline decoration-dotted hover:text-navy"
              >
                Reset all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---------- STATS STRIP ---------- */}
      <div className="border-b border-[#DED7C4] bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-5">
          <Stat label="Matching Programs" value={stats.total} accent="#0B1F3A" />
          <Stat label="Federal" value={stats.federal} accent="#5B7B9A" />
          <Stat label={`${STATE_LABELS[state]} State`} value={stats.stateCt} accent="#B8862E" />
          <Stat label="Rural-Eligible" value={stats.rural} accent="#3F5D42" icon={TreePine} />
          <Stat label="Urban-Eligible" value={stats.urban} accent="#1E3A5F" icon={Building2} />
        </div>
      </div>

      {/* ---------- MAIN CONTENT ---------- */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          {/* Results list */}
          <div className="space-y-3">
            {filtered.length === 0 && (
              <div className="rounded-sm border border-dashed border-[#C7BEA0] bg-white px-6 py-10 text-center text-[#6B6552]">
                No programs match these filters. Try widening the area type or clearing the category filter.
              </div>
            )}

            {filtered.map((p) => (
              <article
                key={p.id}
                className={classNames(
                  "group cursor-pointer rounded-sm border bg-white px-5 py-4 shadow-sm transition hover:shadow-md",
                  p.flagship ? "border-gold ring-1 ring-gold/40" : "border-[#DED7C4]"
                )}
                onClick={() => setActive(p)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] tracking-tight text-[#8A6D1B]">{p.code}</span>
                      <span className={classNames("h-1.5 w-1.5 rounded-full", LEVEL_DOT[p.level] || "bg-[#8A8577]")} />
                      <span className="text-[11px] font-medium text-[#6B6552]">{p.level}</span>
                      {p.flagship && (
                        <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy">
                          HUB Priority Fit
                        </span>
                      )}
                      {p.newLaw && (
                        <span className="rounded-full bg-rural px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#EFEBDD]">
                          New · 2026 Law
                        </span>
                      )}
                      {!p.newLaw && p.legislativeUpdate && (
                        <span className="rounded-full border border-rural px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rural">
                          Updated by Law
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-[#1B2430] group-hover:text-navy">
                      {p.name}
                    </h3>
                    <p className="text-sm text-[#6B6552]">{p.agency} · {p.category}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-[#4B4636]">{p.description}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="flex gap-1">
                      {p.area.map((a) => {
                        const s = AREA_STYLES[a];
                        const Icon = s.icon;
                        return (
                          <span key={a} className={classNames("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", s.bg, s.text)}>
                            <Icon className="h-3 w-3" /> {a}
                          </span>
                        );
                      })}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleShortlist(p.id); }}
                      className="flex items-center gap-1 rounded-sm border border-[#C7BEA0] px-2 py-1 text-[11px] font-medium text-[#6B6552] hover:border-gold hover:text-[#8A6D1B]"
                    >
                      <Star className={classNames("h-3.5 w-3.5", shortlist.includes(p.id) && "fill-gold text-gold")} />
                      {shortlist.includes(p.id) ? "Saved" : "Save"}
                    </button>
                  </div>
                </div>
              </article>
            ))}

            {/* ---------- LIVE GRANTS.GOV OPPORTUNITIES ---------- */}
            <LiveOpportunities opportunities={liveOpportunities} fetchedAt={liveFetchedAt} />
          </div>

          {/* Sidebar: shortlist */}
          <aside className="h-fit rounded-sm border border-[#DED7C4] bg-white px-4 py-4 lg:sticky lg:top-6">
            <div className="flex items-center gap-2 border-b border-[#EFEBDD] pb-2">
              <ClipboardList className="h-4 w-4 text-[#8A6D1B]" />
              <h4 className="text-sm font-semibold">Shortlist ({shortlist.length})</h4>
            </div>
            {shortlist.length === 0 ? (
              <p className="mt-3 text-xs text-[#8A8577]">
                Save programs while you browse to build a working list for a grant strategy memo or partner packet. This list resets when you reload the page.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {PROGRAMS.filter((p) => shortlist.includes(p.id)).map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 text-xs">
                    <button className="text-left text-[#1B2430] hover:text-navy hover:underline" onClick={() => setActive(p)}>
                      {p.name}
                    </button>
                    <button onClick={() => toggleShortlist(p.id)} aria-label="Remove">
                      <X className="h-3 w-3 text-[#8A8577] hover:text-gold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 rounded-sm bg-[#EFEBDD] px-3 py-2.5 text-[11px] leading-relaxed text-[#4B4636]">
              <strong className="text-[#8A6D1B]">Note:</strong> Rural/urban and entitlement classifications are guidance based on general HUD and USDA thresholds. Always confirm current eligibility on the agency site linked in each program before applying.
            </div>
          </aside>
        </div>
      </main>

      {/* ---------- DETAIL MODAL ---------- */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 px-4"
          onClick={() => setActive(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-sm border border-[#DED7C4] bg-[#F5F2EA] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#DED7C4] bg-navy px-5 py-4">
              <div>
                <span className="font-mono text-[11px] text-gold">{active.code}</span>
                <h3 className="text-lg font-bold text-[#F5F2EA] font-serif">{active.name}</h3>
              </div>
              <button onClick={() => setActive(null)} aria-label="Close">
                <X className="h-5 w-5 text-[#B9C4D6] hover:text-white" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5 text-sm">
              <div className="flex flex-wrap gap-2">
                <Pill label={active.level} />
                {active.area.map((a) => <Pill key={a} label={a} />)}
                <Pill label={active.category} />
              </div>

              <p className="text-[#1B2430]">{active.description}</p>

              {active.legislativeUpdate && (
                <div className="flex items-start gap-2 rounded-sm border-l-4 border-rural bg-[#EFEBDD] px-3 py-2.5 text-xs text-[#3F4A36]">
                  <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rural" />
                  <div>
                    <span className="font-semibold uppercase tracking-wide text-rural">Legislative update.</span>{" "}
                    {active.legislativeUpdate}
                  </div>
                </div>
              )}

              {active.verifyNote && (
                <div className="flex items-start gap-2 rounded-sm border border-[#C7BEA0] bg-white px-3 py-2 text-xs text-[#6B6552]">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8A6D1B]" />
                  Dollar figures for this program vary across sources and change periodically — confirm the current amount at the link below before quoting it.
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Administering Agency" value={active.agency} icon={Landmark} />
                <Field label="Funding" value={active.funding} icon={DollarSign} />
              </div>
              <Field label="Eligibility" value={active.eligibility} icon={Home} full />
              {active.lastVerified && (
                <p className="text-[11px] text-[#8A8577]">Source last checked: {active.lastVerified}</p>
              )}

              <a
                href={active.link}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-navy px-4 py-2 text-sm font-semibold text-[#F5F2EA] hover:bg-[#13294B]"
              >
                View program details <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-[#DED7C4] bg-white px-6 py-5 text-center text-xs text-[#8A8577]">
        Compiled for internal grant-strategy use — verify all figures, deadlines, and eligibility criteria against the source agency before submission.
      </footer>
    </div>
  );
}

function LiveOpportunities({ opportunities, fetchedAt }) {
  return (
    <div className="mt-6 rounded-sm border border-[#DED7C4] bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEBDD] pb-2">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-[#8A6D1B]" />
          <h4 className="text-sm font-semibold">Live Opportunities (Grants.gov)</h4>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-[#8A8577]">
          <RefreshCw className="h-3 w-3" />
          {fetchedAt ? `Last refreshed ${fetchedAt}` : "Not yet fetched"}
        </span>
      </div>

      {opportunities.length === 0 ? (
        <p className="mt-3 text-xs text-[#6B6552]">
          No live data yet. Run <code className="rounded bg-[#EFEBDD] px-1 py-0.5">npm run fetch-grants</code> to pull
          currently posted/forecasted housing opportunities directly from the public Grants.gov API into this panel.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[#EFEBDD]">
          {opportunities.slice(0, 15).map((o, i) => (
            <li key={o.id || o.number || i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-[#1B2430]">{o.title || "Untitled opportunity"}</p>
                <p className="text-xs text-[#6B6552]">
                  {o.agency || "Agency unknown"} {o.number ? `· ${o.number}` : ""} {o.closeDate ? `· Closes ${o.closeDate}` : ""}
                </p>
              </div>
              {o.detailUrl && (
                <a
                  href={o.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 text-xs font-medium text-[#8A6D1B] hover:text-navy"
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, accent, icon: Icon }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-1 rounded-full" style={{ backgroundColor: accent }} />
      <div>
        <div className="flex items-center gap-1 text-lg font-bold leading-none text-[#1B2430]">
          {Icon && <Icon className="h-4 w-4" style={{ color: accent }} />}
          {value}
        </div>
        <div className="text-[11px] text-[#8A8577]">{label}</div>
      </div>
    </div>
  );
}

function Pill({ label }) {
  return (
    <span className="rounded-full border border-[#C7BEA0] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#4B4636]">
      {label}
    </span>
  );
}

function Field({ label, value, icon: Icon, full }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#8A6D1B]">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className="mt-0.5 text-sm text-[#1B2430]">{value}</p>
    </div>
  );
}
