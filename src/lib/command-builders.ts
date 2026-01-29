import type { KnownBlock } from '@slack/web-api';
import type { IntegrationHealth } from './integration-config.js';

export interface IntegrationStatus {
  id: string;
  name: string;
  connection: string;
  detail?: string;
  connectUrl?: string;
  enabled: boolean;
  health?: IntegrationHealth | null;
}

const formatTimestamp = (value: number): string => new Date(value).toISOString();

const buildHealthDetails = (health?: IntegrationHealth | null): string | null => {
  if (!health) {
    return null;
  }

  const parts: string[] = [];

  if (health.missing.length > 0) {
    parts.push(`Missing: ${health.missing.join(', ')}`);
  }

  const token = health.token;
  if (token.expired) {
    parts.push('Access token expired');
  } else if (typeof token.expiresAt === 'number') {
    parts.push(`Access token expires: ${formatTimestamp(token.expiresAt)}`);
  }

  if (token.refreshTokenExpired) {
    parts.push('Refresh token expired');
  } else if (typeof token.refreshTokenExpiresAt === 'number') {
    parts.push(`Refresh token expires: ${formatTimestamp(token.refreshTokenExpiresAt)}`);
  }

  if (token.updatedAt) {
    parts.push(`Last refresh: ${token.updatedAt}`);
  }

  return parts.length > 0 ? parts.join(' • ') : null;
};

export const buildOnboardingBlocks = (
  connectLinks: Array<string | null>,
  baseUrl: string,
  oauthEnabled: boolean,
): KnownBlock[] => [
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
      text: 'I can help answer questions and coordinate work across your connected tools.',
    },
  },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Connect integrations*\n${connectLinks.filter(Boolean).join('\n')}`,
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

export const buildIntegrationStatusBlocks = (
  statuses: IntegrationStatus[],
  allowlist: Set<string>,
  baseUrl: string,
  oauthEnabled: boolean,
): KnownBlock[] => {
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
    const healthLine = buildHealthDetails(status.health);
    const healthText = healthLine ? `\n_${healthLine}_` : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${status.name}*\n${details.join(' • ')}${linkLine}${healthText}`,
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

  return blocks;
};
