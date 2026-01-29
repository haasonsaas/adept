import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class BigQueryIntegration extends BaseIntegration {
  id = 'bigquery';
  name = 'BigQuery';
  description = 'Query Google BigQuery data warehouse';
  icon = '📊';

  isEnabled(): boolean {
    return !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.BIGQUERY_PROJECT_ID);
  }

  getTools() {
    return {
      query: tool({
        description: 'Execute a SQL query against BigQuery. Use this for data analysis and reporting.',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to execute'),
          projectId: z.string().optional().describe('GCP project ID (uses default if not specified)'),
          maxResults: z.number().int().min(1).max(10000).optional().describe('Max rows to return (default: 1000)'),
          timeoutMs: z.number().int().optional().describe('Query timeout in milliseconds'),
        }),
        execute: async (_params: {
          sql: string;
          projectId?: string;
          maxResults?: number;
          timeoutMs?: number;
        }) => {
          return createToolError(this.id, 'BigQuery integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set GOOGLE_APPLICATION_CREDENTIALS or BIGQUERY_PROJECT_ID and implement the API calls',
          });
        },
      }),

      list_datasets: tool({
        description: 'List all datasets in a BigQuery project',
        inputSchema: z.object({
          projectId: z.string().optional().describe('GCP project ID'),
        }),
        execute: async (_params: { projectId?: string }) => {
          return createToolError(this.id, 'BigQuery integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_tables: tool({
        description: 'List tables in a BigQuery dataset',
        inputSchema: z.object({
          datasetId: z.string().describe('Dataset ID'),
          projectId: z.string().optional().describe('GCP project ID'),
        }),
        execute: async (_params: { datasetId: string; projectId?: string }) => {
          return createToolError(this.id, 'BigQuery integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_table_schema: tool({
        description: 'Get the schema of a BigQuery table',
        inputSchema: z.object({
          tableId: z.string().describe('Table ID'),
          datasetId: z.string().describe('Dataset ID'),
          projectId: z.string().optional().describe('GCP project ID'),
        }),
        execute: async (_params: {
          tableId: string;
          datasetId: string;
          projectId?: string;
        }) => {
          return createToolError(this.id, 'BigQuery integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      preview_table: tool({
        description: 'Preview sample rows from a BigQuery table',
        inputSchema: z.object({
          tableId: z.string().describe('Table ID'),
          datasetId: z.string().describe('Dataset ID'),
          projectId: z.string().optional().describe('GCP project ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Number of rows (default: 10)'),
        }),
        execute: async (_params: {
          tableId: string;
          datasetId: string;
          projectId?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'BigQuery integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
