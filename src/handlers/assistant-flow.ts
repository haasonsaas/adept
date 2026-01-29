import type { KnownBlock } from '@slack/web-api';
import { generateResponse, generateResponseWithHistory } from '../lib/agent.js';
import { handleCommand } from '../lib/commands.js';

type ConversationMessage = { role: 'user' | 'assistant'; content: string };

export const DEFAULT_ERROR_MESSAGE = '_Sorry, I encountered an error processing your request._';

export interface AssistantFlowOptions {
  text: string;
  threadTs?: string;
  getThreadMessages?: () => Promise<ConversationMessage[]>;
  onStatusUpdate?: (status: string) => Promise<void>;
  setInitialStatus?: boolean;
  sendResponse: (text: string, blocks?: KnownBlock[]) => Promise<void>;
  errorMessage: string;
  onError?: (error: unknown) => void;
  onFinally?: () => Promise<void>;
}

export const runAssistantFlow = async (options: AssistantFlowOptions): Promise<void> => {
  const {
    text,
    threadTs,
    getThreadMessages,
    onStatusUpdate,
    setInitialStatus,
    sendResponse,
    errorMessage,
    onError,
    onFinally,
  } = options;

  try {
    if (setInitialStatus) {
      await onStatusUpdate?.('is thinking...');
    }

    const commandResponse = text ? await handleCommand(text) : null;
    if (commandResponse) {
      await sendResponse(commandResponse.text, commandResponse.blocks);
      return;
    }

    const response =
      threadTs && getThreadMessages
        ? await generateResponseWithHistory(await getThreadMessages(), onStatusUpdate)
        : await generateResponse(text, onStatusUpdate);

    await sendResponse(response);
  } catch (error) {
    onError?.(error);
    await sendResponse(errorMessage);
  } finally {
    await onFinally?.();
  }
};
