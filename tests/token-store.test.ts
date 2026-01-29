import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { TokenStore } from '../src/lib/token-store.js';

const createTempPath = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wayfinder-token-store-'));
  return path.join(dir, 'tokens.json');
};

describe('TokenStore', () => {
  it('encrypts tokens on disk and decrypts them', async () => {
    const storePath = await createTempPath();
    const secret = 'test-secret';
    const store = new TokenStore({ storePath, secret });

    await store.setTokens('github', { accessToken: 'abc123' });

    const raw = await fs.readFile(storePath, 'utf-8');
    expect(raw).not.toContain('abc123');
    expect(raw).toContain('encrypted');

    const reloaded = new TokenStore({ storePath, secret });
    const tokens = await reloaded.getTokens<{ accessToken?: string }>('github');
    expect(tokens?.accessToken).toBe('abc123');
  });

  it('throws if encrypted store is read without secret', async () => {
    const storePath = await createTempPath();
    const store = new TokenStore({ storePath, secret: 'secret-one' });
    await store.setTokens('salesforce', { refreshToken: 'refresh' });

    const missingSecretStore = new TokenStore({ storePath });
    await expect(missingSecretStore.getTokens('salesforce')).rejects.toThrow(
      'Token store is encrypted',
    );
  });
});
