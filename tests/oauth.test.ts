import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOAuthRedirectUri,
  buildOAuthStartUrl,
  buildSharedSecretParam,
  getOAuthBaseUrl,
  normalizeBaseUrl,
} from '../src/lib/oauth.js';
import { resetConfig } from '../src/lib/config.js';

const originalBaseUrl = process.env.OAUTH_BASE_URL;

afterEach(() => {
  process.env.OAUTH_BASE_URL = originalBaseUrl;
  resetConfig();
});

describe('oauth helpers', () => {
  it('normalizes base URLs', () => {
    expect(normalizeBaseUrl('http://example.com/')).toBe('http://example.com');
    expect(normalizeBaseUrl('http://example.com')).toBe('http://example.com');
  });

  it('builds redirect and start URLs', () => {
    expect(buildOAuthRedirectUri('http://example.com/', 'github')).toBe(
      'http://example.com/oauth/github/callback',
    );
    expect(buildOAuthRedirectUri('http://example.com', 'github', 'http://override')).toBe(
      'http://override',
    );
    expect(buildOAuthStartUrl('http://example.com/', 'github')).toBe(
      'http://example.com/oauth/github/start',
    );
  });

  it('builds shared secret query params', () => {
    expect(buildSharedSecretParam()).toBe('');
    expect(buildSharedSecretParam('shared secret')).toBe('?secret=shared%20secret');
  });

  it('uses config base URL when provided', () => {
    process.env.OAUTH_BASE_URL = 'http://example.com/';
    resetConfig();
    expect(getOAuthBaseUrl()).toBe('http://example.com');
  });
});
