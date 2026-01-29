import { tool } from 'ai';
import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError, toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

interface BigQueryConfig {
  projectId?: string;
  keyFilename?: string;
  credentials?: object;
}

const getBigQueryConfig = (): BigQueryConfig | null => {
  const projectId = process.env.BIGQUERY_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credentialsJson = process.env.BIGQUERY_CREDENTIALS;

  if (!projectId) return null;

  const config: BigQueryConfig = { projectId };

  if (credentialsJson) {
    try {
      config.credentials = JSON.parse(credentialsJson);
    } catch {
      return null;
    }
  } else if (keyFilename) {
    config.keyFilename = keyFilename;
  }

  return config;
};

let bigQueryClient: BigQuery | null = null;

const getBigQueryClient = (): BigQuery | null => {
  if (bigQueryClient) return bigQueryClient;

  const config = getBigQueryConfig();
  if (!config) return null;

  bigQueryClient = new BigQuery(config);
  return bigQueryClient;
};

const MAX_QUERY_ROWS = 1000;
const DANGEROUS_KEYWORDS = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'INSERT', 'UPDATE', 'GRANT', 'REVOKE', 'MERGE'];

const isSafeQuery = (sql: string): { safe: boolean; reason?: string } => {
  const upperSql = sql.toUpperCase().trim();

  for (const keyword of DANGEROUS_KEYWORDS) {
    if (upperSql.startsWith(keyword) || new RegExp(`\\b${keyword}\\b`).test(upperSql)) {
      return { safe: false, reason: `Query contains restricted keyword: ${keyword}` };
    }
  }

  if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH')) {
    return { safe: false, reason: 'Only SELECT and WITH (CTE) queries are allowed' };
  }

  return { safe: true };
};

export class BigQueryIntegration extends BaseIntegration {
  id = 'bigquery';
  name = 'BigQuery';
  description = 'Query Google BigQuery for data analytics';
  icon = '📊';

  isEnabled(): boolean {
    return getBigQueryConfig() !== null;
  }

  getTools() {
    return {
      query: tool({
        description:
          'Execute a read-only SQL query against BigQuery. ' +
          'Only SELECT queries are allowed for safety. Results are limited to 1000 rows.',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to execute (SELECT only)'),
          params: z.record(z.unknown()).optional().describe('Named query parameters'),
        }),
        execute: async ({ sql, params }: { sql: string; params?: Record<string, unknown> }) => {
          const safetyCheck = isSafeQuery(sql);
          if (!safetyCheck.safe) {
            return createToolError(this.id, safetyCheck.reason || 'Query not allowed', {
              kind: 'invalid_request',
              hint: 'Only SELECT queries are allowed for safety',
            });
          }

          try {
            const client = getBigQueryClient();
            if (!client) throw new Error('BigQuery is not configured');

            // Add LIMIT if not present
            const upperSql = sql.toUpperCase();
            const hasLimit = upperSql.includes('LIMIT');
            const queryWithLimit = hasLimit ? sql : `${sql.replace(/;?\s*$/, '')} LIMIT ${MAX_QUERY_ROWS}`;

            const [rows] = await withRetry(
              () => client.query({
                query: queryWithLimit,
                params,
                maxResults: MAX_QUERY_ROWS,
              }),
              { integrationId: this.id, operation: 'query' },
            );

            return {
              rows,
              rowCount: rows.length,
              truncated: rows.length === MAX_QUERY_ROWS,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_datasets: tool({
        description: 'List all datasets in the project',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const client = getBigQueryClient();
            if (!client) throw new Error('BigQuery is not configured');

            const [datasets] = await withRetry(
              () => client.getDatasets(),
              { integrationId: this.id, operation: 'list datasets' },
            );

            return {
              datasets: datasets.map((ds) => ({
                id: ds.id,
                location: ds.metadata?.location,
                createdTime: ds.metadata?.creationTime,
                description: ds.metadata?.description,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_tables: tool({
        description: 'List all tables in a dataset',
        inputSchema: z.object({
          datasetId: z.string().describe('Dataset ID'),
        }),
        execute: async ({ datasetId }: { datasetId: string }) => {
          try {
            const client = getBigQueryClient();
            if (!client) throw new Error('BigQuery is not configured');

            const dataset = client.dataset(datasetId);
            const [tables] = await withRetry(
              () => dataset.getTables(),
              { integrationId: this.id, operation: 'list tables' },
            );

            return {
              datasetId,
              tables: tables.map((table) => ({
                id: table.id,
                type: table.metadata?.type,
                createdTime: table.metadata?.creationTime,
                description: table.metadata?.description,
                numRows: table.metadata?.numRows,
                numBytes: table.metadata?.numBytes,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      describe_table: tool({
        description: 'Get the schema of a table',
        inputSchema: z.object({
          datasetId: z.string().describe('Dataset ID'),
          tableId: z.string().describe('Table ID'),
        }),
        execute: async ({ datasetId, tableId }: { datasetId: string; tableId: string }) => {
          try {
            const client = getBigQueryClient();
            if (!client) throw new Error('BigQuery is not configured');

            const [metadata] = await withRetry(
              () => client.dataset(datasetId).table(tableId).getMetadata(),
              { integrationId: this.id, operation: 'describe table' },
            );

            interface BQField {
              name: string;
              type: string;
              mode?: string;
              description?: string;
              fields?: BQField[];
            }

            const formatField = (field: BQField): object => ({
              name: field.name,
              type: field.type,
              mode: field.mode || 'NULLABLE',
              description: field.description,
              fields: field.fields?.map(formatField),
            });

            return {
              datasetId,
              tableId,
              type: metadata.type,
              description: metadata.description,
              numRows: metadata.numRows,
              numBytes: metadata.numBytes,
              createdTime: metadata.creationTime,
              lastModifiedTime: metadata.lastModifiedTime,
              schema: metadata.schema?.fields?.map(formatField),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      sample_data: tool({
        description: 'Get a sample of data from a table',
        inputSchema: z.object({
          datasetId: z.string().describe('Dataset ID'),
          tableId: z.string().describe('Table ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Number of rows (default: 10)'),
        }),
        execute: async ({ datasetId, tableId, limit }: { datasetId: string; tableId: string; limit?: number }) => {
          try {
            const client = getBigQueryClient();
            if (!client) throw new Error('BigQuery is not configured');

            const rowLimit = limit || 10;
            const sql = `SELECT * FROM \`${datasetId}.${tableId}\` LIMIT ${rowLimit}`;

            const [rows] = await withRetry(
              () => client.query({ query: sql, maxResults: rowLimit }),
              { integrationId: this.id, operation: 'sample data' },
            );

            return {
              datasetId,
              tableId,
              rows,
              rowCount: rows.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      dry_run: tool({
        description: 'Dry run a query to check validity and estimate cost',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to analyze'),
        }),
        execute: async ({ sql }: { sql: string }) => {
          const safetyCheck = isSafeQuery(sql);
          if (!safetyCheck.safe) {
            return createToolError(this.id, safetyCheck.reason || 'Query not allowed', {
              kind: 'invalid_request',
            });
          }

          try {
            const client = getBigQueryClient();
            if (!client) throw new Error('BigQuery is not configured');

            const [job] = await withRetry(
              () => client.createQueryJob({ query: sql, dryRun: true }),
              { integrationId: this.id, operation: 'dry run' },
            );

            const metadata = job.metadata;
            const bytesProcessed = metadata?.statistics?.totalBytesProcessed;
            const estimatedCostUSD = bytesProcessed
              ? (parseInt(bytesProcessed) / (1024 * 1024 * 1024 * 1024)) * 5 // $5 per TB
              : null;

            return {
              valid: true,
              totalBytesProcessed: bytesProcessed,
              estimatedCostUSD: estimatedCostUSD ? `$${estimatedCostUSD.toFixed(4)}` : 'Unknown',
              referencedTables: metadata?.statistics?.query?.referencedTables?.map(
                (t: { projectId: string; datasetId: string; tableId: string }) =>
                  `${t.projectId}.${t.datasetId}.${t.tableId}`,
              ),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
