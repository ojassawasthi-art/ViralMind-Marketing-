# Security status (baseline: OWASP ASVS 5.0.0). No certification or external audit is claimed.
| Control | Status | Evidence |
|---|---|---|
| Password hashing | scrypt N=32768 (node:crypto). Argon2id preferred once a vetted dependency is accepted | test/security.test.ts |
| MFA | TOTP (RFC 6238 vector tested), replay-protected, secret encrypted | security + core + server tests |
| Sessions | random 256-bit bearer tokens, stored hashed, 12h expiry, logout | core.test.ts |
| CSRF | API uses Authorization header (no ambient cookies) so classic CSRF doesn't apply | design; tested via 401 w/o header |
| XSS | no innerHTML in UI, CSP `script-src 'self'`, no inline script | server.test.ts (headers) — UI not browser-tested |
| Authorization | role matrix + org scope bound to session; cross-tenant tests | core + server tests |
| SQL injection | n/a today (no SQL in app path); parametrised queries required when Postgres store is wired | — |
| SSRF | scheme/port/host/IP-range checks, DNS pinning, per-hop redirect revalidation, size/time caps | security + ai tests |
| Rate limiting | login (IP + email), per-user API, per-connector webhook | server tests |
| Secrets | AES-256-GCM with owner-bound AAD; redacting logger; export excludes secrets | tests |
| Webhooks | HMAC-SHA256 + timestamp window + replay rejection | server tests |
| Audit | append-only per-org hash chain, tamper detection | core tests |
| Prompt injection | untrusted content fenced; **enforcement is structural** (allowlist, schemas, approvals) not model-dependent | ai + server tests |
| High-impact actions | outbound/spend need approval or valid bounded grant; destructive/critical always need approval | core + ai tests |
| Data export / deletion | implemented (deletion needs password + typed confirmation) | server tests |
## Known gaps (do not deploy to the public internet until closed)
1. **Persistence is in-memory**: data and sessions vanish on restart; Postgres migrations exist but are untested and unwired. Therefore no DB-level RLS is active yet.
2. No TLS termination (use a reverse proxy), no CORS config (same-origin only), no CSP report endpoint.
3. Open registration; no email verification, password reset, or invitation flow; roles other than owner cannot yet be assigned via API.
4. Sandbox for untrusted file/code processing: not built (no such feature exists yet).
5. Backup/restore: procedure only meaningful after Postgres is wired (see SELF_HOSTING.md).
6. Dependency/secret scanning is configured in CI but **has never run**.
7. UI has not been exercised in a real browser.
