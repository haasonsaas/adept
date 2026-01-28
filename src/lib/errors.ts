export type IntegrationErrorKind = 'auth' | 'rate_limit' | 'invalid_request' | 'not_found' | 'upstream';

export interface ToolErrorResponse {
  error: string;
  errorType?: IntegrationErrorKind;
  integrationId?: string;
  hint?: string;
  retryAfterSeconds?: number;
}

interface IntegrationErrorOptions {
  integrationId?: string;
  hint?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class IntegrationError extends Error {
  readonly kind: IntegrationErrorKind;
  readonly integrationId?: string;
  readonly hint?: string;
  readonly retryAfterSeconds?: number;

  constructor(kind: IntegrationErrorKind, message: string, options: IntegrationErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'IntegrationError';
    this.kind = kind;
    this.integrationId = options.integrationId;
    this.hint = options.hint;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class IntegrationAuthError extends IntegrationError {
  constructor(message: string, options: IntegrationErrorOptions = {}) {
    super('auth', message, options);
    this.name = 'IntegrationAuthError';
  }
}

export class IntegrationRateLimitError extends IntegrationError {
  readonly retryAt?: Date;

  constructor(message: string, options: IntegrationErrorOptions & { retryAt?: Date } = {}) {
    super('rate_limit', message, options);
    this.name = 'IntegrationRateLimitError';
    this.retryAt = options.retryAt;
  }
}

export const isIntegrationError = (error: unknown): error is IntegrationError =>
  error instanceof IntegrationError;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isToolErrorResponse = (value: unknown): value is ToolErrorResponse =>
  isRecord(value) && typeof value.error === 'string';

export const createToolError = (
  integrationId: string,
  message: string,
  options: { kind?: IntegrationErrorKind; hint?: string; retryAfterSeconds?: number } = {},
): ToolErrorResponse => ({
  error: message,
  errorType: options.kind,
  integrationId,
  hint: options.hint,
  retryAfterSeconds: options.retryAfterSeconds,
});

export const toToolError = (integrationId: string, error: unknown): ToolErrorResponse => {
  if (isIntegrationError(error)) {
    return createToolError(error.integrationId ?? integrationId, error.message, {
      kind: error.kind,
      hint: error.hint,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return createToolError(integrationId, message, { kind: 'upstream' });
};

export const formatIntegrationError = (error: IntegrationError): string => {
  const parts: string[] = [error.message];

  if (error.kind === 'rate_limit' && error.retryAfterSeconds) {
    const seconds = Math.ceil(error.retryAfterSeconds);
    parts.push(`Try again in ${seconds}s.`);
  }

  if (error.hint) {
    parts.push(error.hint);
  }

  return parts.join(' ');
};
