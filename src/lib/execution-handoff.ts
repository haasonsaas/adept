import { z } from 'zod';

export const ExecutionHandoffSchema = z.object({
  status: z.enum(['done', 'needs_info', 'blocked']),
  actions: z.array(z.string()),
  data: z.array(z.string()),
  errors: z.array(z.string()),
  missing: z.array(z.string()),
  followUp: z.string().nullable(),
  draft: z.string().nullable(),
  raw: z.string(),
});

export type ExecutionHandoff = z.infer<typeof ExecutionHandoffSchema>;

type SectionKey = 'actions' | 'data' | 'errors' | 'missing' | 'followUp' | 'draft';

const SECTION_KEYS: Record<string, SectionKey> = {
  actions: 'actions',
  data: 'data',
  errors: 'errors',
  missing: 'missing',
  'follow-up': 'followUp',
  'follow up': 'followUp',
  followup: 'followUp',
  draft: 'draft',
};

const REQUIRED_SECTIONS: SectionKey[] = [
  'actions',
  'data',
  'errors',
  'missing',
  'followUp',
  'draft',
];

export interface ExecutionHandoffParseResult {
  ok: boolean;
  handoff?: ExecutionHandoff;
  errors: string[];
  missingFields: string[];
}

const normalizeSectionLabel = (label: string): string => label.trim().toLowerCase();

const stripBullet = (line: string): string => line.replace(/^[-*•]\s*/, '').trim();

const isNone = (value: string): boolean => value.trim().toLowerCase() === 'none';

const appendItem = (
  section: SectionKey,
  item: string,
  accumulators: {
    actions: string[];
    data: string[];
    errors: string[];
    missing: string[];
    followUp: string | null;
    draft: string | null;
  },
): void => {
  if (!item) return;
  if (isNone(item)) return;

  if (section === 'followUp') {
    accumulators.followUp = accumulators.followUp
      ? `${accumulators.followUp}\n${item}`
      : item;
    return;
  }

  if (section === 'draft') {
    accumulators.draft = accumulators.draft ? `${accumulators.draft}\n${item}` : item;
    return;
  }

  accumulators[section].push(item);
};

export const parseExecutionHandoff = (raw: string): ExecutionHandoffParseResult => {
  const errors: string[] = [];
  const missingFields: string[] = [];
  const lines = raw.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^EXECUTION[_ ]HANDOFF/i.test(line.trim()));

  if (startIndex === -1) {
    errors.push('Missing EXECUTION_HANDOFF header.');
    missingFields.push('header');
    return { ok: false, errors, missingFields };
  }

  let status: ExecutionHandoff['status'] | null = null;
  let currentSection: SectionKey | null = null;
  const sectionsSeen = new Set<SectionKey>();

  const accumulators = {
    actions: [] as string[],
    data: [] as string[],
    errors: [] as string[],
    missing: [] as string[],
    followUp: null as string | null,
    draft: null as string | null,
  };

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const statusMatch = line.match(/^Status:\s*(.+)$/i);
    if (statusMatch) {
      const candidate = statusMatch[1].trim().toLowerCase();
      if (candidate === 'done' || candidate === 'needs_info' || candidate === 'blocked') {
        status = candidate as ExecutionHandoff['status'];
      } else {
        errors.push(`Invalid status "${statusMatch[1].trim()}".`);
      }
      currentSection = null;
      continue;
    }

    const sectionMatch = line.match(/^([A-Za-z\- ]+):\s*(.*)$/);
    if (sectionMatch) {
      const label = normalizeSectionLabel(sectionMatch[1]);
      const section = SECTION_KEYS[label];
      if (section) {
        currentSection = section;
        sectionsSeen.add(section);
        const inline = sectionMatch[2].trim();
        if (inline) {
          appendItem(section, inline, accumulators);
        }
        continue;
      }
    }

    if (!currentSection) {
      continue;
    }

    const item = stripBullet(line);
    if (!item) continue;
    appendItem(currentSection, item, accumulators);
  }

  if (!status) {
    missingFields.push('status');
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!sectionsSeen.has(section)) {
      missingFields.push(section);
    }
  }

  const handoff: ExecutionHandoff = {
    status: status ?? 'blocked',
    actions: accumulators.actions,
    data: accumulators.data,
    errors: accumulators.errors,
    missing: accumulators.missing,
    followUp: accumulators.followUp,
    draft: accumulators.draft,
    raw,
  };

  const validation = ExecutionHandoffSchema.safeParse(handoff);
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      errors.push(issue.message);
    }
  }

  const ok = errors.length === 0 && missingFields.length === 0;
  return {
    ok,
    handoff,
    errors,
    missingFields,
  };
};

const formatList = (items: string[]): string =>
  items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- none';

const formatOptional = (value: string | null): string => (value ? `- ${value}` : '- none');

export const formatExecutionHandoff = (handoff: ExecutionHandoff): string =>
  [
    'EXECUTION_HANDOFF',
    `Status: ${handoff.status}`,
    'Actions:',
    formatList(handoff.actions),
    'Data:',
    formatList(handoff.data),
    'Errors:',
    formatList(handoff.errors),
    'Missing:',
    formatList(handoff.missing),
    'Follow-up:',
    formatOptional(handoff.followUp),
    'Draft:',
    formatOptional(handoff.draft),
  ].join('\n');

export const buildFallbackHandoff = (reason: string, followUp?: string): ExecutionHandoff => ({
  status: 'blocked',
  actions: [],
  data: [],
  errors: [reason],
  missing: ['executor_handoff_format'],
  followUp: followUp ?? 'Could you restate the request or provide more detail?',
  draft: null,
  raw: '',
});
