import { afterEach, describe, expect, it } from 'vitest';
import {
  getGitHubEnablement,
  getGoogleDriveEnablement,
  getSalesforceEnablement,
} from '../src/lib/integration-config.js';
import { resetConfig } from '../src/lib/config.js';

const BASE_ENV = { ...process.env };

const resetEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in BASE_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(BASE_ENV)) {
    process.env[key] = value;
  }
};

const setEnv = (values: Record<string, string | undefined>) => {
  resetEnv();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetConfig();
};

afterEach(() => {
  resetEnv();
  resetConfig();
});

describe('getGitHubEnablement', () => {
  it('enables when a GitHub token is provided', () => {
    setEnv({ GITHUB_TOKEN: 'token' });

    const result = getGitHubEnablement({ tokens: null });

    expect(result.enabled).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('enables when refresh tokens and OAuth credentials are present', () => {
    setEnv({
      GITHUB_OAUTH_CLIENT_ID: 'client',
      GITHUB_OAUTH_CLIENT_SECRET: 'secret',
    });

    const result = getGitHubEnablement({
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    });

    expect(result.enabled).toBe(true);
  });

  it('disables when refresh token is missing', () => {
    setEnv({
      GITHUB_OAUTH_CLIENT_ID: 'client',
      GITHUB_OAUTH_CLIENT_SECRET: 'secret',
    });

    const result = getGitHubEnablement({ tokens: { accessToken: 'access' } });

    expect(result.enabled).toBe(false);
    expect(result.missing).toContain('GITHUB_REFRESH_TOKEN');
  });
});

describe('getGoogleDriveEnablement', () => {
  it('requires client credentials, redirect URI, and refresh token', () => {
    setEnv({
      GOOGLE_DRIVE_CLIENT_ID: 'client',
      GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
      GOOGLE_DRIVE_REDIRECT_URI: 'https://example.com/callback',
      GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh',
    });

    const result = getGoogleDriveEnablement({ tokens: null });

    expect(result.enabled).toBe(true);
  });

  it('flags a missing redirect URI', () => {
    setEnv({
      GOOGLE_DRIVE_CLIENT_ID: 'client',
      GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
      GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh',
    });

    const result = getGoogleDriveEnablement({ tokens: null });

    expect(result.enabled).toBe(false);
    expect(result.missing).toContain('GOOGLE_DRIVE_REDIRECT_URI');
  });
});

describe('getSalesforceEnablement', () => {
  it('requires OAuth credentials, redirect URI, and refresh token', () => {
    setEnv({
      SALESFORCE_CLIENT_ID: 'client',
      SALESFORCE_CLIENT_SECRET: 'secret',
      SALESFORCE_REDIRECT_URI: 'https://example.com/callback',
      SALESFORCE_REFRESH_TOKEN: 'refresh',
    });

    const result = getSalesforceEnablement({ tokens: null });

    expect(result.enabled).toBe(true);
  });

  it('flags a missing refresh token', () => {
    setEnv({
      SALESFORCE_CLIENT_ID: 'client',
      SALESFORCE_CLIENT_SECRET: 'secret',
      SALESFORCE_REDIRECT_URI: 'https://example.com/callback',
    });

    const result = getSalesforceEnablement({ tokens: null });

    expect(result.enabled).toBe(false);
    expect(result.missing).toContain('SALESFORCE_REFRESH_TOKEN');
  });
});
