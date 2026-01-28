import { IntegrationRateLimitError } from './errors.js';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getStatusCode = (error: unknown): number | undefined => {
  if (!isRecord(error)) {
    return undefined;
  }

  const status = error.status ?? error.statusCode ?? error.code;
  return typeof status === 'number' ? status : undefined;
};

const getErrorCode = (error: unknown): string | undefined => {
  if (!isRecord(error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
};

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  const normalized: Record<string, string> = {};

  if (!headers) {
    return normalized;
  }

  if (typeof (headers as { forEach?: unknown }).forEach === 'function') {
    (headers as { forEach: (cb: (value: string, key: string) => void) => void }).forEach(
      (value, key) => {
        normalized[key.toLowerCase()] = String(value);
      },
    );
    return normalized;
  }

  if (!isRecord(headers)) {
    return normalized;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' || typeof value === 'number') {
      normalized[key.toLowerCase()] = String(value);
    } else if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = String(value[0]);
    }
  }

  return normalized;
};

const getHeaders = (error: unknown): Record<string, string> => {
  if (!isRecord(error)) {
    return {};
  }

  if (isRecord(error.response) && error.response.headers) {
    return normalizeHeaders(error.response.headers);
  }

  if (error.headers) {
    return normalizeHeaders(error.headers);
  }

  return {};
};

const parseRetryAfterMs = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
};

const parseRateLimitResetMs = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const resetSeconds = Number(value);
  if (Number.isNaN(resetSeconds)) {
    return undefined;
  }

  return Math.max(0, resetSeconds * 1000 - Date.now());
};

const isRateLimitError = (status: number | undefined, headers: Record<string, string>) => {
  if (status === 429) {
    return true;
  }

  if (status === 403 && headers['x-ratelimit-remaining'] === '0') {
    return true;
  }

  return false;
};

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}

export interface RetryContext {
  integrationId?: string;
  operation?: string;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  context: RetryContext = {},
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const jitterMs = options.jitterMs ?? 250;

  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      const status = getStatusCode(error);
      const headers = getHeaders(error);
      const code = getErrorCode(error);
      const rateLimit = isRateLimitError(status, headers);
      const retryAfter = parseRetryAfterMs(headers['retry-after']);
      const resetAfter = parseRateLimitResetMs(headers['x-ratelimit-reset']);
      const shouldRetry =
        rateLimit ||
        (status !== undefined && RETRYABLE_STATUS.has(status)) ||
        (code !== undefined && RETRYABLE_CODES.has(code));

      if (!shouldRetry || attempt >= maxAttempts) {
        if (rateLimit) {
          const delayMs = retryAfter ?? resetAfter;
          if (delayMs && delayMs > maxDelayMs) {
            throw new IntegrationRateLimitError(
              `${context.integrationId ?? 'Integration'} rate limit exceeded.`,
              {
                integrationId: context.integrationId,
                retryAfterSeconds: Math.ceil(delayMs / 1000),
                retryAt: new Date(Date.now() + delayMs),
              },
            );
          }
        }
        throw error;
      }

      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      let delayMs = retryAfter ?? resetAfter ?? backoff;
      delayMs = Math.min(maxDelayMs, delayMs + Math.floor(Math.random() * jitterMs));

      if (rateLimit && delayMs > maxDelayMs) {
        throw new IntegrationRateLimitError(
          `${context.integrationId ?? 'Integration'} rate limit exceeded.`,
          {
            integrationId: context.integrationId,
            retryAfterSeconds: Math.ceil(delayMs / 1000),
            retryAt: new Date(Date.now() + delayMs),
          },
        );
      }

      await sleep(delayMs);
    }
  }
}
