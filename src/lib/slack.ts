import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';

let app: App;
let webClient: WebClient;

export function initSlack(): App {
  app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

  return app;
}

export function getWebClient(): WebClient {
  if (!webClient) {
    webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return webClient;
}

export async function getBotUserId(): Promise<string> {
  const client = getWebClient();
  const { user_id } = await client.auth.test();
  if (!user_id) {
    throw new Error('Could not get bot user ID');
  }
  return user_id;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export async function getThreadMessages(
  channelId: string,
  threadTs: string,
  botUserId: string,
): Promise<Message[]> {
  const client = getWebClient();
  const { messages } = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 50,
  });

  if (!messages) {
    return [];
  }

  return messages
    .filter((msg) => msg.text)
    .map((msg) => {
      const isBot = !!msg.bot_id;
      let content = msg.text || '';

      // Remove bot mention from user messages
      if (!isBot && content.includes(`<@${botUserId}>`)) {
        content = content.replace(new RegExp(`<@${botUserId}>\\s*`, 'g'), '').trim();
      }

      return {
        role: isBot ? 'assistant' : 'user',
        content,
      } as Message;
    });
}

export async function postMessage(
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<string | undefined> {
  const client = getWebClient();
  const result = await client.chat.postMessage({
    channel: channelId,
    text,
    thread_ts: threadTs,
    unfurl_links: false,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
    ],
  });
  return result.ts;
}

export async function updateMessage(channelId: string, ts: string, text: string): Promise<void> {
  const client = getWebClient();
  await client.chat.update({
    channel: channelId,
    ts,
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
    ],
  });
}

export async function setAssistantStatus(channelId: string, threadTs: string, status: string): Promise<void> {
  const client = getWebClient();
  try {
    await client.assistant.threads.setStatus({
      channel_id: channelId,
      thread_ts: threadTs,
      status,
    });
  } catch {
    // Assistant API might not be available in all contexts
  }
}

export async function setSuggestedPrompts(
  channelId: string,
  threadTs: string,
  prompts: Array<{ title: string; message: string }>,
): Promise<void> {
  const client = getWebClient();
  try {
    await client.assistant.threads.setSuggestedPrompts({
      channel_id: channelId,
      thread_ts: threadTs,
      prompts,
    });
  } catch {
    // Assistant API might not be available
  }
}
