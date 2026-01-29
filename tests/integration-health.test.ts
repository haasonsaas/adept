import { describe, expect, it } from 'vitest';
import type { AdeptConfig } from '../src/types/index.js';
import { getGitHubHealth, getGoogleDriveHealth, getSalesforceHealth } from '../src/lib/integration-config.js';

const buildConfig = (): AdeptConfig => ({
  defaultProvider: 'openai',
  enabledIntegrations: [],
  maxToolSteps: 5,
  slack: {
    botToken: '',
    signingSecret: '',
    appToken: '',
  },
  openaiApiKey: 'test-key',
  oauthServerEnabled: true,
  oauth: {
    port: 3999,
    baseUrl: 'http://localhost:3999',
    bindHost: '127.0.0.1',
    allowRemote: false,
  },
  github: {
    oauthClientId: 'client',
    oauthClientSecret: 'secret',
    oauthRedirectUri: 'http://localhost:3999/oauth/github/callback',
  },
  salesforce: {
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'http://localhost:3999/oauth/salesforce/callback',
    loginUrl: 'https://login.salesforce.com',
  },
  googleDrive: {
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'http://localhost:3999/oauth/google-drive/callback',
  },
});

describe('integration health', () => {
  it('reports env token usage for GitHub', () => {
    const health = getGitHubHealth({
      env: { GITHUB_OAUTH_TOKEN: 'token' } as NodeJS.ProcessEnv,
    });

    expect(health.token.source).toBe('env');
    expect(health.token.hasTokens).toBe(true);
    expect(health.missing).toEqual([]);
  });

  it('reports token expiry and last refresh for Google Drive', () => {
    const now = Date.now();
    const health = getGoogleDriveHealth({
      config: buildConfig(),
      env: {} as NodeJS.ProcessEnv,
      now,
      tokens: {
        refreshToken: 'refresh',
        accessToken: 'access',
        expiryDate: now - 1000,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(health.token.source).toBe('store');
    expect(health.token.expired).toBe(true);
    expect(health.token.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reports env refresh tokens for Salesforce', () => {
    const health = getSalesforceHealth({
      config: buildConfig(),
      env: { SALESFORCE_REFRESH_TOKEN: 'refresh' } as NodeJS.ProcessEnv,
    });

    expect(health.token.source).toBe('env');
    expect(health.token.hasTokens).toBe(true);
  });
});
