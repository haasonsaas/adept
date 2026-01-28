import { describe, it, expect } from 'vitest';
import { withRetry } from '../src/lib/retry.js';

describe('withRetry', () => {
  it('retries transient errors and succeeds', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('temporary') as Error & { code?: string };
          error.code = 'ECONNRESET';
          throw error;
        }
        return 'ok';
      },
      { integrationId: 'test', operation: 'transient' },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitterMs: 0 },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('retries on rate limit and succeeds', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('rate limit') as Error & { status?: number; headers?: Record<string, string> };
          error.status = 429;
          error.headers = { 'retry-after': '0' };
          throw error;
        }
        return 'ok';
      },
      { integrationId: 'test', operation: 'rate limit' },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitterMs: 0 },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
