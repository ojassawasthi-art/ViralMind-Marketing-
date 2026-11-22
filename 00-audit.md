# Stage A — Repository audit & gap report
Date: 2026-11-22 · Result: GREENFIELD (no prior repository or Skill was supplied).

## Inputs inspected
- Master Catalogue text (30 departments). Counted and machine-validated: **705 entries** = 610 (depts 1–28) + 74 tools (611–684) + 21 (dept 30).
- Existing code / Skill / docs: **none provided**. Nothing preserved because nothing existed. Not assumed.

## Findings
| # | Finding | Decision |
|---|---|---|
| 1 | 30 source departments vs 15 product divisions | Mapping defined in `registry/build_registry.py` (DERIVED, review needed) |
| 2 | 19 names repeat across departments (e.g. Local SEO) | Identity = stable ID `VM-0001..0705`, never name |
| 3 | 74 entries are software tools, not activities | Kept as `kind=tool` (integration references), count stays 705 |
| 4 | Source has names only (no descriptions/IO/permissions) | Derived by rules; `description=null`; provenance recorded per field |
| 5 | 41 capabilities are physical/human (photography, billboards, TV, events) | `human_or_physical_required`: agent plans/briefs/tracks, never claims to perform |
| 6 | 70 capabilities publish/send/spend/change critical state | Approval-gated by design |
| 7 | PDF on disk was not a valid PDF | Registry sourced from supplied text; re-upload for file-level check |

## Gaps (all of the application) — see 05 status table in README
No app, auth, DB, agents, connectors or UI exists yet. Every capability is `not_implemented`.

## Security risks identified up front
Prompt injection via scraped competitor/review/social content; SSRF from research crawlers; token theft from connectors; cross-tenant leakage; agents spending ad money or messaging customers; platform-ToS violations (scraping, fake engagement).

## Update (build 0.3)
Status model: `engine_tested` (deterministic code + unit tests), `template_runnable` (deliverable template; pipeline tested; model-output quality unverified), `not_implemented`, `implemented_tested` (full definition of done; currently none). Tool entries (74) can never be template_runnable. Rule-derived archetypes are flagged in `provenance.derived_unreviewed`.
