import type { AdeptConfig } from '../types/index.js';

export function loadConfig(): AdeptConfig {
  return {
    defaultProvider: (process.env.DEFAULT_AI_PROVIDER as 'openai' | 'anthropic') || 'anthropic',
    enabledIntegrations: (process.env.ENABLED_INTEGRATIONS || '').split(',').filter(Boolean),
    maxToolSteps: parseInt(process.env.MAX_TOOL_STEPS || '15', 10),
  };
}

export function validateEnv(): void {
  const required = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasOpenAI && !hasAnthropic) {
    throw new Error('At least one AI provider API key is required (OPENAI_API_KEY or ANTHROPIC_API_KEY)');
  }
}
