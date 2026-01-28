import { generateResponse, generateResponseWithHistory } from '../lib/agent.js';
import { getThreadMessages, postMessage, updateMessage, getBotUserId } from '../lib/slack.js';
import { handleCommand } from '../lib/commands.js';
import type { AppMentionEvent } from '../types/slack.js';

export async function handleAppMention(event: AppMentionEvent): Promise<void> {
  const { channel, thread_ts, ts, text, bot_id } = event;
  const botUserId = await getBotUserId();

  // Ignore messages from bots
  if (bot_id) {
    return;
  }

  console.log(`[AppMention] Received mention in ${channel}`);

  // Post initial "thinking" message
  const threadTs = thread_ts || ts;
  const thinkingTs = await postMessage(channel, '_is thinking..._', threadTs);

  if (!thinkingTs) {
    console.error('[AppMention] Failed to post thinking message');
    return;
  }

  const updateStatus = async (status: string) => {
    await updateMessage(channel, thinkingTs, `_${status}_`);
  };

  try {
    let response: string;

    const cleanedText = text.replace(new RegExp(`<@${botUserId}>\\s*`, 'g'), '').trim();
    const commandResponse = await handleCommand(cleanedText);
    if (commandResponse) {
      await updateMessage(channel, thinkingTs, commandResponse.text, commandResponse.blocks);
      return;
    }

    if (thread_ts) {
      // Get full thread context
      const messages = await getThreadMessages(channel, thread_ts, botUserId);
      response = await generateResponseWithHistory(messages, updateStatus);
    } else {
      // Single message - remove the mention
      response = await generateResponse(cleanedText, updateStatus);
    }

    await updateMessage(channel, thinkingTs, response);
  } catch (error) {
    console.error('[AppMention] Error generating response:', error);
    await updateMessage(channel, thinkingTs, '_Sorry, I encountered an error processing your request._');
  }
}
