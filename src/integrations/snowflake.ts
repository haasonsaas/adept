import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class SnowflakeIntegration extends BaseIntegration {
  id = 'snowflake';
  name = 'Snowflake';
  description = 'Query Snowflake data warehouse with cross-database joins';
  icon = '❄️';

  isEnabled(): boolean {
    return !!(
      process.env.SNOWFLAKE_ACCOUNT &&
      process.env.SNOWFLAKE_USERNAME &&
      (process.env.SNOWFLAKE_PASSWORD || process.env.SNOWFLAKE_PRIVATE_KEY)
    );
  }

  getTools() {
    return {
      query: tool({
        description: 'Execute a SQL query against Snowflake. Supports cross-database joins.',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to execute'),
          database: z.string().optional().describe('Database to use'),
          schema: z.string().optional().describe('Schema to use'),
          warehouse: z.string().optional().describe('Warehouse to use'),
          maxResults: z.number().int().min(1).max(10000).optional().describe('Max rows (default: 1000)'),
        }),
        execute: async (_params: {
          sql: string;
          database?: string;
          schema?: string;
          warehouse?: string;
          maxResults?: number;
        }) => {
          return createToolError(this.id, 'Snowflake integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, and SNOWFLAKE_PASSWORD',
          });
        },
      }),

      list_databases: tool({
        description: 'List all databases in Snowflake',
        inputSchema: z.object({}),
        execute: async () => {
          return createToolError(this.id, 'Snowflake integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_schemas: tool({
        description: 'List schemas in a Snowflake database',
        inputSchema: z.object({
          database: z.string().describe('Database name'),
        }),
        execute: async (_params: { database: string }) => {
          return createToolError(this.id, 'Snowflake integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_tables: tool({
        description: 'List tables in a Snowflake schema',
        inputSchema: z.object({
          database: z.string().describe('Database name'),
          schema: z.string().describe('Schema name'),
        }),
        execute: async (_params: { database: string; schema: string }) => {
          return createToolError(this.id, 'Snowflake integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_table_schema: tool({
        description: 'Get the schema/columns of a Snowflake table',
        inputSchema: z.object({
          table: z.string().describe('Table name'),
          database: z.string().optional().describe('Database name'),
          schema: z.string().optional().describe('Schema name'),
        }),
        execute: async (_params: {
          table: string;
          database?: string;
          schema?: string;
        }) => {
          return createToolError(this.id, 'Snowflake integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      preview_table: tool({
        description: 'Preview sample rows from a Snowflake table',
        inputSchema: z.object({
          table: z.string().describe('Table name'),
          database: z.string().optional().describe('Database name'),
          schema: z.string().optional().describe('Schema name'),
          limit: z.number().int().min(1).max(100).optional().describe('Number of rows (default: 10)'),
        }),
        execute: async (_params: {
          table: string;
          database?: string;
          schema?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Snowflake integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
