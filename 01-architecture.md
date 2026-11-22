# Stage B — Architecture & threat model
## Decisions (locked per directive)
Modular monolith: Next.js + TypeScript (strict) + Tailwind/shadcn · PostgreSQL (RLS) · Zod · Ollama + provider-independent model router · LangGraph for agent graphs · Docker Compose · GitHub Actions · Vitest + Playwright.
Background jobs: Postgres-backed queue (pg-boss) — no Kafka/Redis required at start (trade-off: lower throughput, far simpler self-hosting).
Auth: Auth.js-style sessions in DB, Argon2id, TOTP MFA. Secrets: AES-256-GCM envelope encryption, master key from env/KMS, never in DB plaintext.
## Modules
`core/{auth,tenancy,audit,approvals,usage}` · `ai/{router,runtime,memory,eval}` · `capabilities/` (registry) · `integrations/` (connector framework) · `divisions/<15>` · `ui/`.
## Agent runtime rules
Every agent run has: tool allowlist, token/time/cost budget, output Zod schema, tenant-scoped memory. Tools tagged `read | draft | outbound | spend | destructive`; the last three require a human approval row (or an explicit, scoped, revocable autonomy grant in Autonomous mode). Model router returns `{provider, model, may_incur_charge}` and the UI shows it; default order: local Ollama → deterministic workflow → user-supplied key (opt-in per workspace).
## Threat model (STRIDE-lite)
| Threat | Mitigation |
|---|---|
| Cross-tenant data access | `org_id` on every row + Postgres RLS + tenant-scoped queries; tests that attempt cross-tenant reads |
| Prompt injection from fetched content | Untrusted content wrapped & labelled; tools never chosen from content; outbound/spend gated by approvals |
| SSRF in crawlers | Egress allowlist, block private/link-local ranges, DNS-rebinding check, size/time caps |
| Token/secret leakage | Envelope encryption, redacting logger, no secrets in prompts/fixtures, gitleaks in CI |
| Rogue agent spend/send | Approval + budget caps + audit event per action |
| Webhook forgery | HMAC/signature verification, replay window |
| Abuse/DoS | Per-user/org rate limits, quotas |
| Untrusted file/code | Sandboxed worker, no network, resource limits |
Verification baseline: OWASP ASVS 5.0.0. **No certification or audit is claimed.**
## Build 0.2 deviations & decisions
- Core is zero-dependency Node 22 + TypeScript (type-stripping) so it could be built and tested offline; Next.js/Zod/LangGraph remain the target stack.
- Autonomy policy: grants can cover only `outbound` and `spend` within caps/expiry; `destructive` and `critical_setting` always need per-action approval.
- Approving a publish/spend request does **not** pretend to execute: with no connector, execution is recorded as `no_connector`.
- License: MIT (a copyleft license such as AGPL is a business decision for the owner).
