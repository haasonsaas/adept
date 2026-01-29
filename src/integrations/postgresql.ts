import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class PostgreSQLIntegration extends BaseIntegration {
  id = 'postgresql';
  name = 'PostgreSQL';
  description = 'Direct access to PostgreSQL databases';
  icon = '🐘';

  isEnabled(): boolean {
    return !!(process.env.POSTGRESQL_CONNECTION_STRING || process.env.POSTGRESQL_HOST);
  }

  getTools() {
    return {
      query: tool({
        description: 'Execute a SQL query against PostgreSQL. Use for data retrieval and analysis.',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to execute (SELECT only for safety)'),
          params: z.array(z.unknown()).optional().describe('Query parameters for prepared statements'),
          maxResults: z.number().int().min(1).max(10000).optional().describe('Max rows (default: 1000)'),
        }),
        execute: async (_params: {
          sql: string;
          params?: unknown[];
          maxResults?: number;
        }) => {
          return createToolError(this.id, 'PostgreSQL integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set POSTGRESQL_CONNECTION_STRING or POSTGRESQL_HOST/USER/PASSWORD/DATABASE',
          });
        },
      }),

      list_schemas: tool({
        description: 'List all schemas in the database',
        inputSchema: z.object({}),
        execute: async () => {
          return createToolError(this.id, 'PostgreSQL integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_tables: tool({
        description: 'List tables in a schema',
        inputSchema: z.object({
          schema: z.string().optional().describe('Schema name (default: public)'),
        }),
        execute: async (_params: { schema?: string }) => {
          return createToolError(this.id, 'PostgreSQL integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_table_schema: tool({
        description: 'Get the schema/columns of a table',
        inputSchema: z.object({
          table: z.string().describe('Table name'),
          schema: z.string().optional().describe('Schema name (default: public)'),
        }),
        execute: async (_params: { table: string; schema?: string }) => {
          return createToolError(this.id, 'PostgreSQL integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      preview_table: tool({
        description: 'Preview sample rows from a table',
        inputSchema: z.object({
          table: z.string().describe('Table name'),
          schema: z.string().optional().describe('Schema name (default: public)'),
          limit: z.number().int().min(1).max(100).optional().describe('Number of rows (default: 10)'),
        }),
        execute: async (_params: {
          table: string;
          schema?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'PostgreSQL integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      explain_query: tool({
        description: 'Get the execution plan for a query',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to analyze'),
          analyze: z.boolean().optional().describe('Run EXPLAIN ANALYZE (actually executes query)'),
        }),
        execute: async (_params: { sql: string; analyze?: boolean }) => {
          return createToolError(this.id, 'PostgreSQL integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
