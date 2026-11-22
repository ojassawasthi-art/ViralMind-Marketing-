# VIRALMIND AI
Open-source, local-AI-first, security-first AI marketing platform. 705-capability registry, 15 divisions, approval-gated agents, honest status everywhere.
**This is an early build, not the finished product.** Read "Status" before relying on anything.
## Quick start
```
node src/main.ts            # needs Node >= 22.18; open http://127.0.0.1:3000, register, sign in
npm test                    # 47 tests (needs no network)
python3 registry/validate_registry.py
```
## What works (tested)
- Auth (register/login/MFA/sessions), roles, strict per-org scoping, tamper-evident audit log.
- Approval engine + bounded autonomy grants; agent runtime (allowlists, budgets, output validation, secret guard).
- Model router: Ollama + OpenAI/Anthropic/Google/xAI/NVIDIA adapters (wire formats tested against fake servers); paid use blocked unless explicitly allowed.
- SSRF-safe fetcher, encrypted connector secrets, signed inbound webhooks.
- 705-entry registry (validated), 15 divisions, chief routing; **21 capabilities are deterministic, tested calculators/linters** (ROAS, CAC, CLV, title tag, meta description, A/B significance + sample size, lead scoring, budget plan, content calendar, schema markup JSON-LD, UTM builder, SMS segments, readability, keyword density, campaign metrics, churn, NPS, headline lint, price/margin) at zero cost.
- **610 capabilities are `template_runnable`**: each has a deliverable type (analysis report, strategy plan, copy draft, design brief, production brief, AI asset spec, ops runbook). Run = a draft from your local model (or your own allowed key) **or**, with no model, a free structured scaffold. Output is always a draft: nothing is published, sent or spent. The pipeline is tested for all 610; **quality of model output is not verified** and the archetype assignment is rule-derived and needs human review.
- Dark violet web UI served by the app (Command Centre, Divisions, Agents, Approvals, Integrations, Security, Settings & Usage).
## Status (honest)
| Item | State |
|---|---|
| 705 capabilities | 21 `engine_tested` · 610 `template_runnable` · **74 `not_implemented`** (third-party tool names such as Semrush/HubSpot — integration references, not buildable features) · 0 `implemented_tested` (none meet the full definition of done: no persistence, UI is untested in a browser, connectors absent) |
| Physical work | 41 entries (photography, billboards, TV, events…) produce a production brief; **humans/vendors do the work** |
| AI media | 21 `AI …` entries produce prompt packs/specs; this build does **not** generate images/video/audio |
| Persistence | **in-memory only**; Postgres migrations 0001/0002 written, **untested**, unwired |
| Connectors | only signed inbound webhooks work; Meta/Google/LinkedIn/WhatsApp/email/TikTok/X are `planned`; publishing/ad-spend approvals record a manual package (`no_connector`) |
| Agents | need Ollama or an allowed user key; real-model behaviour untested (fake providers only); 15 directors + chief exist, specialist/tool agents not built |
| Stack deviation | Verified core is dependency-free Node/TypeScript, not Next.js/React/Tailwind/shadcn/Zod/LangGraph, because packages couldn't be installed in the build sandbox. Migration path is straightforward; UI not browser-tested |
| Unrun | Docker build, GitHub Actions, gitleaks, npm audit, Postgres migrations |
| UI screens not built | Research viewer, brand memory, content studio, creative library, campaign manager, automation builder, analytics dashboards, agency portal (listed in-app as unavailable) |
Docs: docs/00-audit.md · 01-architecture.md · SECURITY.md · SELF_HOSTING.md
