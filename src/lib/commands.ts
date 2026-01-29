import { commandRegistry, type CommandResponse } from './command-registry.js';
import { integrationRegistry } from '../integrations/registry.js';
import { loadConfig } from './config.js';
import { tokenStore } from './token-store.js';
import type { IntegrationStatus } from './command-builders.js';
import { buildIntegrationStatusBlocks, buildOnboardingBlocks } from './command-builders.js';
import { buildOAuthStartUrl, buildSharedSecretParam, getOAuthBaseUrl } from './oauth.js';
import { getIntegrationHealth } from './integration-config.js';

const getOAuthStartUrl = async (integrationId: string): Promise<string | null> => {
  const integration = integrationRegistry.get(integrationId);
  const baseUrl = getOAuthBaseUrl();

  if (integration?.getAuthConfig) {
    const authConfig = integration.getAuthConfig();
    const state = 'manual_connect';
    return await authConfig.getAuthUrl(baseUrl, state);
  }

  // Fallback for legacy
  const secret = buildSharedSecretParam(loadConfig().oauth.sharedSecret);
  return `${buildOAuthStartUrl(baseUrl, integrationId)}${secret}`;
};

const buildOnboardingResponse = async (): Promise<CommandResponse> => {
  const baseUrl = getOAuthBaseUrl();
  const oauthEnabled = process.env.OAUTH_SERVER_ENABLED !== 'false';
  
  const integrations = integrationRegistry.getAll();
  const connectLinks = await Promise.all(
    integrations.map(async (i) => {
      const url = await getOAuthStartUrl(i.id);
      return url ? `• ${i.name}: <${url}|Authorize>` : null;
    }),
  );

  const text =
    "Welcome to Adept. I'm here to help with your connected business tools. " +
    'Ask questions in DMs or mention @Adept in a channel. ' +
    'Use "oauth status" to view connections or "connect <integration>" to authorize.';
  const blocks = buildOnboardingBlocks(connectLinks, baseUrl, oauthEnabled);

  return { text, blocks };
};

// Register core commands
commandRegistry.register({
  name: 'help',
  description: 'Show onboarding help',
  aliases: ['start', 'onboard', 'onboarding', 'hello', 'hi'],
  execute: async () => await buildOnboardingResponse(),
});

commandRegistry.register({
  name: 'status',
  description: 'Show integration status',
  aliases: ['oauth status', 'integration status', 'integrations'],
  execute: async () => {
    try {
      await tokenStore.load();
      const integrations = integrationRegistry.getAll();
      const config = loadConfig();
      
      const statuses: IntegrationStatus[] = await Promise.all(
        integrations.map(async (integration) => {
          const tokens = tokenStore.getCachedTokens<Record<string, unknown>>(integration.id);
          const health = getIntegrationHealth(integration.id, {
            config,
            env: process.env,
            tokens,
          });
          const enabled = health?.enabled ?? integration.isEnabled();
          const tokenSource = health?.token.source ?? 'none';

          let connection = 'not connected';
          let detail: string | undefined;

          if (tokenSource === 'env') {
            connection = 'enabled (env)';
          } else if (tokenSource === 'store') {
            connection = 'connected';
            detail = 'token store';
          }

          const connectUrl = tokenSource === 'none'
            ? (await getOAuthStartUrl(integration.id)) || undefined
            : undefined;

          return {
            name: integration.name,
            connection,
            detail,
            connectUrl,
            id: integration.id,
            enabled,
            health,
          };
        }),
      );

      const allowlist = new Set(config.enabledIntegrations.map((id) => id.trim()).filter(Boolean));
      const oauthEnabled = process.env.OAUTH_SERVER_ENABLED !== 'false';
      const baseUrl = getOAuthBaseUrl();

      const blocks = buildIntegrationStatusBlocks(statuses, allowlist, baseUrl, oauthEnabled);

      const text = statuses
        .map((status) => `${status.name}: ${status.connection}${status.detail ? ` (${status.detail})` : ''}`)
        .join('\n');

      return { text, blocks };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { text: `Unable to load integration status: ${message}` };
    }
  },
});

commandRegistry.register({
  name: 'connect',
  description: 'Connect an integration',
  aliases: ['oauth connect', 'oauth start', 'authorize'],
  execute: async (args) => {
    const integrationId = integrationRegistry.resolveId(args);
    if (!integrationId) {
      return { text: 'I could not match that integration. Try: connect salesforce, github, or drive.' };
    }
    
    const connectUrl = await getOAuthStartUrl(integrationId);
    if (!connectUrl) {
      return { text: 'I could not determine an OAuth link for that integration.' };
    }

    const integrationName = integrationRegistry.get(integrationId)?.name ?? integrationId;

    return {
      text: `Authorize ${integrationName} by visiting ${connectUrl}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Authorize *${integrationName}* here: <${connectUrl}|${connectUrl}>`,
          },
        },
      ],
    };
  },
});

export const handleCommand = async (text: string): Promise<CommandResponse | null> => {
  return await commandRegistry.execute(text);
};

// Kept for backward compatibility if needed, but updated signature
export const getOnboardingResponse = buildOnboardingResponse;
