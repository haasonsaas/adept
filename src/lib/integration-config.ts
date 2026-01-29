import type { WayfinderConfig } from '../types/index.js';
import { loadConfig } from './config.js';
import { tokenStore } from './token-store.js';

export interface IntegrationEnablement {
  enabled: boolean;
  missing: string[];
}

export type IntegrationTokenSource = 'env' | 'store' | 'none';

export interface IntegrationTokenHealth {
  source: IntegrationTokenSource;
  hasTokens: boolean;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  updatedAt?: string;
  expired?: boolean;
  refreshTokenExpired?: boolean;
}

export interface IntegrationHealth {
  integrationId: string;
  enabled: boolean;
  missing: string[];
  token: IntegrationTokenHealth;
}

interface EnablementOptions<TTokens> {
  config?: WayfinderConfig;
  tokens?: TTokens | null;
  env?: NodeJS.ProcessEnv;
}

type GitHubTokens = Record<string, unknown> & {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  updatedAt?: string;
};

type GoogleDriveTokens = Record<string, unknown> & {
  refreshToken?: string;
  accessToken?: string;
  expiryDate?: number;
  updatedAt?: string;
};

type SalesforceTokens = Record<string, unknown> & {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  updatedAt?: string;
};

const hasValue = (value?: string) => typeof value === 'string' && value.trim().length > 0;

const addMissing = (missing: string[], condition: boolean, label: string) => {
  if (condition) {
    missing.push(label);
  }
};

const buildEnablement = (missing: string[]): IntegrationEnablement => ({
  enabled: missing.length === 0,
  missing,
});

const hasEnvValue = (env: NodeJS.ProcessEnv, keys: string[]) =>
  keys.some((key) => hasValue(env[key]));

const resolveConfig = (config?: WayfinderConfig) => config ?? loadConfig();

const resolveTokens = <TTokens extends Record<string, unknown>>(
  integrationId: string,
  tokens?: TTokens | null,
): TTokens | null => {
  if (tokens !== undefined) {
    return tokens;
  }
  return tokenStore.getCachedTokens<TTokens>(integrationId);
};

const buildTokenHealth = (params: {
  source: IntegrationTokenSource;
  hasTokens: boolean;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  updatedAt?: string;
  now: number;
}): IntegrationTokenHealth => {
  const token: IntegrationTokenHealth = {
    source: params.source,
    hasTokens: params.hasTokens,
  };

  if (typeof params.expiresAt === 'number') {
    token.expiresAt = params.expiresAt;
    token.expired = params.now >= params.expiresAt;
  }

  if (typeof params.refreshTokenExpiresAt === 'number') {
    token.refreshTokenExpiresAt = params.refreshTokenExpiresAt;
    token.refreshTokenExpired = params.now >= params.refreshTokenExpiresAt;
  }

  if (params.updatedAt) {
    token.updatedAt = params.updatedAt;
  }

  return token;
};

const resolveRefreshToken = (
  env: NodeJS.ProcessEnv,
  tokens?: { refreshToken?: string } | null,
  envKeys: string[] = [],
): boolean => hasEnvValue(env, envKeys) || hasValue(tokens?.refreshToken);

const getStandardOAuthEnablement = (
  options: {
    configValues: Array<{ value?: string; label: string }>;
    env: NodeJS.ProcessEnv;
    refreshTokenEnvKeys: string[];
    refreshTokenLabel: string;
    tokens?: { refreshToken?: string } | null;
  },
): IntegrationEnablement => {
  const missing: string[] = [];

  for (const entry of options.configValues) {
    addMissing(missing, !hasValue(entry.value), entry.label);
  }

  const hasRefreshToken = resolveRefreshToken(
    options.env,
    options.tokens,
    options.refreshTokenEnvKeys,
  );
  addMissing(missing, !hasRefreshToken, options.refreshTokenLabel);

  return buildEnablement(missing);
};

export const getGitHubEnablement = (
  options: EnablementOptions<GitHubTokens> = {},
): IntegrationEnablement => {
  const config = resolveConfig(options.config);
  const env = options.env ?? process.env;
  const tokens = resolveTokens<GitHubTokens>('github', options.tokens);

  const hasEnvToken = hasEnvValue(env, ['GITHUB_OAUTH_TOKEN', 'GITHUB_TOKEN']);
  if (hasEnvToken) {
    return buildEnablement([]);
  }

  const hasAccessToken = hasValue(tokens?.accessToken);
  const hasRefreshToken = hasValue(tokens?.refreshToken);
  const hasClientId = hasValue(config.github?.oauthClientId);
  const hasClientSecret = hasValue(config.github?.oauthClientSecret);

  const missing: string[] = [];

  addMissing(missing, !hasAccessToken && !hasRefreshToken, 'GITHUB_OAUTH_TOKEN or stored OAuth tokens');
  addMissing(missing, hasAccessToken && !hasRefreshToken, 'GITHUB_REFRESH_TOKEN');
  addMissing(missing, hasRefreshToken && !hasClientId, 'GITHUB_OAUTH_CLIENT_ID');
  addMissing(missing, hasRefreshToken && !hasClientSecret, 'GITHUB_OAUTH_CLIENT_SECRET');

  const enabled = missing.length === 0 && (hasAccessToken || hasRefreshToken);
  return { enabled, missing };
};

export const getGoogleDriveEnablement = (
  options: EnablementOptions<GoogleDriveTokens> = {},
): IntegrationEnablement => {
  const config = resolveConfig(options.config);
  const env = options.env ?? process.env;
  const tokens = resolveTokens<GoogleDriveTokens>('google_drive', options.tokens);

  return getStandardOAuthEnablement({
    configValues: [
      { value: config.googleDrive?.clientId, label: 'GOOGLE_DRIVE_CLIENT_ID' },
      { value: config.googleDrive?.clientSecret, label: 'GOOGLE_DRIVE_CLIENT_SECRET' },
      { value: config.googleDrive?.redirectUri, label: 'GOOGLE_DRIVE_REDIRECT_URI' },
    ],
    env,
    refreshTokenEnvKeys: ['GOOGLE_DRIVE_REFRESH_TOKEN'],
    refreshTokenLabel: 'GOOGLE_DRIVE_REFRESH_TOKEN',
    tokens,
  });
};

export const getSalesforceEnablement = (
  options: EnablementOptions<SalesforceTokens> = {},
): IntegrationEnablement => {
  const config = resolveConfig(options.config);
  const env = options.env ?? process.env;
  const tokens = resolveTokens<SalesforceTokens>('salesforce', options.tokens);

  return getStandardOAuthEnablement({
    configValues: [
      { value: config.salesforce?.clientId, label: 'SALESFORCE_CLIENT_ID' },
      { value: config.salesforce?.clientSecret, label: 'SALESFORCE_CLIENT_SECRET' },
      { value: config.salesforce?.redirectUri, label: 'SALESFORCE_REDIRECT_URI' },
    ],
    env,
    refreshTokenEnvKeys: ['SALESFORCE_REFRESH_TOKEN'],
    refreshTokenLabel: 'SALESFORCE_REFRESH_TOKEN',
    tokens,
  });
};

interface HealthOptions<TTokens> extends EnablementOptions<TTokens> {
  now?: number;
}

export const getGitHubHealth = (
  options: HealthOptions<GitHubTokens> = {},
): IntegrationHealth => {
  const env = options.env ?? process.env;
  const enablement = getGitHubEnablement(options);
  const now = options.now ?? Date.now();
  const hasEnvToken = hasEnvValue(env, ['GITHUB_OAUTH_TOKEN', 'GITHUB_TOKEN']);

  if (hasEnvToken) {
    return {
      integrationId: 'github',
      enabled: enablement.enabled,
      missing: enablement.missing,
      token: buildTokenHealth({
        source: 'env',
        hasTokens: true,
        now,
      }),
    };
  }

  const tokens = resolveTokens<GitHubTokens>('github', options.tokens);
  const hasStoredTokens = Boolean(tokens?.accessToken || tokens?.refreshToken);

  return {
    integrationId: 'github',
    enabled: enablement.enabled,
    missing: enablement.missing,
    token: buildTokenHealth({
      source: hasStoredTokens ? 'store' : 'none',
      hasTokens: hasStoredTokens,
      expiresAt: hasStoredTokens ? tokens?.expiresAt : undefined,
      refreshTokenExpiresAt: hasStoredTokens ? tokens?.refreshTokenExpiresAt : undefined,
      updatedAt: hasStoredTokens ? tokens?.updatedAt : undefined,
      now,
    }),
  };
};

export const getGoogleDriveHealth = (
  options: HealthOptions<GoogleDriveTokens> = {},
): IntegrationHealth => {
  const env = options.env ?? process.env;
  const enablement = getGoogleDriveEnablement(options);
  const now = options.now ?? Date.now();
  const tokens = resolveTokens<GoogleDriveTokens>('google_drive', options.tokens);
  const hasStoredTokens = Boolean(tokens?.refreshToken || tokens?.accessToken);
  const hasEnvToken = hasEnvValue(env, ['GOOGLE_DRIVE_REFRESH_TOKEN']);
  const hasTokens = hasStoredTokens || hasEnvToken;
  const source: IntegrationTokenSource = hasStoredTokens ? 'store' : hasEnvToken ? 'env' : 'none';

  return {
    integrationId: 'google_drive',
    enabled: enablement.enabled,
    missing: enablement.missing,
    token: buildTokenHealth({
      source,
      hasTokens,
      expiresAt: hasStoredTokens ? tokens?.expiryDate : undefined,
      updatedAt: hasStoredTokens ? tokens?.updatedAt : undefined,
      now,
    }),
  };
};

export const getSalesforceHealth = (
  options: HealthOptions<SalesforceTokens> = {},
): IntegrationHealth => {
  const env = options.env ?? process.env;
  const enablement = getSalesforceEnablement(options);
  const now = options.now ?? Date.now();
  const tokens = resolveTokens<SalesforceTokens>('salesforce', options.tokens);
  const hasStoredTokens = Boolean(tokens?.refreshToken || tokens?.accessToken);
  const hasEnvToken = hasEnvValue(env, ['SALESFORCE_REFRESH_TOKEN']);
  const hasTokens = hasStoredTokens || hasEnvToken;
  const source: IntegrationTokenSource = hasStoredTokens ? 'store' : hasEnvToken ? 'env' : 'none';

  return {
    integrationId: 'salesforce',
    enabled: enablement.enabled,
    missing: enablement.missing,
    token: buildTokenHealth({
      source,
      hasTokens,
      expiresAt: hasStoredTokens ? tokens?.expiresAt : undefined,
      updatedAt: hasStoredTokens ? tokens?.updatedAt : undefined,
      now,
    }),
  };
};

export const getIntegrationHealth = (
  integrationId: string,
  options: HealthOptions<Record<string, unknown>> = {},
): IntegrationHealth | null => {
  if (integrationId === 'github') {
    return getGitHubHealth(options as HealthOptions<GitHubTokens>);
  }
  if (integrationId === 'google_drive') {
    return getGoogleDriveHealth(options as HealthOptions<GoogleDriveTokens>);
  }
  if (integrationId === 'salesforce') {
    return getSalesforceHealth(options as HealthOptions<SalesforceTokens>);
  }
  return null;
};
