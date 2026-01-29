import { createHash } from 'node:crypto';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const ALWAYS_ALLOWED_TOOLS = new Set([
  'tool_registry_search',
  'tool_registry_execute',
  'get_current_time',
]);

const DEDUPE_PATTERNS: RegExp[] = [
  /create[_-]?(issue|ticket|bug)/i,
  /create[_-]?(pr|pull[_-]?request|merge[_-]?request)/i,
];

const MAX_DEDUPE_ENTRIES = 1500;

const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (val as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return val;
  });

const normalizeList = (values?: string[]): string[] =>
  (values ?? []).map((value) => value.trim()).filter(Boolean);

export class ToolGuardrails {
  private dedupeCache = new Map<string, number>();

  private getDedupeWindowMs(): number {
    const windowMinutes = loadConfig().toolRouting?.dedupeWindowMinutes ?? 60;
    return Math.max(windowMinutes, 1) * 60 * 1000;
  }

  getAllowlist(workspaceId?: string): string[] {
    const allowlist = loadConfig().toolRouting?.allowlistByWorkspace;
    if (!allowlist) return [];
    if (workspaceId && allowlist[workspaceId]) return normalizeList(allowlist[workspaceId]);
    if (allowlist['*']) return normalizeList(allowlist['*']);
    return [];
  }

  getAllowlistSummary(workspaceId?: string): string | null {
    const allowlist = this.getAllowlist(workspaceId);
    if (allowlist.length === 0) return null;
    const preview = allowlist.slice(0, 12);
    const suffix = allowlist.length > preview.length ? ' (truncated)' : '';
    return `- ${preview.join('\n- ')}${suffix}`;
  }

  getToolHints(workspaceId?: string): string[] {
    const hints = loadConfig().toolRouting?.mustUseToolHintsByWorkspace;
    if (!hints) return [];
    if (workspaceId && hints[workspaceId]) return normalizeList(hints[workspaceId]);
    if (hints['*']) return normalizeList(hints['*']);
    return [];
  }

  isToolAllowed(params: { workspaceId?: string; toolName: string; integrationId?: string }): {
    allowed: boolean;
    reason?: string;
  } {
    const { workspaceId, toolName, integrationId } = params;
    if (!workspaceId) return { allowed: true };
    if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return { allowed: true };

    const allowlist = this.getAllowlist(workspaceId);
    if (allowlist.length === 0) return { allowed: true };

    const normalizedTool = toolName.toLowerCase();
    const normalizedIntegration = integrationId?.toLowerCase();

    for (const entry of allowlist) {
      const normalizedEntry = entry.toLowerCase();
      if (normalizedEntry === normalizedTool) return { allowed: true };
      if (normalizedIntegration && normalizedEntry === normalizedIntegration) return { allowed: true };
      if (normalizedEntry.endsWith('*') && normalizedTool.startsWith(normalizedEntry.slice(0, -1))) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `Tool ${toolName} is not allowed for workspace ${workspaceId}.`,
    };
  }

  shouldDedupe(toolName: string): boolean {
    if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return false;
    return DEDUPE_PATTERNS.some((pattern) => pattern.test(toolName));
  }

  isDuplicate(params: {
    workspaceId?: string;
    toolName: string;
    input: Record<string, unknown>;
  }): boolean {
    const { workspaceId, toolName, input } = params;
    const windowMs = this.getDedupeWindowMs();
    const now = Date.now();
    const key = createHash('sha256')
      .update(`${workspaceId ?? 'global'}:${toolName}:${stableStringify(input)}`)
      .digest('hex');

    const previous = this.dedupeCache.get(key);
    if (previous && now - previous < windowMs) {
      logger.info({ toolName, workspaceId }, '[ToolGuardrails] Duplicate action blocked');
      return true;
    }

    this.dedupeCache.set(key, now);

    if (this.dedupeCache.size > MAX_DEDUPE_ENTRIES) {
      for (const [entryKey, timestamp] of this.dedupeCache) {
        if (now - timestamp > windowMs) {
          this.dedupeCache.delete(entryKey);
        }
        if (this.dedupeCache.size <= MAX_DEDUPE_ENTRIES) {
          break;
        }
      }
    }

    return false;
  }
}

export const toolGuardrails = new ToolGuardrails();
