import { RedisJsonStore } from './redis.js';
import { logger } from './logger.js';

interface HandoffMetrics {
  total: number;
  parseFailures: number;
  missingFields: Record<string, number>;
  blockedReasons: Record<string, number>;
  lastUpdated: string;
}

interface HandoffTelemetryInput {
  parsed: boolean;
  missingFields: string[];
  status?: 'done' | 'needs_info' | 'blocked';
  blockedReasons?: string[];
}

const createEmptyMetrics = (): HandoffMetrics => ({
  total: 0,
  parseFailures: 0,
  missingFields: {},
  blockedReasons: {},
  lastUpdated: new Date().toISOString(),
});

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

export class HandoffMonitor {
  private store = new RedisJsonStore<HandoffMetrics>('adept:handoff_metrics');
  private fallback = new Map<string, HandoffMetrics>();

  private getBucket(): string {
    return new Date().toISOString().split('T')[0];
  }

  async record(input: HandoffTelemetryInput): Promise<void> {
    const bucket = this.getBucket();
    const metrics = (await this.store.get(bucket))
      ?? this.fallback.get(bucket)
      ?? createEmptyMetrics();

    metrics.total += 1;
    if (!input.parsed) {
      metrics.parseFailures += 1;
    }

    for (const field of input.missingFields) {
      increment(metrics.missingFields, field);
    }

    if (input.status === 'blocked') {
      const reasons = input.blockedReasons && input.blockedReasons.length > 0
        ? input.blockedReasons
        : ['unspecified'];
      for (const reason of reasons) {
        increment(metrics.blockedReasons, reason);
      }
    }

    metrics.lastUpdated = new Date().toISOString();

    await this.store.set(bucket, metrics);
    this.fallback.set(bucket, metrics);

    logger.info(
      {
        parsed: input.parsed,
        missingFields: input.missingFields,
        status: input.status,
        blockedReasons: input.blockedReasons,
      },
      '[Handoff] Quality record',
    );
  }
}

export const handoffMonitor = new HandoffMonitor();
