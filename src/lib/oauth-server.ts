import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import { tokenStore } from './token-store.js';

const DEFAULT_PORT = 3999;
const STATE_TTL_MS = 10 * 60 * 1000;

type IntegrationKey = 'salesforce' | 'github' | 'google-drive';

interface OAuthState {
  integration: IntegrationKey;
  createdAt: number;
}

interface SalesforceTokenResponse {
  access_token?: string;
  refresh_token?: string;
  instance_url?: string;
  issued_at?: string;
}

interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

const stateStore = new Map<string, OAuthState>();

const getPort = () => Number(process.env.OAUTH_PORT || DEFAULT_PORT);

const getBaseUrl = (port: number) => process.env.OAUTH_BASE_URL || `http://localhost:${port}`;

const getRedirectUri = (integration: IntegrationKey, baseUrl: string): string => {
  if (integration === 'salesforce') {
    return process.env.SALESFORCE_REDIRECT_URI || `${baseUrl}/oauth/salesforce/callback`;
  }

  if (integration === 'github') {
    return process.env.GITHUB_OAUTH_REDIRECT_URI || `${baseUrl}/oauth/github/callback`;
  }

  return process.env.GOOGLE_DRIVE_REDIRECT_URI || `${baseUrl}/oauth/google-drive/callback`;
};

const clearExpiredStates = () => {
  const now = Date.now();
  for (const [key, value] of stateStore.entries()) {
    if (now - value.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
};

const createState = (integration: IntegrationKey) => {
  clearExpiredStates();
  const state = randomBytes(16).toString('hex');
  stateStore.set(state, { integration, createdAt: Date.now() });
  return state;
};

const validateState = (state: string | null, integration: IntegrationKey): boolean => {
  if (!state) {
    return false;
  }

  const stored = stateStore.get(state);
  stateStore.delete(state);

  if (!stored) {
    return false;
  }

  return stored.integration === integration && Date.now() - stored.createdAt <= STATE_TTL_MS;
};

const renderHtml = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; color: #111; }
      code { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h2>${title}</h2>
    <p>${body}</p>
  </body>
</html>`;

const sendResponse = (res: http.ServerResponse, status: number, html: string) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
};

const redirect = (res: http.ServerResponse, url: string) => {
  res.writeHead(302, { Location: url });
  res.end();
};

const salesforceAuthUrl = (state: string, redirectUri: string) => {
  const loginUrl = (process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com').replace(/\/$/, '');
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  if (!clientId) {
    throw new Error('Missing SALESFORCE_CLIENT_ID');
  }

  const url = new URL(`${loginUrl}/services/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'refresh_token api');
  url.searchParams.set('state', state);
  return url.toString();
};

const exchangeSalesforceCode = async (code: string, redirectUri: string): Promise<SalesforceTokenResponse> => {
  const loginUrl = (process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com').replace(/\/$/, '');
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing SALESFORCE_CLIENT_ID or SALESFORCE_CLIENT_SECRET');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Salesforce token exchange failed (${response.status})`);
  }

  return (await response.json()) as SalesforceTokenResponse;
};

const githubAuthUrl = (state: string, redirectUri: string) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error('Missing GITHUB_OAUTH_CLIENT_ID');
  }

  const baseUrl = (process.env.GITHUB_OAUTH_BASE_URL || 'https://github.com').replace(/\/$/, '');
  const url = new URL(`${baseUrl}/login/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', process.env.GITHUB_OAUTH_SCOPES || 'repo read:org read:user');
  url.searchParams.set('state', state);
  return url.toString();
};

const exchangeGitHubCode = async (code: string, redirectUri: string, state: string): Promise<GitHubTokenResponse> => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing GITHUB_OAUTH_CLIENT_ID or GITHUB_OAUTH_CLIENT_SECRET');
  }

  const baseUrl = (process.env.GITHUB_OAUTH_BASE_URL || 'https://github.com').replace(/\/$/, '');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    state,
  });

  const response = await fetch(`${baseUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed (${response.status})`);
  }

  return (await response.json()) as GitHubTokenResponse;
};

const googleAuthUrl = (state: string, redirectUri: string) => {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET');
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
    state,
  });
};

const exchangeGoogleCode = async (code: string, redirectUri: string) => {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET');
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth.getToken(code);
  return tokens;
};

const handleStart = (integration: IntegrationKey, baseUrl: string, res: http.ServerResponse) => {
  const state = createState(integration);
  const redirectUri = getRedirectUri(integration, baseUrl);

  if (integration === 'salesforce') {
    redirect(res, salesforceAuthUrl(state, redirectUri));
    return;
  }

  if (integration === 'github') {
    redirect(res, githubAuthUrl(state, redirectUri));
    return;
  }

  redirect(res, googleAuthUrl(state, redirectUri));
};

const handleCallback = async (
  integration: IntegrationKey,
  baseUrl: string,
  url: URL,
  res: http.ServerResponse,
) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    sendResponse(res, 400, renderHtml('OAuth error', `${error}: ${errorDescription ?? ''}`));
    return;
  }

  if (!code) {
    sendResponse(res, 400, renderHtml('OAuth error', 'Missing authorization code.'));
    return;
  }

  if (!validateState(state, integration)) {
    sendResponse(res, 400, renderHtml('OAuth error', 'Invalid or expired state.'));
    return;
  }

  const redirectUri = getRedirectUri(integration, baseUrl);

  try {
    if (integration === 'salesforce') {
      const data = await exchangeSalesforceCode(code, redirectUri);
      if (!data.refresh_token) {
        throw new Error('Salesforce did not return a refresh token. Ensure refresh_token scope is enabled.');
      }
      await tokenStore.setTokens('salesforce', {
        refreshToken: data.refresh_token,
        instanceUrl: data.instance_url,
        issuedAt: data.issued_at,
      });
      sendResponse(res, 200, renderHtml('Salesforce connected', 'Refresh token saved for Adept.'));
      return;
    }

    if (integration === 'github') {
      const data = await exchangeGitHubCode(code, redirectUri, state ?? '');
      if (!data.access_token) {
        throw new Error(data.error_description || 'GitHub did not return an access token.');
      }
      await tokenStore.setTokens('github', {
        accessToken: data.access_token,
        scope: data.scope,
        tokenType: data.token_type,
      });
      sendResponse(res, 200, renderHtml('GitHub connected', 'Access token saved for Adept.'));
      return;
    }

    const tokens = await exchangeGoogleCode(code, redirectUri);
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token. Revoke access and retry with prompt=consent.');
    }

    await tokenStore.setTokens('google_drive', {
      refreshToken: tokens.refresh_token,
      scope: tokens.scope,
      expiryDate: tokens.expiry_date,
    });

    sendResponse(res, 200, renderHtml('Google Drive connected', 'Refresh token saved for Adept.'));
  } catch (err) {
    sendResponse(res, 500, renderHtml('OAuth error', err instanceof Error ? err.message : String(err)));
  }
};

export const startOAuthServer = () => {
  const port = getPort();
  const baseUrl = getBaseUrl(port);

  const server = http.createServer(async (req, res) => {
    if (!req.url || req.method !== 'GET') {
      sendResponse(res, 404, renderHtml('Not found', 'Route not found.'));
      return;
    }

    const url = new URL(req.url, baseUrl);
    const path = url.pathname;

    try {
      if (path === '/oauth/salesforce/start') {
        handleStart('salesforce', baseUrl, res);
        return;
      }

      if (path === '/oauth/github/start') {
        handleStart('github', baseUrl, res);
        return;
      }

      if (path === '/oauth/google-drive/start') {
        handleStart('google-drive', baseUrl, res);
        return;
      }

      if (path === '/oauth/salesforce/callback') {
        await handleCallback('salesforce', baseUrl, url, res);
        return;
      }

      if (path === '/oauth/github/callback') {
        await handleCallback('github', baseUrl, url, res);
        return;
      }

      if (path === '/oauth/google-drive/callback') {
        await handleCallback('google-drive', baseUrl, url, res);
        return;
      }

      sendResponse(res, 404, renderHtml('Not found', 'Route not found.'));
    } catch (error) {
      sendResponse(res, 500, renderHtml('OAuth error', error instanceof Error ? error.message : String(error)));
    }
  });

  server.listen(port, () => {
    console.log(`[Adept] OAuth server listening on ${baseUrl}`);
  });

  return server;
};
