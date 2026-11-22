import { randomBytes } from 'node:crypto';
import { parseMasterKey } from './security/crypto.ts';

export interface Config { port: number; host: string; masterKey: Buffer; ephemeralKey: boolean; ollamaUrl: string; ollamaModel: string; allowPaid: boolean;
  keys: { openai?: string; anthropic?: string; google?: string; xai?: string; nvidia?: string }; models: Record<string, string> }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT invalid');
  let ephemeralKey = false, masterKey: Buffer;
  if (env.MASTER_KEY) masterKey = parseMasterKey(env.MASTER_KEY);
  else if (env.NODE_ENV === 'production') throw new Error('MASTER_KEY is required in production');
  else { masterKey = randomBytes(32); ephemeralKey = true; }
  return { port, host: env.HOST ?? '127.0.0.1', masterKey, ephemeralKey, ollamaUrl: env.OLLAMA_URL ?? 'http://127.0.0.1:11434', ollamaModel: env.OLLAMA_MODEL ?? 'llama3.1:8b',
    allowPaid: env.ALLOW_PAID_PROVIDERS === 'true',
    keys: { openai: env.OPENAI_API_KEY, anthropic: env.ANTHROPIC_API_KEY, google: env.GOOGLE_API_KEY, xai: env.XAI_API_KEY, nvidia: env.NVIDIA_API_KEY },
    models: { openai: env.OPENAI_MODEL ?? 'gpt-4o-mini', anthropic: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5', google: env.GOOGLE_MODEL ?? 'gemini-2.0-flash', xai: env.XAI_MODEL ?? 'grok-3-mini', nvidia: env.NVIDIA_MODEL ?? 'meta/llama-3.1-8b-instruct' } };
}
