import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class NotionIntegration extends BaseIntegration {
  id = 'notion';
  name = 'Notion';
  description = 'Access Notion - docs, databases, and wikis';
  icon = '📝';

  isEnabled(): boolean {
    return !!process.env.NOTION_API_KEY;
  }

  getTools() {
    return {
      search: tool({
        description: 'Search across all Notion pages and databases',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          filter: z.enum(['page', 'database', 'all']).optional().describe('Filter by type'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query: string; filter?: string; limit?: number }) => {
          return createToolError(this.id, 'Notion integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set NOTION_API_KEY and implement the API calls',
          });
        },
      }),

      get_page: tool({
        description: 'Get the content of a Notion page',
        inputSchema: z.object({
          pageId: z.string().describe('Notion page ID or URL'),
        }),
        execute: async (_params: { pageId: string }) => {
          return createToolError(this.id, 'Notion integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      query_database: tool({
        description: 'Query a Notion database with filters and sorts',
        inputSchema: z.object({
          databaseId: z.string().describe('Notion database ID'),
          filter: z.record(z.unknown()).optional().describe('Filter conditions'),
          sorts: z.array(z.object({
            property: z.string(),
            direction: z.enum(['ascending', 'descending']),
          })).optional().describe('Sort order'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          databaseId: string;
          filter?: Record<string, unknown>;
          sorts?: Array<{ property: string; direction: 'ascending' | 'descending' }>;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Notion integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      create_page: tool({
        description: 'Create a new page in Notion',
        inputSchema: z.object({
          parentId: z.string().describe('Parent page or database ID'),
          title: z.string().describe('Page title'),
          content: z.string().optional().describe('Page content in markdown'),
          properties: z.record(z.unknown()).optional().describe('Database properties if creating in a database'),
        }),
        execute: async (_params: {
          parentId: string;
          title: string;
          content?: string;
          properties?: Record<string, unknown>;
        }) => {
          return createToolError(this.id, 'Notion integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      update_page: tool({
        description: 'Update an existing Notion page',
        inputSchema: z.object({
          pageId: z.string().describe('Notion page ID'),
          properties: z.record(z.unknown()).optional().describe('Properties to update'),
          content: z.string().optional().describe('New content to append'),
        }),
        execute: async (_params: {
          pageId: string;
          properties?: Record<string, unknown>;
          content?: string;
        }) => {
          return createToolError(this.id, 'Notion integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_databases: tool({
        description: 'List all accessible Notion databases',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { limit?: number }) => {
          return createToolError(this.id, 'Notion integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
