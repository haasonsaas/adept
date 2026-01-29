import { randomUUID } from 'node:crypto';
import { generateText, stepCountIs, tool } from 'ai';
import type { ToolExecuteFunction, ToolExecutionOptions, ToolSet } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createToolError, isToolErrorResponse } from './errors.js';
import { toolRegistry } from './tool-registry.js';
import { auditLogger } from './audit-log.js';
import { approvalGates } from './approval-gates.js';
import { outcomeMonitor } from './outcome-monitor.js';
import { rateLimiter } from './rate-limiter.js';
import { toolRecorder } from './tool-recorder.js';
import { logger } from './logger.js';
import {
  buildFallbackHandoff,
  formatExecutionHandoff,
  parseExecutionHandoff,
  type ExecutionHandoff,
} from './execution-handoff.js';
import { handoffMonitor } from './handoff-monitor.js';
import { toolGuardrails } from './tool-guardrails.js';

const buildExecutorInstructions = (options?: {
  toolHints?: string[];
  allowlistSummary?: string | null;
}) => {
  const toolHints = options?.toolHints && options.toolHints.length > 0
    ? `\nTool routing hints:\n- ${options.toolHints.join('\n- ')}`
    : '';
  const allowlist = options?.allowlistSummary
    ? `\nAllowed tools for this workspace:\n${options.allowlistSummary}`
    : '';

  return `You are Wayfinder Executor, an internal execution engine for Wayfinder. You do not talk to the user.

Mission:
- Use tools to gather information and perform actions.
- If multiple systems might contain the answer, search them in parallel.
- If you need a capability, use tool_registry_search to find the right tool.
- Never fabricate tool results, IDs, links, or outcomes.
- If required tools are unavailable, mark the request as blocked and explain what is missing.
- If you make changes or trigger side effects, run relevant verification when feasible and report results.
- If the work is multi-step, include a short Plan (1-3 bullets).
- If requirements are unclear or confirmation is needed before acting, do not call tools. Set Status to planning, include a Plan, and ask for confirmation.

Briefing output (person/company/deal requests):
- In the Data section, prefix each bullet with one of: Profile:, Opportunity:, Activity:, Talking Points:.
- Include source links inline when available. If you cannot find any sources for a section, include "Sources: none" as a Data bullet for that section.

Output:
Return a single execution handoff in the exact format below. Use plain text (no markdown tables).
If a section has nothing, write "none".

EXECUTION_HANDOFF
Status: <done|needs_info|blocked|planning>
Plan:
- <short plan steps or "none">
Actions:
- <action summary with IDs/links>
Data:
- <facts with sources>
Errors:
- <tool errors with hints>
Verification:
- <tests/lints/builds run, or "not run (reason)">
Missing:
- <required info or tools>
Follow-up:
- <single user question or "none">
Draft:
- <optional short response or "none">

Current date: ${new Date().toISOString().split('T')[0]}${toolHints}${allowlist}`;
};

const buildPresenterInstructions = () => `You are Wayfinder, an AI assistant for business operations and execution. You help teams work faster by:
- Answering questions using data from connected business systems
- Executing workflows across multiple tools
- Providing insights without users needing to open separate apps

Operating model:
- Act as a single, unified assistant. Do not mention internal tools or processes.
- Assume the information exists and take action proactively when asked.
- If multiple systems might contain the answer, search them in parallel.
- If you need a capability, use tool_registry_search to find the right tool.
- If required details are missing, ask one focused clarification question.

Response style (Slack):
- Be concise and direct.
- For completed actions, start with "Done." and then the result.
- When a Plan is provided, include a one-line task receipt and the Plan bullets; for completed actions keep "Done." first.
- Include identifiers/links (issue keys, PR numbers, doc links) when available.
- Avoid duplicates: check for existing items before creating new tickets/issues.
- When asked to implement or fix something, create a PR if repository tools are available and include a short "The fix:" bullet list.
- If required tools are unavailable or a tool search yields no results, say so and offer the next best step (e.g., ask to connect an integration or provide manual instructions).
- If verification results exist, summarize them briefly; if verification is missing or failed, call it out and propose the next step.
- Always cite sources when using data from integrations.
- Format responses for Slack (use *bold*, _italic_, bullet points).

Briefing format (person/company/deal questions):
- Use these section headings in order: Profile, Opportunity, Activity, Talking Points.
- Under each section, include concise bullets and a line labeled "Sources:" with links (or "Sources: none").
- Close with a short agenda-offer question.

Errors:
- If a tool response includes an "error" field, explain the issue and include any provided "hint".

Current date: ${new Date().toISOString().split('T')[0]}

When asked about a person, company, or deal:
1. Search across all relevant connected systems.
2. Synthesize information into a comprehensive briefing.
3. Highlight the most relevant details for the user's context.

You have access to tools from connected integrations. Use them proactively to gather context.`;

const buildBaseMessages = (input: GenerationInput) =>
  'prompt' in input
    ? [{ role: 'user' as const, content: input.prompt }]
    : input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

const buildPresenterDirective = (handoff: ExecutionHandoff): string => {
  const followUp = handoff.followUp?.trim();
  const hasFollowUp = Boolean(followUp);
  const draft = handoff.draft?.trim();
  const hasPlan = handoff.plan.length > 0;
  const hasVerification = handoff.verification.length > 0;
  const verificationSummary = handoff.verification.join(' ').toLowerCase();
  const verificationNeedsAttention = /not run|not-run|failed|fail|error|skipped/.test(
    verificationSummary,
  );

  if (handoff.status === 'planning') {
    return [
      'The execution handoff indicates planning is required before acting.',
      'Start with a one-sentence task receipt.',
      hasPlan ? 'List the Plan bullets from the handoff.' : 'Provide a short plan (1-3 bullets).',
      hasFollowUp
        ? `Ask for confirmation or this follow-up question: ${followUp}`
        : 'Ask for confirmation to proceed.',
      'Do not claim completion or say "Done."',
    ].join('\n');
  }

  if (handoff.status === 'needs_info') {
    return [
      'The execution handoff indicates more information is needed.',
      'Start with a one-sentence task receipt.',
      hasPlan
        ? 'Include the Plan bullets from the handoff.'
        : 'Provide a short plan (1-3 bullets) for how you will proceed.',
      hasFollowUp
        ? `Ask this follow-up question exactly: ${followUp}`
        : 'Ask one concise follow-up question to gather the missing detail.',
      'Do not claim completion or say "Done."',
    ].join('\n');
  }

  if (handoff.status === 'blocked') {
    return [
      'The execution handoff is blocked.',
      'Start with a one-sentence task receipt.',
      hasPlan
        ? 'Include the Plan bullets from the handoff.'
        : 'Provide a short plan (1-3 bullets) for how you will proceed once unblocked.',
      'Explain what is missing using the Missing and Errors sections, and offer the next best step.',
      hasFollowUp
        ? `Ask this follow-up question if it will unblock the request: ${followUp}`
        : 'If a question is needed, ask one focused follow-up.',
      'Do not claim completion or say "Done."',
    ].join('\n');
  }

  const verificationDirective = hasVerification
    ? 'Summarize Verification briefly.'
    : 'If Actions include code or system changes and no Verification is listed, note that verification was not run and offer to run checks.';
  const planDirective = hasPlan
    ? 'After "Done.", include a one-line task receipt and a short Plan list from the handoff before the results.'
    : null;

  return [
    'Using the execution handoff above, respond to the user. Do not mention the handoff or internal tools.',
    'If a follow-up question is required, ask it directly.',
    verificationDirective,
    planDirective,
    verificationNeedsAttention ? 'Call out verification issues and offer to resolve them.' : null,
    draft ? `Draft response to build from: ${draft}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildPresenterMessages = (input: GenerationInput, handoff: ExecutionHandoff) => [
  ...buildBaseMessages(input),
  {
    role: 'assistant' as const,
    content: formatExecutionHandoff(handoff),
  },
  {
    role: 'user' as const,
    content: buildPresenterDirective(handoff),
  },
];

const extractLatestUserMessage = (input: GenerationInput): string => {
  if ('prompt' in input) {
    return input.prompt;
  }

  for (let i = input.messages.length - 1; i >= 0; i -= 1) {
    const message = input.messages[i];
    if (message.role === 'user') {
      return message.content;
    }
  }

  return '';
};

const isBriefingRequest = (text: string): boolean => {
  const normalized = text.toLowerCase();
  if (!normalized) return false;

  const intentSignals = [
    'what should i know',
    'tell me about',
    'who is',
    'background on',
    'info on',
    'information on',
    'profile of',
    'brief',
    'briefing',
    'prep',
  ];

  const entitySignals = [
    'from ',
    ' at ',
    'corp',
    'inc',
    'llc',
    'ltd',
    'company',
    'co.',
    'account',
    'opportunity',
    'deal',
    'prospect',
    'customer',
    'lead',
    'contact',
  ];

  const hasIntent = intentSignals.some((signal) => normalized.includes(signal));
  const hasEntity = entitySignals.some((signal) => normalized.includes(signal));
  return hasIntent && hasEntity;
};

const buildExecutorRepairMessages = (input: GenerationInput, previousOutput: string) => [
  ...buildBaseMessages(input),
  {
    role: 'assistant' as const,
    content: previousOutput,
  },
  {
    role: 'user' as const,
    content:
      'Your previous output did not follow the required EXECUTION_HANDOFF format. Reformat it exactly to the required structure. Do not call any tools. If information is missing, write "none" in those sections and set Status to needs_info.',
  },
];

const formatToolNames = (toolNames: string[]): string | null => {
  const unique = Array.from(
    new Set(toolNames.map((toolName) => toolName.replace(/_/g, ' ')).filter(Boolean)),
  );
  if (unique.length === 0) {
    return null;
  }
  return unique.length === 1 ? unique[0] : unique.join(', ');
};

const updateToolStatus = async (
  toolCalls: Array<{ toolName: string }> | undefined,
  toolResults: Array<{ toolName: string; result?: unknown }> | undefined,
  onStatusUpdate?: (status: string) => Promise<void>,
): Promise<void> => {
  if (!onStatusUpdate) {
    return;
  }

  if (toolCalls && toolCalls.length > 0) {
    const toolLabel = formatToolNames(toolCalls.map((toolCall) => toolCall.toolName));
    if (toolLabel) {
      await onStatusUpdate(`Using ${toolLabel}...`);
    }
  }

  if (toolResults && toolResults.length > 0) {
    const errorTools = toolResults
      .filter((toolResult) => {
        const candidate = toolResult as { result?: unknown };
        return isToolErrorResponse(candidate.result);
      })
      .map((toolResult) => toolResult.toolName);

    const errorLabel = formatToolNames(errorTools);
    if (errorLabel) {
      await onStatusUpdate(`Tool error in ${errorLabel}.`);
    }
  }
};

const formatSlackText = (text: string) =>
  text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');

type GenerationInput =
  | { prompt: string }
  | { messages: Array<{ role: 'user' | 'assistant'; content: string }> };

export interface AgentContext {
  userId?: string;
  teamId?: string;
  workspaceId?: string;
  channelId?: string;
  threadTs?: string;
}

const generateTextResponse = async (
  input: GenerationInput,
  onStatusUpdate?: (status: string) => Promise<void>,
  context?: AgentContext,
): Promise<string> => {
  const config = loadConfig();
  const executorModel = getExecutorModel();
  const presenterModel = getPresenterModel();
  const requestId = randomUUID();
  const tools = getAllTools(requestId);
  const workspaceId = context?.workspaceId ?? context?.teamId;
  const toolHints = toolGuardrails.getToolHints(workspaceId);
  const allowlistSummary = toolGuardrails.getAllowlistSummary(workspaceId);

  await onStatusUpdate?.('is thinking...');

  const request =
    'prompt' in input
      ? { prompt: input.prompt }
      : { messages: input.messages };

  logger.info({ requestId }, '[Agent] Request started');

  const executorInstructions = buildExecutorInstructions({
    toolHints,
    allowlistSummary,
  });

  const executorResponse = await generateText({
    model: executorModel,
    system: executorInstructions,
    ...request,
    tools,
    stopWhen: stepCountIs(config.maxToolSteps),
    experimental_context: context,
    onStepFinish: async ({ toolCalls, toolResults }) => {
      await updateToolStatus(toolCalls, toolResults, onStatusUpdate);
    },
  });

  let parseResult = parseExecutionHandoff(executorResponse.text);
  let handoff = parseResult.handoff;
  let usedRepair = false;

  if (!parseResult.ok) {
    logger.warn({ requestId, errors: parseResult.errors }, '[Agent] Invalid execution handoff, attempting repair');
    const repairResponse = await generateText({
      model: executorModel,
      system: executorInstructions,
      messages: buildExecutorRepairMessages(input, executorResponse.text),
      experimental_context: context,
    });
    const repaired = parseExecutionHandoff(repairResponse.text);
    usedRepair = true;

    if (repaired.ok) {
      parseResult = repaired;
      handoff = repaired.handoff;
    } else {
      parseResult = {
        ok: false,
        errors: [...parseResult.errors, ...repaired.errors],
        missingFields: Array.from(new Set([...parseResult.missingFields, ...repaired.missingFields])),
        handoff: repaired.handoff,
      };
      handoff = buildFallbackHandoff('Execution handoff could not be parsed.');
    }
  }

  const finalHandoff = handoff ?? buildFallbackHandoff('Execution handoff missing.');

  await handoffMonitor.record({
    parsed: parseResult.ok,
    missingFields: parseResult.missingFields,
    status: finalHandoff.status,
    blockedReasons: finalHandoff.status === 'blocked' ? finalHandoff.missing : undefined,
  });

  if (usedRepair) {
    logger.info({ requestId }, '[Agent] Executor handoff repaired');
  }

  const needsBriefing = isBriefingRequest(extractLatestUserMessage(input));
  const presenterMessages = needsBriefing && finalHandoff.status === 'done'
    ? [
        ...buildPresenterMessages(input, finalHandoff),
        {
          role: 'user' as const,
          content:
            'Format this as a briefing using the required sections and include section-level sources. Ignore any plan/receipt formatting. End with a short question offering to draft a call agenda.',
        },
      ]
    : buildPresenterMessages(input, finalHandoff);

  const presenterResponse = await generateText({
    model: presenterModel,
    system: buildPresenterInstructions(),
    messages: presenterMessages,
    experimental_context: context,
  });

  logger.info({ requestId }, '[Agent] Request completed');

  return formatSlackText(presenterResponse.text);
};

const DEFAULT_MODELS = {
  openai: {
    executor: 'gpt-4.1-mini',
    presenter: 'gpt-4.1',
  },
  anthropic: {
    executor: 'claude-3-5-haiku-20241022',
    presenter: 'claude-opus-4-5',
  },
} as const;

const resolveModel = (provider: 'openai' | 'anthropic', modelName: string) =>
  provider === 'openai' ? openai(modelName) : anthropic(modelName);

const getExecutorModel = () => {
  const config = loadConfig();
  const hasAnthropic = !!config.anthropicApiKey;
  const hasOpenAI = !!config.openaiApiKey;

  if (config.defaultProvider === 'openai') {
    if (hasOpenAI) {
      return resolveModel('openai', config.executorModel ?? DEFAULT_MODELS.openai.executor);
    }
    if (hasAnthropic) {
      logger.warn(
        '[Wayfinder] DEFAULT_AI_PROVIDER=openai but OPENAI_API_KEY is missing. Falling back to Anthropic for executor.',
      );
      return resolveModel('anthropic', DEFAULT_MODELS.anthropic.executor);
    }
  }

  if (config.defaultProvider === 'anthropic') {
    if (hasAnthropic) {
      return resolveModel('anthropic', config.executorModel ?? DEFAULT_MODELS.anthropic.executor);
    }
    if (hasOpenAI) {
      logger.warn(
        '[Wayfinder] DEFAULT_AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing. Falling back to OpenAI for executor.',
      );
      return resolveModel('openai', DEFAULT_MODELS.openai.executor);
    }
  }

  throw new Error('No AI provider configured');
};

const getPresenterModel = () => {
  const config = loadConfig();
  const hasAnthropic = !!config.anthropicApiKey;
  const hasOpenAI = !!config.openaiApiKey;

  if (config.defaultProvider === 'openai') {
    if (hasOpenAI) {
      return resolveModel('openai', config.presenterModel ?? DEFAULT_MODELS.openai.presenter);
    }
    if (hasAnthropic) {
      logger.warn(
        '[Wayfinder] DEFAULT_AI_PROVIDER=openai but OPENAI_API_KEY is missing. Falling back to Anthropic for presenter.',
      );
      return resolveModel('anthropic', DEFAULT_MODELS.anthropic.presenter);
    }
  }

  if (config.defaultProvider === 'anthropic') {
    if (hasAnthropic) {
      return resolveModel('anthropic', config.presenterModel ?? DEFAULT_MODELS.anthropic.presenter);
    }
    if (hasOpenAI) {
      logger.warn(
        '[Wayfinder] DEFAULT_AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing. Falling back to OpenAI for presenter.',
      );
      return resolveModel('openai', DEFAULT_MODELS.openai.presenter);
    }
  }

  throw new Error('No AI provider configured');
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return { value };
};

const extractInputFields = (schema?: z.ZodSchema): string[] => {
  if (!schema) return [];
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  return [];
};

const resolveContext = (options: ToolExecutionOptions): AgentContext => {
  const ctx = options.experimental_context as AgentContext | undefined;
  return ctx ?? {};
};

const wrapToolExecution = (
  toolName: string,
  toolDef: ToolSet[string],
  requestId: string,
  integrationId: string,
): ToolSet[string] => {
  const execute = toolDef.execute as ToolExecuteFunction<unknown, unknown> | undefined;
  if (typeof execute !== 'function') {
    return toolDef;
  }

  return {
    ...toolDef,
    execute: async (input: unknown, context: ToolExecutionOptions) => {
      const start = Date.now();
      const execContext = resolveContext(context);
      const userId = execContext.userId ?? 'system';
      const workspaceId = execContext.workspaceId ?? execContext.teamId;
      const sessionId = execContext.threadTs;
      const inputs = toRecord(input);

      const allowlistCheck = toolGuardrails.isToolAllowed({
        workspaceId,
        toolName,
        integrationId,
      });
      if (!allowlistCheck.allowed) {
        return createToolError(integrationId, 'Tool not allowed for this workspace.', {
          hint: allowlistCheck.reason ?? 'This tool is not permitted in the current workspace.',
        });
      }

      const allowDuplicate = Boolean(
        (inputs as Record<string, unknown>).force || (inputs as Record<string, unknown>).allowDuplicate,
      );
      if (!allowDuplicate && toolGuardrails.shouldDedupe(toolName)) {
        const duplicate = toolGuardrails.isDuplicate({
          workspaceId,
          toolName,
          input: inputs,
        });
        if (duplicate) {
          return createToolError(integrationId, 'Duplicate action detected.', {
            hint: 'A similar create action was recently executed. If this is intentional, retry with force=true or adjust the request details.',
          });
        }
      }

      const rateCheck = await rateLimiter.check(toolName, userId);
      if (!rateCheck.allowed) {
        await auditLogger.logToolResult(
          userId,
          toolName,
          integrationId,
          { error: rateCheck.reason || 'Rate limit exceeded' },
          Date.now() - start,
          false,
          rateCheck.reason,
          sessionId,
          workspaceId,
        );

        return createToolError(integrationId, rateCheck.reason || 'Rate limit exceeded', {
          retryAfterSeconds: rateCheck.retryAfter,
          hint: 'Slow down and try again after the cooldown window.',
        });
      }

      if (approvalGates.requiresApproval(toolName, integrationId, inputs)) {
        const gate = await approvalGates.requestApproval(
          'tool_call',
          toolName,
          integrationId,
          inputs,
          userId,
          { workspaceId, sessionId },
        );

        return createToolError(integrationId, 'Approval required for this action.', {
          hint: `Approval gate ${gate.id.slice(0, 8)} pending. Use "approvals" to review.`,
        });
      }

      await auditLogger.logToolCall(
        userId,
        toolName,
        integrationId,
        inputs,
        sessionId,
        workspaceId,
      );

      toolRecorder.recordToolCall(
        { userId, channelId: execContext.channelId, threadTs: sessionId },
        toolName,
        integrationId,
        inputs,
      );

      try {
        const result = await execute(input, context);
        const duration = Date.now() - start;
        const isError = isToolErrorResponse(result);
        const errorPayload = isError
          ? {
              type: (result as { errorType?: string }).errorType,
              message: (result as { error?: string }).error,
            }
          : undefined;

        await Promise.all([
          toolRegistry.recordUsage(toolName),
          rateLimiter.record(toolName, userId),
          outcomeMonitor.recordOutcome(toolName, integrationId, !isError, duration, errorPayload),
          auditLogger.logToolResult(
            userId,
            toolName,
            integrationId,
            toRecord(result),
            duration,
            !isError,
            isError ? (result as { error?: string }).error : undefined,
            sessionId,
            workspaceId,
          ),
        ]);

        logger.info(
          { requestId, toolName, integrationId, durationMs: duration },
          '[Agent] Tool execution',
        );
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        const message = error instanceof Error ? error.message : String(error);

        await Promise.all([
          toolRegistry.recordUsage(toolName),
          rateLimiter.record(toolName, userId),
          outcomeMonitor.recordOutcome(toolName, integrationId, false, duration, {
            type: error instanceof Error ? error.name : 'error',
            message,
          }),
          auditLogger.logToolResult(
            userId,
            toolName,
            integrationId,
            { error: message },
            duration,
            false,
            message,
            sessionId,
            workspaceId,
          ),
        ]);

        logger.error(
          { requestId, toolName, integrationId, durationMs: duration, error },
          '[Agent] Tool execution failed',
        );
        throw error;
      }
    },
  };
};

function getAllTools(requestId: string): ToolSet {
  const allTools: ToolSet = {};

  const hotTools = toolRegistry.getHotTools();
  for (const [qualifiedName, toolDef] of Object.entries(hotTools)) {
    const metadata = toolRegistry.getToolMetadata(qualifiedName);
    const integrationId = metadata?.integrationId || qualifiedName.split('_')[0];
    allTools[qualifiedName] = wrapToolExecution(
      qualifiedName,
      toolDef,
      requestId,
      integrationId,
    );
  }

  allTools['tool_registry_search'] = wrapToolExecution(
    'tool_registry_search',
    tool({
      description: 'Search available tools in the registry by name or description',
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query'),
        limit: z.number().int().min(1).max(50).optional().describe('Maximum results'),
      }),
      execute: async ({ query, limit }: { query: string; limit?: number }) => {
        const results = toolRegistry.searchTools(query, limit || 10);
        return results.map((result) => {
          const metadata = toolRegistry.getToolMetadata(result.qualifiedName);
          return {
            ...result,
            inputFields: extractInputFields(metadata?.inputSchema),
          };
        });
      },
    }),
    requestId,
    'tool_registry',
  );

  allTools['tool_registry_execute'] = wrapToolExecution(
    'tool_registry_execute',
    tool({
      description: 'Execute a registered tool by name using deferred loading',
      inputSchema: z.object({
        toolName: z.string().min(1).describe('Qualified tool name to execute'),
        input: z.record(z.unknown()).optional().describe('Tool input payload'),
      }),
      execute: async (
        { toolName, input }: { toolName: string; input?: Record<string, unknown> },
        context: ToolExecutionOptions,
      ) => {
        if (toolName === 'tool_registry_execute' || toolName === 'tool_registry_search') {
          return createToolError('tool_registry', 'Cannot execute registry tools via registry execution.');
        }

        const toolDef = toolRegistry.getTool(toolName);
        if (!toolDef) {
          return createToolError('tool_registry', `Tool "${toolName}" not found`, {
            hint: 'Use tool_registry_search to discover available tools.',
          });
        }

        const metadata = toolRegistry.getToolMetadata(toolName);
        const integrationId = metadata?.integrationId || toolName.split('_')[0];
        const wrappedTool = wrapToolExecution(toolName, toolDef, requestId, integrationId);
        const execute = wrappedTool.execute as ToolExecuteFunction<unknown, unknown> | undefined;

        if (!execute) {
          return createToolError('tool_registry', `Tool "${toolName}" is not executable.`);
        }

        return await execute(input ?? {}, context);
      },
    }),
    requestId,
    'tool_registry',
  );

  // Built-in utility tools
  allTools['get_current_time'] = wrapToolExecution(
    'get_current_time',
    tool({
      description: 'Get the current date and time',
      inputSchema: z.object({
        timezone: z.string().optional().describe('Timezone like "America/New_York"'),
      }),
      execute: async ({ timezone }: { timezone?: string }) => {
        const now = new Date();
        const options: Intl.DateTimeFormatOptions = {
          dateStyle: 'full',
          timeStyle: 'long',
          timeZone: timezone || 'UTC',
        };
        return { datetime: now.toLocaleString('en-US', options) };
      },
    }),
    requestId,
    'core',
  );

  return allTools;
}

export async function generateResponse(
  prompt: string,
  onStatusUpdate?: (status: string) => Promise<void>,
  context?: AgentContext,
): Promise<string> {
  return await generateTextResponse({ prompt }, onStatusUpdate, context);
}

export async function generateResponseWithHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onStatusUpdate?: (status: string) => Promise<void>,
  context?: AgentContext,
): Promise<string> {
  return await generateTextResponse(
    {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    },
    onStatusUpdate,
    context,
  );
}
