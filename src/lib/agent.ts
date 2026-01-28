import { generateText, stepCountIs, tool } from 'ai';
import type { ToolSet } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { integrationRegistry } from '../integrations/registry.js';
import { isToolErrorResponse } from './errors.js';

const SYSTEM_INSTRUCTIONS = `You are Adept, an AI assistant for business operations. You help teams work faster by:
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

function getModel() {
  const config = loadConfig();

  if (config.defaultProvider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return anthropic('claude-opus-4-5');
  }

  if (process.env.OPENAI_API_KEY) {
    return openai('gpt-4.1');
  }

  throw new Error('No AI provider configured');
}

function getAllTools(): ToolSet {
  const allTools: ToolSet = {};

  for (const integration of integrationRegistry.getEnabled()) {
    const integrationTools = integration.getTools();

    for (const [toolName, toolDef] of Object.entries(integrationTools)) {
      allTools[`${integration.id}_${toolName}`] = toolDef;
    }
  }

  // Built-in utility tools
  allTools['get_current_time'] = tool({
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
  });

  return allTools;
}

export async function generateResponse(
  prompt: string,
  onStatusUpdate?: (status: string) => Promise<void>,
): Promise<string> {
  const config = loadConfig();
  const model = getModel();
  const tools = getAllTools();

  await onStatusUpdate?.('is thinking...');

  const { text } = await generateText({
    model,
    system: SYSTEM_INSTRUCTIONS,
    prompt,
    tools,
    stopWhen: stepCountIs(config.maxToolSteps),
    onStepFinish: async ({ toolCalls, toolResults }) => {
      if (toolCalls && toolCalls.length > 0 && onStatusUpdate) {
        const toolName = toolCalls[0].toolName.replace(/_/g, ' ');
        await onStatusUpdate(`Using ${toolName}...`);
      }

      if (toolResults && toolResults.length > 0 && onStatusUpdate) {
        const errorResult = toolResults.find((toolResult) => {
          const candidate = toolResult as { result?: unknown };
          return isToolErrorResponse(candidate.result);
        });
        if (errorResult) {
          const toolName = (errorResult as { toolName: string }).toolName.replace(/_/g, ' ');
          await onStatusUpdate(`Tool error in ${toolName}.`);
        }
      }
    },
  });

  // Convert markdown links to Slack format
  return text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');
}

export async function generateResponseWithHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onStatusUpdate?: (status: string) => Promise<void>,
): Promise<string> {
  const config = loadConfig();
  const model = getModel();
  const tools = getAllTools();

  await onStatusUpdate?.('is thinking...');

  const { text } = await generateText({
    model,
    system: SYSTEM_INSTRUCTIONS,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    tools,
    stopWhen: stepCountIs(config.maxToolSteps),
    onStepFinish: async ({ toolCalls, toolResults }) => {
      if (toolCalls && toolCalls.length > 0 && onStatusUpdate) {
        const toolName = toolCalls[0].toolName.replace(/_/g, ' ');
        await onStatusUpdate(`Using ${toolName}...`);
      }

      if (toolResults && toolResults.length > 0 && onStatusUpdate) {
        const errorResult = toolResults.find((toolResult) => {
          const candidate = toolResult as { result?: unknown };
          return isToolErrorResponse(candidate.result);
        });
        if (errorResult) {
          const toolName = (errorResult as { toolName: string }).toolName.replace(/_/g, ' ');
          await onStatusUpdate(`Tool error in ${toolName}.`);
        }
      }
    },
  });

  return text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');
}
