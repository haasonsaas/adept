import { loadConfig } from './config.js';

export const normalizeBaseUrl = (value: string): string => value.replace(/\/$/, '');

export const getOAuthBaseUrl = (): string => normalizeBaseUrl(loadConfig().oauth.baseUrl);

export const buildOAuthRedirectUri = (
  baseUrl: string,
  integrationId: string,
  override?: string,
): string => override ?? `${normalizeBaseUrl(baseUrl)}/oauth/${integrationId}/callback`;

export const buildOAuthStartUrl = (baseUrl: string, integrationId: string): string =>
  `${normalizeBaseUrl(baseUrl)}/oauth/${integrationId}/start`;

export const buildSharedSecretParam = (sharedSecret?: string): string => {
  if (!sharedSecret) {
    return '';
  }
  return `?secret=${encodeURIComponent(sharedSecret)}`;
};
