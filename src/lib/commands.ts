import type { KnownBlock } from '@slack/web-api';
import { integrationRegistry } from '../integrations/registry.js';
import { loadConfig } from './config.js';
import { tokenStore } from './token-store.js';

export interface CommandResponse {
  text: string;
  blocks?: KnownBlock[];
}

interface IntegrationStatus {
  id: string;
  name: string;
  enabled: boolean;
  connection: string;
  detail?: string;
  connectUrl?: string;
}

interface OAuthTokenInfo extends Record<string, unknown> {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  updatedAt?: string;
}

const DEFAULT_OAUTH_PORT = 3999;

const normalizeText = (text: string) => text.trim().toLowerCase();

const getOAuthBaseUrl = () => {
  if (process.env.OAUTH_BASE_URL) {
    return process.env.OAUTH_BASE_URL.replace(/\/$/, '');
  }
  const port = process.env.OAUTH_PORT || DEFAULT_OAUTH_PORT;
  return `http://localhost:${port}`;
};

const getSharedSecretParam = () => {
  if (!process.env.OAUTH_SHARED_SECRET) {
    return '';
  }
  return `?secret=${encodeURIComponent(process.env.OAUTH_SHARED_SECRET)}`;
};

const getOAuthStartUrl = (integrationId: string): string | null => {
  const baseUrl = getOAuthBaseUrl();
  const secret = getSharedSecretParam();
  if (integrationId === 'salesforce') {
    return `${baseUrl}/oauth/salesforce/start${secret}`;
  }
  if (integrationId === 'github') {
    return `${baseUrl}/oauth/github/start${secret}`;
  }
  if (integrationId === 'google_drive') {
    return `${baseUrl}/oauth/google-drive/start${secret}`;
  }
  return null;
};

const resolveIntegrationId = (input: string): string | null => {
  const value = input.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (value.includes('salesforce') || value.includes('sf')) {
    return 'salesforce';
  }
  if (value.includes('github') || value.includes('gh')) {
    return 'github';
  }
  if (value.includes('drive') || value.includes('google')) {
    return 'google_drive';
  }
  return null;
};

const formatTokenExpiry = (expiresAt?: number): string | null => {
  if (!expiresAt) {
    return null;
  }
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
};

const getIntegrationStatus = async (integrationId: string): Promise<IntegrationStatus> => {
  const integration = integrationRegistry.get(integrationId);
  const name = integration?.name ?? integrationId;
  const enabled = integration?.isEnabled() ?? false;
  const connectUrl = getOAuthStartUrl(integrationId) || undefined;

  if (integrationId === 'salesforce') {
    const tokens = await tokenStore.getTokens<{ refreshToken?: string; updatedAt?: string }>('salesforce');
    const hasClientId = Boolean(process.env.SALESFORCE_CLIENT_ID);
    const hasClientSecret = Boolean(process.env.SALESFORCE_CLIENT_SECRET);
    const hasRefresh = Boolean(process.env.SALESFORCE_REFRESH_TOKEN || tokens?.refreshToken);

    if (!hasClientId || !hasClientSecret) {
      return {
        id: integrationId,
        name,
        enabled,
        connection: 'missing client credentials',
        connectUrl,
      };
    }

    if (!hasRefresh) {
      return {
        id: integrationId,
        name,
        enabled,
        connection: 'not connected',
        connectUrl,
      };
    }

    return {
      id: integrationId,
      name,
      enabled,
      connection: 'connected',
      detail: tokens?.refreshToken ? 'token store' : 'environment token',
      connectUrl,
    };
  }

  if (integrationId === 'github') {
    const tokens = await tokenStore.getTokens<OAuthTokenInfo>('github');
    const envToken = process.env.GITHUB_OAUTH_TOKEN || process.env.GITHUB_TOKEN;

    if (envToken) {
      return {
        id: integrationId,
        name,
        enabled,
        connection: 'connected',
        detail: 'environment token',
      };
    }

    if (!tokens?.accessToken) {
      return {
        id: integrationId,
        name,
        enabled,
        connection: 'not connected',
        connectUrl,
      };
    }

    const expiry = formatTokenExpiry(tokens.expiresAt);
    if (tokens.expiresAt && tokens.expiresAt <= Date.now()) {
      return {
        id: integrationId,
        name,
        enabled,
        connection: 'token expired',
        detail: expiry ? `expired at ${expiry}` : undefined,
        connectUrl,
      };
    }

    return {
      id: integrationId,
      name,
      enabled,
      connection: 'connected',
      detail: expiry ? `expires at ${expiry}` : 'token store',
      connectUrl,
    };
  }

  if (integrationId === 'google_drive') {
    const tokens = await tokenStore.getTokens<{ refreshToken?: string }>('google_drive');
    const hasClientId = Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID);
    const hasClientSecret = Boolean(process.env.GOOGLE_DRIVE_CLIENT_SECRET);
    const hasRedirect = Boolean(process.env.GOOGLE_DRIVE_REDIRECT_URI);
    const hasRefresh = Boolean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || tokens?.refreshToken);

    if (!hasClientId || !hasClientSecret || !hasRedirect) {
      return {
        id: integrationId,
        name,
        enabled,
        connection: 'missing client credentials',
        connectUrl,
      };
    }

    if (!hasRefresh) {
      return {
        id: integrationId,
        name,
        enabled,
        connection: 'not connected',
        connectUrl,
      };
    }

    return {
      id: integrationId,
      name,
      enabled,
      connection: 'connected',
      detail: tokens?.refreshToken ? 'token store' : 'environment token',
      connectUrl,
    };
  }

  const hasTokens = tokenStore.hasTokens(integrationId);
  return {
    id: integrationId,
    name,
    enabled,
    connection: hasTokens ? 'connected' : 'not connected',
    connectUrl,
  };
};

const buildOnboardingResponse = (): CommandResponse => {
  const baseUrl = getOAuthBaseUrl();
  const oauthEnabled = process.env.OAUTH_SERVER_ENABLED !== 'false';

  const text =
    "Welcome to Adept. I'm here to help with Salesforce, GitHub, and Google Drive. " +
    'Ask questions in DMs or mention @Adept in a channel. ' +
    'Use "oauth status" to view connections or "connect <integration>" to authorize.';

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Welcome to Adept',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          'I can help answer questions and coordinate work across *Salesforce*, *GitHub*, and *Google Drive*.',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Connect integrations*\n• Salesforce: <${baseUrl}/oauth/salesforce/start|Authorize>\n• GitHub: <${baseUrl}/oauth/github/start|Authorize>\n• Google Drive: <${baseUrl}/oauth/google-drive/start|Authorize>`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `OAuth server: ${baseUrl} (${oauthEnabled ? 'enabled' : 'disabled'})`,
        },
      ],
    },
  ];

  return { text, blocks };
};

const buildStatusResponse = async (): Promise<CommandResponse> => {
  await tokenStore.load();
  const integrations = integrationRegistry.getAll();
  const statuses = await Promise.all(integrations.map((integration) => getIntegrationStatus(integration.id)));
  const config = loadConfig();
  const allowlist = new Set(config.enabledIntegrations.map((id) => id.trim()).filter(Boolean));
  const oauthEnabled = process.env.OAUTH_SERVER_ENABLED !== 'false';
  const baseUrl = getOAuthBaseUrl();

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Integration status',
      },
    },
  ];

  for (const status of statuses) {
    const allowed = allowlist.size === 0 || allowlist.has(status.id);
    const enabledLabel = status.enabled && allowed ? 'enabled' : 'disabled';
    const details = [status.connection, enabledLabel];
    if (status.detail) {
      details.push(status.detail);
    }

    const linkLine = status.connectUrl ? `\nConnect: <${status.connectUrl}|Authorize>` : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${status.name}*\n${details.join(' • ')}${linkLine}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `OAuth server: ${baseUrl} (${oauthEnabled ? 'enabled' : 'disabled'})`,
      },
    ],
  });

  const text = statuses
    .map((status) => `${status.name}: ${status.connection}${status.detail ? ` (${status.detail})` : ''}`)
    .join('\n');

  return { text, blocks };
};

const buildConnectResponse = (integrationId: string): CommandResponse => {
  const connectUrl = getOAuthStartUrl(integrationId);
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
};

export const handleCommand = async (text: string): Promise<CommandResponse | null> => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (
    normalized === 'help' ||
    normalized === 'start' ||
    normalized === 'onboard' ||
    normalized === 'onboarding' ||
    normalized === 'hello' ||
    normalized === 'hi'
  ) {
    return buildOnboardingResponse();
  }

  if (
    normalized === 'oauth status' ||
    normalized === 'integration status' ||
    normalized === 'integrations' ||
    normalized === 'status'
  ) {
    try {
      return await buildStatusResponse();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { text: `Unable to load integration status: ${message}` };
    }
  }

  const connectMatch = normalized.match(/^(connect|oauth connect|oauth start|authorize)\s+(.+)/i);
  if (connectMatch) {
    const integrationId = resolveIntegrationId(connectMatch[2]);
    if (!integrationId) {
      return { text: 'I could not match that integration. Try: connect salesforce, github, or drive.' };
    }
    return buildConnectResponse(integrationId);
  }

  return null;
};

export const getOnboardingResponse = buildOnboardingResponse;
