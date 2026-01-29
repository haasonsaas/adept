import type { AdeptConfig } from '../types/index.js';
import { loadConfig } from './config.js';
import { tokenStore } from './token-store.js';

export interface IntegrationEnablement {
  enabled: boolean;
  missing: string[];
}

interface EnablementOptions<TTokens> {
  config?: AdeptConfig;
  tokens?: TTokens | null;
  env?: NodeJS.ProcessEnv;
}

type GitHubTokens = Record<string, unknown> & {
  accessToken?: string;
  refreshToken?: string;
};

type GoogleDriveTokens = Record<string, unknown> & {
  refreshToken?: string;
};

type SalesforceTokens = Record<string, unknown> & {
  refreshToken?: string;
};

const hasValue = (value?: string) => typeof value === 'string' && value.trim().length > 0;

const resolveConfig = (config?: AdeptConfig) => config ?? loadConfig();

const resolveTokens = <TTokens extends Record<string, unknown>>(
  integrationId: string,
  tokens?: TTokens | null,
): TTokens | null => {
  if (tokens !== undefined) {
    return tokens;
  }
  return tokenStore.getCachedTokens<TTokens>(integrationId);
};

export const getGitHubEnablement = (
  options: EnablementOptions<GitHubTokens> = {},
): IntegrationEnablement => {
  const config = resolveConfig(options.config);
  const env = options.env ?? process.env;
  const tokens = resolveTokens<GitHubTokens>('github', options.tokens);

  const hasEnvToken = hasValue(env.GITHUB_OAUTH_TOKEN) || hasValue(env.GITHUB_TOKEN);
  if (hasEnvToken) {
    return { enabled: true, missing: [] };
  }

  const hasAccessToken = hasValue(tokens?.accessToken);
  const hasRefreshToken = hasValue(tokens?.refreshToken);
  const hasClientId = hasValue(config.github?.oauthClientId);
  const hasClientSecret = hasValue(config.github?.oauthClientSecret);

  const missing: string[] = [];

  if (!hasAccessToken && !hasRefreshToken) {
    missing.push('GITHUB_OAUTH_TOKEN or stored OAuth tokens');
  }

  if (hasAccessToken && !hasRefreshToken) {
    missing.push('GITHUB_REFRESH_TOKEN');
  }

  if (hasRefreshToken && !hasClientId) {
    missing.push('GITHUB_OAUTH_CLIENT_ID');
  }

  if (hasRefreshToken && !hasClientSecret) {
    missing.push('GITHUB_OAUTH_CLIENT_SECRET');
  }

  const enabled = missing.length === 0 && (hasAccessToken || hasRefreshToken);
  return { enabled, missing };
};

export const getGoogleDriveEnablement = (
  options: EnablementOptions<GoogleDriveTokens> = {},
): IntegrationEnablement => {
  const config = resolveConfig(options.config);
  const env = options.env ?? process.env;
  const tokens = resolveTokens<GoogleDriveTokens>('google_drive', options.tokens);
  const missing: string[] = [];

  if (!hasValue(config.googleDrive?.clientId)) {
    missing.push('GOOGLE_DRIVE_CLIENT_ID');
  }

  if (!hasValue(config.googleDrive?.clientSecret)) {
    missing.push('GOOGLE_DRIVE_CLIENT_SECRET');
  }

  if (!hasValue(config.googleDrive?.redirectUri)) {
    missing.push('GOOGLE_DRIVE_REDIRECT_URI');
  }

  const hasRefreshToken =
    hasValue(env.GOOGLE_DRIVE_REFRESH_TOKEN) || hasValue(tokens?.refreshToken);

  if (!hasRefreshToken) {
    missing.push('GOOGLE_DRIVE_REFRESH_TOKEN');
  }

  return { enabled: missing.length === 0, missing };
};

export const getSalesforceEnablement = (
  options: EnablementOptions<SalesforceTokens> = {},
): IntegrationEnablement => {
  const config = resolveConfig(options.config);
  const env = options.env ?? process.env;
  const tokens = resolveTokens<SalesforceTokens>('salesforce', options.tokens);
  const missing: string[] = [];

  if (!hasValue(config.salesforce?.clientId)) {
    missing.push('SALESFORCE_CLIENT_ID');
  }

  if (!hasValue(config.salesforce?.clientSecret)) {
    missing.push('SALESFORCE_CLIENT_SECRET');
  }

  if (!hasValue(config.salesforce?.redirectUri)) {
    missing.push('SALESFORCE_REDIRECT_URI');
  }

  const hasRefreshToken =
    hasValue(env.SALESFORCE_REFRESH_TOKEN) || hasValue(tokens?.refreshToken);

  if (!hasRefreshToken) {
    missing.push('SALESFORCE_REFRESH_TOKEN');
  }

  return { enabled: missing.length === 0, missing };
};
