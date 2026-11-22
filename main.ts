import { loadConfig } from './config.ts';
import { Platform } from './core/store.ts';
import { AuthService } from './core/auth.ts';
import { Registry } from './capabilities/registry.ts';
import { ModelRouter } from './ai/router.ts';
import { AnthropicProvider, OllamaProvider, OpenAICompatProvider } from './ai/providers.ts';
import { buildTools } from './ai/tools.ts';
import { buildAgents } from './ai/agents.ts';
import { ConnectorManager } from './integrations/connector.ts';
import { createApp } from './server/app.ts';
import { log } from './security/redact.ts';

const cfg = loadConfig();
const k = cfg.keys;
const router = new ModelRouter([
  new OllamaProvider(cfg.ollamaUrl, cfg.ollamaModel),
  new OpenAICompatProvider({ id: 'openai', base: 'https://api.openai.com/v1', model: cfg.models.openai!, getKey: () => k.openai }),
  new AnthropicProvider({ model: cfg.models.anthropic!, getKey: () => k.anthropic }),
  new OpenAICompatProvider({ id: 'google', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: cfg.models.google!, getKey: () => k.google }),
  new OpenAICompatProvider({ id: 'xai', base: 'https://api.x.ai/v1', model: cfg.models.xai!, getKey: () => k.xai }),
  new OpenAICompatProvider({ id: 'nvidia', base: 'https://integrate.api.nvidia.com/v1', model: cfg.models.nvidia!, getKey: () => k.nvidia }),
], { allowPaid: cfg.allowPaid });
const registry = Registry.load(); const platform = new Platform();
const server = createApp({ platform, auth: new AuthService(platform, cfg.masterKey), registry, router, connectors: new ConnectorManager(cfg.masterKey), tools: buildTools(registry), agents: buildAgents() });
server.listen(cfg.port, cfg.host, () => {
  log('info', 'VIRALMIND AI listening', { host: cfg.host, port: cfg.port, paidProvidersAllowed: cfg.allowPaid, persistence: 'in-memory (data is lost on restart)' });
  if (cfg.ephemeralKey) log('warn', 'MASTER_KEY not set: using an ephemeral key (dev only)');
});
