import { tool } from 'ai';
import { Client, isFullPage, isFullDataSource } from '@notionhq/client';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

const getNotionClient = (): Client | null => {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) return null;

  return new Client({ auth: apiKey });
};

interface NotionProperty {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  number?: number;
  select?: { name: string };
  multi_select?: Array<{ name: string }>;
  date?: { start: string; end?: string };
  checkbox?: boolean;
  url?: string;
  email?: string;
  phone_number?: string;
  status?: { name: string };
  people?: Array<{ name?: string; id: string }>;
}

const extractPropertyValue = (prop: NotionProperty): unknown => {
  if (!prop) return null;

  switch (prop.type) {
    case 'title':
      return prop.title?.map((t) => t.plain_text).join('') || null;
    case 'rich_text':
      return prop.rich_text?.map((t) => t.plain_text).join('') || null;
    case 'number':
      return prop.number;
    case 'select':
      return prop.select?.name || null;
    case 'multi_select':
      return prop.multi_select?.map((s) => s.name) || [];
    case 'date':
      return prop.date ? { start: prop.date.start, end: prop.date.end } : null;
    case 'checkbox':
      return prop.checkbox;
    case 'url':
      return prop.url;
    case 'email':
      return prop.email;
    case 'phone_number':
      return prop.phone_number;
    case 'status':
      return prop.status?.name || null;
    case 'people':
      return prop.people?.map((p) => ({ id: p.id, name: p.name })) || [];
    default:
      return null;
  }
};

export class NotionIntegration extends BaseIntegration {
  id = 'notion';
  name = 'Notion';
  description = 'Access Notion for pages, databases, and knowledge management';
  icon = '📝';

  isEnabled(): boolean {
    return !!process.env.NOTION_API_KEY;
  }

  getTools() {
    return {
      search: tool({
        description: 'Search for pages and databases in Notion',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          filter: z.enum(['page', 'database']).optional().describe('Filter by object type'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, filter, limit }: { query: string; filter?: 'page' | 'database'; limit?: number }) => {
          try {
            const client = getNotionClient();
            if (!client) throw new Error('Notion is not configured');

            const searchParams: {
              query: string;
              page_size: number;
              filter?: { property: 'object'; value: 'page' | 'data_source' };
            } = {
              query,
              page_size: limit || 10,
            };

            // Notion API uses 'data_source' for databases in newer versions
            if (filter === 'page') {
              searchParams.filter = { property: 'object', value: 'page' };
            }

            const response = await withRetry(
              () => client.search(searchParams),
              { integrationId: this.id, operation: 'search' },
            );

            const results = response.results.map((item) => {
              if (item.object === 'page' && isFullPage(item)) {
                const titleProp = Object.values(item.properties).find(
                  (p) => (p as NotionProperty).type === 'title',
                ) as NotionProperty | undefined;
                const title = titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';

                return {
                  type: 'page',
                  id: item.id,
                  title,
                  url: item.url,
                  createdTime: item.created_time,
                  lastEditedTime: item.last_edited_time,
                };
              } else if (item.object === 'data_source' && isFullDataSource(item)) {
                const title = item.title?.map((t: { plain_text: string }) => t.plain_text).join('') || 'Untitled';
                return {
                  type: 'database',
                  id: item.id,
                  title,
                  url: item.url,
                  createdTime: item.created_time,
                  lastEditedTime: item.last_edited_time,
                };
              }
              return {
                type: item.object,
                id: item.id,
              };
            });

            return {
              results,
              hasMore: response.has_more,
              nextCursor: response.next_cursor,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_page: tool({
        description: 'Get a page by ID',
        inputSchema: z.object({
          pageId: z.string().describe('Notion page ID'),
        }),
        execute: async ({ pageId }: { pageId: string }) => {
          try {
            const client = getNotionClient();
            if (!client) throw new Error('Notion is not configured');

            const page = await withRetry(
              () => client.pages.retrieve({ page_id: pageId }),
              { integrationId: this.id, operation: 'get page' },
            );

            if (!isFullPage(page)) {
              return { error: 'Partial page returned - may not have full access' };
            }

            const titleProp = Object.values(page.properties).find(
              (p) => (p as NotionProperty).type === 'title',
            ) as NotionProperty | undefined;
            const title = titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';

            // Extract all properties
            const properties: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(page.properties)) {
              properties[key] = extractPropertyValue(value as NotionProperty);
            }

            return {
              id: page.id,
              title,
              url: page.url,
              properties,
              createdTime: page.created_time,
              lastEditedTime: page.last_edited_time,
              archived: page.archived,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_page_content: tool({
        description: 'Get the content blocks of a page',
        inputSchema: z.object({
          pageId: z.string().describe('Notion page ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Max blocks (default: 50)'),
        }),
        execute: async ({ pageId, limit }: { pageId: string; limit?: number }) => {
          try {
            const client = getNotionClient();
            if (!client) throw new Error('Notion is not configured');

            const blocks = await withRetry(
              () => client.blocks.children.list({ block_id: pageId, page_size: limit || 50 }),
              { integrationId: this.id, operation: 'get page content' },
            );

            interface BlockResult {
              type: string;
              id: string;
              paragraph?: { rich_text: Array<{ plain_text: string }> };
              heading_1?: { rich_text: Array<{ plain_text: string }> };
              heading_2?: { rich_text: Array<{ plain_text: string }> };
              heading_3?: { rich_text: Array<{ plain_text: string }> };
              bulleted_list_item?: { rich_text: Array<{ plain_text: string }> };
              numbered_list_item?: { rich_text: Array<{ plain_text: string }> };
              to_do?: { rich_text: Array<{ plain_text: string }>; checked: boolean };
              code?: { rich_text: Array<{ plain_text: string }>; language: string };
              quote?: { rich_text: Array<{ plain_text: string }> };
              callout?: { rich_text: Array<{ plain_text: string }>; icon?: { emoji?: string } };
            }

            const content = blocks.results.map((block) => {
              const b = block as BlockResult;
              const base = { type: b.type, id: b.id };

              switch (b.type) {
                case 'paragraph':
                  return { ...base, text: b.paragraph?.rich_text.map((t) => t.plain_text).join('') };
                case 'heading_1':
                  return { ...base, text: b.heading_1?.rich_text.map((t) => t.plain_text).join('') };
                case 'heading_2':
                  return { ...base, text: b.heading_2?.rich_text.map((t) => t.plain_text).join('') };
                case 'heading_3':
                  return { ...base, text: b.heading_3?.rich_text.map((t) => t.plain_text).join('') };
                case 'bulleted_list_item':
                  return { ...base, text: b.bulleted_list_item?.rich_text.map((t) => t.plain_text).join('') };
                case 'numbered_list_item':
                  return { ...base, text: b.numbered_list_item?.rich_text.map((t) => t.plain_text).join('') };
                case 'to_do':
                  return { ...base, text: b.to_do?.rich_text.map((t) => t.plain_text).join(''), checked: b.to_do?.checked };
                case 'code':
                  return { ...base, text: b.code?.rich_text.map((t) => t.plain_text).join(''), language: b.code?.language };
                case 'quote':
                  return { ...base, text: b.quote?.rich_text.map((t) => t.plain_text).join('') };
                case 'callout':
                  return { ...base, text: b.callout?.rich_text.map((t) => t.plain_text).join(''), icon: b.callout?.icon?.emoji };
                default:
                  return base;
              }
            });

            return {
              pageId,
              blocks: content,
              hasMore: blocks.has_more,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_database: tool({
        description: 'Get a database/data source by ID',
        inputSchema: z.object({
          databaseId: z.string().describe('Notion database/data source ID'),
        }),
        execute: async ({ databaseId }: { databaseId: string }) => {
          try {
            const client = getNotionClient();
            if (!client) throw new Error('Notion is not configured');

            // Use the data sources API for the new Notion API
            const ds = await withRetry(
              () => client.dataSources.retrieve({ data_source_id: databaseId }),
              { integrationId: this.id, operation: 'get database' },
            );

            if (!isFullDataSource(ds)) {
              return { error: 'Partial data source returned - may not have full access' };
            }

            const title = ds.title?.map((t: { plain_text: string }) => t.plain_text).join('') || 'Untitled';

            interface DsProperty {
              type: string;
              name: string;
              select?: { options: Array<{ name: string; color: string }> };
              multi_select?: { options: Array<{ name: string; color: string }> };
              status?: { options: Array<{ name: string; color: string }> };
            }

            const properties: Record<string, { type: string; options?: Array<{ name: string; color: string }> }> = {};
            if (ds.properties) {
              for (const [key, value] of Object.entries(ds.properties)) {
                const prop = value as DsProperty;
                const propInfo: { type: string; options?: Array<{ name: string; color: string }> } = { type: prop.type };

                // Include options for select/multi-select/status
                if (prop.type === 'select' && prop.select?.options) {
                  propInfo.options = prop.select.options.map((o) => ({ name: o.name, color: o.color }));
                } else if (prop.type === 'multi_select' && prop.multi_select?.options) {
                  propInfo.options = prop.multi_select.options.map((o) => ({ name: o.name, color: o.color }));
                } else if (prop.type === 'status' && prop.status?.options) {
                  propInfo.options = prop.status.options.map((o) => ({ name: o.name, color: o.color }));
                }

                properties[key] = propInfo;
              }
            }

            return {
              id: ds.id,
              title,
              url: ds.url,
              properties,
              createdTime: ds.created_time,
              lastEditedTime: ds.last_edited_time,
              inTrash: ds.in_trash,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      query_database: tool({
        description: 'Query a database to get its pages/items',
        inputSchema: z.object({
          databaseId: z.string().describe('Notion database ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 25)'),
        }),
        execute: async ({ databaseId, limit }: { databaseId: string; limit?: number }) => {
          try {
            const client = getNotionClient();
            if (!client) throw new Error('Notion is not configured');

            // Use the dataSources.query API
            const response = await withRetry(
              () => client.dataSources.query({ data_source_id: databaseId, page_size: limit || 25 }),
              { integrationId: this.id, operation: 'query database' },
            );

            const results = response.results.map((page) => {
              if (isFullPage(page)) {
                const titleProp = Object.values(page.properties).find(
                  (p) => (p as NotionProperty).type === 'title',
                ) as NotionProperty | undefined;
                const title = titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';

                const properties: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(page.properties)) {
                  properties[key] = extractPropertyValue(value as NotionProperty);
                }

                return {
                  id: page.id,
                  title,
                  url: page.url,
                  properties,
                  createdTime: page.created_time,
                  lastEditedTime: page.last_edited_time,
                };
              }
              return { id: page.id };
            });

            return {
              databaseId,
              results,
              hasMore: response.has_more,
              nextCursor: response.next_cursor,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_users: tool({
        description: 'List users in the workspace',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 50)'),
        }),
        execute: async ({ limit }: { limit?: number }) => {
          try {
            const client = getNotionClient();
            if (!client) throw new Error('Notion is not configured');

            const response = await withRetry(
              () => client.users.list({ page_size: limit || 50 }),
              { integrationId: this.id, operation: 'list users' },
            );

            interface NotionUser {
              id: string;
              type: string;
              name?: string;
              avatar_url?: string;
              person?: { email?: string };
              bot?: { owner?: { type: string } };
            }

            return {
              users: response.results.map((user) => {
                const u = user as NotionUser;
                return {
                  id: u.id,
                  type: u.type,
                  name: u.name,
                  avatarUrl: u.avatar_url,
                  email: u.type === 'person' ? u.person?.email : undefined,
                };
              }),
              hasMore: response.has_more,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
