# Self-hosting
Requirements: Node >= 22.18 (or Docker). For local AI: Ollama; 7–8B quantised models want ~8 GB RAM (16 GB comfortable); CPU-only works but is slow; larger models need proportionally more. Deterministic capabilities need no model and no network.
## Run without Docker
```
npm install            # dev tooling only (typescript, @types/node); the app has zero runtime dependencies
cp .env.example .env   # set MASTER_KEY=$(openssl rand -base64 32)
export $(grep -v '^#' .env | xargs) && node src/main.ts   # http://127.0.0.1:3000
ollama pull llama3.1:8b   # optional, enables agents
```
## Docker
```
cp .env.example .env && edit MASTER_KEY
docker compose -f infra/docker-compose.yml up --build
docker compose -f infra/docker-compose.yml exec ollama ollama pull llama3.1:8b
```
(Compose/Docker path is untested in the build sandbox.)
## Costs & limits (no hidden charges)
- Default: local models + deterministic workflows = no external cost.
- Paid providers run only if the host sets `ALLOW_PAID_PROVIDERS=true` AND supplies that provider's key. Each call is labelled with provider/model and "may incur charge"; see Settings & Usage.
- Free hosting tiers generally cannot run local LLMs; use free tier for the app only, and either a remote Ollama you own or your own API keys.
## Backup / restore
Current build is in-memory: use Settings → "Export data" (JSON, secrets excluded). Postgres backup (`pg_dump`) applies once the Postgres store is wired.
