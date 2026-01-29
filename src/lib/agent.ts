import { randomUUID } from 'node:crypto';
import { generateText, stepCountIs, tool } from 'ai';
import type { ToolExecuteFunction, ToolExecutionOptions, ToolSet } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { integrationRegistry } from '../integrations/registry.js';
import { isToolErrorResponse } from './errors.js';
import { logger } from './logger.js';

const buildSystemInstructions = () => `You are Adept, an AI assistant for business operations. You help teams work faster by:
- Answering questions using data from connected business systems
- Executing workflows across multiple tools  
- Providing insights without users needing to open separate apps

Guidelines:
- Be concise and direct in your responses
- Always cite your sources when using data from integrations
- If you need to search multiple systems, do so efficiently
- Format responses for Slack (use *bold*, _italic_, bullet points)
- If a tool response includes an "error" field, explain the issue and include any provided "hint" to help the user resolve it
- Current date: ${new Date().toISOString().split('T')[0]}

When asked about a person, company, or deal:
1. Search across all relevant connected systems
2. Synthesize information into a comprehensive briefing
3. Highlight the most relevant details for the user's context

You have access to tools from connected integrations. Use them proactively to gather context.`;

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

const generateTextResponse = async (
  input: GenerationInput,
  onStatusUpdate?: (status: string) => Promise<void>,
): Promise<string> => {
  const config = loadConfig();
  const model = getModel();
  const requestId = randomUUID();
  const tools = getAllTools(requestId);

  await onStatusUpdate?.('is thinking...');

  const request =
    'prompt' in input
      ? { prompt: input.prompt }
      : { messages: input.messages };

  logger.info({ requestId }, '[Agent] Request started');

  const { text } = await generateText({
    model,
    system: buildSystemInstructions(),
    ...request,
    tools,
    stopWhen: stepCountIs(config.maxToolSteps),
    onStepFinish: async ({ toolCalls, toolResults }) => {
      await updateToolStatus(toolCalls, toolResults, onStatusUpdate);
    },
  });

  logger.info({ requestId }, '[Agent] Request completed');

  return formatSlackText(text);
};

function getModel() {
  const config = loadConfig();
  const hasAnthropic = !!config.anthropicApiKey;
  const hasOpenAI = !!config.openaiApiKey;

  if (config.defaultProvider === 'anthropic') {
    if (hasAnthropic) {
      return anthropic('claude-opus-4-5');
    }
    if (hasOpenAI) {
      logger.warn(
        '[Adept] DEFAULT_AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing. Falling back to OpenAI.',
      );
      return openai('gpt-4.1');
    }
  }

  if (config.defaultProvider === 'openai') {
    if (hasOpenAI) {
      return openai('gpt-4.1');
    }
    if (hasAnthropic) {
      logger.warn(
        '[Adept] DEFAULT_AI_PROVIDER=openai but OPENAI_API_KEY is missing. Falling back to Anthropic.',
      );
      return anthropic('claude-opus-4-5');
    }
  }

  throw new Error('No AI provider configured');
}

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
      try {
        const result = await execute(input, context);
        logger.info({ requestId, toolName, integrationId, durationMs: Date.now() - start }, '[Agent] Tool execution');
        return result;
      } catch (error) {
        logger.error(
          { requestId, toolName, integrationId, durationMs: Date.now() - start, error },
          '[Agent] Tool execution failed',
        );
        throw error;
      }
    },
  };
};

function getAllTools(requestId: string): ToolSet {
  const allTools: ToolSet = {};

  for (const integration of integrationRegistry.getEnabled()) {
    const integrationTools = integration.getTools();

    for (const [toolName, toolDef] of Object.entries(integrationTools)) {
      const qualifiedName = `${integration.id}_${toolName}`;
      allTools[qualifiedName] = wrapToolExecution(
        qualifiedName,
        toolDef,
        requestId,
        integration.id,
      );
    }
  }

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
): Promise<string> {
  return await generateTextResponse({ prompt }, onStatusUpdate);
}

export async function generateResponseWithHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onStatusUpdate?: (status: string) => Promise<void>,
): Promise<string> {
  return await generateTextResponse(
    {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    },
    onStatusUpdate,
  );
}
