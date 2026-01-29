import { tool } from 'ai';
import pg from 'pg';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError, toToolError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

interface PostgreSQLConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

const getPostgresConfig = (): PostgreSQLConfig | null => {
  if (process.env.POSTGRESQL_CONNECTION_STRING) {
    return { connectionString: process.env.POSTGRESQL_CONNECTION_STRING };
  }

  const host = process.env.POSTGRESQL_HOST;
  const user = process.env.POSTGRESQL_USER;
  const database = process.env.POSTGRESQL_DATABASE;

  if (!host || !user || !database) {
    return null;
  }

  return {
    host,
    port: parseInt(process.env.POSTGRESQL_PORT || '5432'),
    user,
    password: process.env.POSTGRESQL_PASSWORD,
    database,
  };
};

let pool: pg.Pool | null = null;

const getPool = (): pg.Pool => {
  if (!pool) {
    const config = getPostgresConfig();
    if (!config) throw new Error('PostgreSQL is not configured');

    pool = new Pool({
      ...config,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      logger.error({ err }, '[PostgreSQL] Pool error');
    });
  }
  return pool;
};

const MAX_QUERY_ROWS = 1000;
const DANGEROUS_KEYWORDS = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'INSERT', 'UPDATE', 'GRANT', 'REVOKE'];

const isSafeQuery = (sql: string): { safe: boolean; reason?: string } => {
  const upperSql = sql.toUpperCase().trim();

  for (const keyword of DANGEROUS_KEYWORDS) {
    if (upperSql.startsWith(keyword) || new RegExp(`\\b${keyword}\\b`).test(upperSql)) {
      return { safe: false, reason: `Query contains restricted keyword: ${keyword}` };
    }
  }

  if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH') && !upperSql.startsWith('EXPLAIN')) {
    return { safe: false, reason: 'Only SELECT, WITH (CTE), and EXPLAIN queries are allowed' };
  }

  return { safe: true };
};

export class PostgreSQLIntegration extends BaseIntegration {
  id = 'postgresql';
  name = 'PostgreSQL';
  description = 'Query PostgreSQL databases for data analysis';
  icon = '🐘';

  isEnabled(): boolean {
    return getPostgresConfig() !== null;
  }

  getTools() {
    return {
      query: tool({
        description:
          'Execute a read-only SQL query against the PostgreSQL database. ' +
          'Only SELECT queries are allowed for safety. Results are limited to 1000 rows.',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to execute (SELECT only)'),
          params: z.array(z.unknown()).optional().describe('Query parameters for prepared statements ($1, $2, etc.)'),
        }),
        execute: async ({ sql, params }: { sql: string; params?: unknown[] }) => {
          const safetyCheck = isSafeQuery(sql);
          if (!safetyCheck.safe) {
            return createToolError(this.id, safetyCheck.reason || 'Query not allowed', {
              kind: 'invalid_request',
              hint: 'Only SELECT queries are allowed for safety',
            });
          }

          try {
            const client = getPool();

            // Add LIMIT if not present to prevent huge result sets
            const upperSql = sql.toUpperCase();
            const hasLimit = upperSql.includes('LIMIT');
            const queryWithLimit = hasLimit ? sql : `${sql.replace(/;?\s*$/, '')} LIMIT ${MAX_QUERY_ROWS}`;

            const result = await client.query(queryWithLimit, params);

            return {
              rows: result.rows,
              rowCount: result.rowCount,
              fields: result.fields.map((f) => ({
                name: f.name,
                dataTypeId: f.dataTypeID,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_schemas: tool({
        description: 'List all schemas in the database',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const client = getPool();
            const result = await client.query(`
              SELECT schema_name, schema_owner
              FROM information_schema.schemata
              WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
              ORDER BY schema_name
            `);

            return {
              schemas: result.rows.map((row) => ({
                name: row.schema_name,
                owner: row.schema_owner,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_tables: tool({
        description: 'List all tables in a schema',
        inputSchema: z.object({
          schema: z.string().optional().describe('Schema name (default: public)'),
        }),
        execute: async ({ schema }: { schema?: string }) => {
          try {
            const client = getPool();
            const schemaName = schema || 'public';

            const result = await client.query(
              `
              SELECT 
                table_name,
                table_type,
                pg_catalog.obj_description(
                  (quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass, 'pg_class'
                ) as description
              FROM information_schema.tables
              WHERE table_schema = $1
              ORDER BY table_name
            `,
              [schemaName],
            );

            return {
              schema: schemaName,
              tables: result.rows.map((row) => ({
                name: row.table_name,
                type: row.table_type,
                description: row.description,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      describe_table: tool({
        description: 'Get the schema/structure of a table including columns, types, and constraints',
        inputSchema: z.object({
          table: z.string().describe('Table name'),
          schema: z.string().optional().describe('Schema name (default: public)'),
        }),
        execute: async ({ table, schema }: { table: string; schema?: string }) => {
          try {
            const client = getPool();
            const schemaName = schema || 'public';

            // Get columns
            const columnsResult = await client.query(
              `
              SELECT 
                column_name,
                data_type,
                character_maximum_length,
                numeric_precision,
                numeric_scale,
                is_nullable,
                column_default
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
              ORDER BY ordinal_position
            `,
              [schemaName, table],
            );

            // Get primary key columns
            const pkResult = await client.query(
              `
              SELECT a.attname as column_name
              FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
              WHERE i.indrelid = ($1 || '.' || $2)::regclass
                AND i.indisprimary
            `,
              [schemaName, table],
            );

            const primaryKeyColumns = pkResult.rows.map((r) => r.column_name);

            // Get indexes
            const indexResult = await client.query(
              `
              SELECT indexname, indexdef
              FROM pg_indexes
              WHERE schemaname = $1 AND tablename = $2
            `,
              [schemaName, table],
            );

            return {
              schema: schemaName,
              table,
              columns: columnsResult.rows.map((col) => ({
                name: col.column_name,
                type: col.data_type,
                maxLength: col.character_maximum_length,
                precision: col.numeric_precision,
                scale: col.numeric_scale,
                nullable: col.is_nullable === 'YES',
                default: col.column_default,
                isPrimaryKey: primaryKeyColumns.includes(col.column_name),
              })),
              indexes: indexResult.rows.map((idx) => ({
                name: idx.indexname,
                definition: idx.indexdef,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      sample_data: tool({
        description: 'Get a sample of data from a table',
        inputSchema: z.object({
          table: z.string().describe('Table name'),
          schema: z.string().optional().describe('Schema name (default: public)'),
          limit: z.number().int().min(1).max(100).optional().describe('Number of rows (default: 10)'),
        }),
        execute: async ({ table, schema, limit }: { table: string; schema?: string; limit?: number }) => {
          try {
            const client = getPool();
            const schemaName = schema || 'public';
            const rowLimit = limit || 10;

            // Validate table exists to prevent SQL injection
            const tableCheck = await client.query(
              `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
              [schemaName, table],
            );

            if (tableCheck.rowCount === 0) {
              return createToolError(this.id, `Table "${schemaName}.${table}" not found`, {
                kind: 'invalid_request',
              });
            }

            // Use identifier quoting to safely include schema and table names
            const result = await client.query(
              `SELECT * FROM "${schemaName}"."${table}" LIMIT $1`,
              [rowLimit],
            );

            return {
              schema: schemaName,
              table,
              rows: result.rows,
              rowCount: result.rowCount,
              columns: result.fields.map((f) => f.name),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      explain_query: tool({
        description: 'Get the execution plan for a query',
        inputSchema: z.object({
          sql: z.string().describe('SQL query to analyze'),
          analyze: z.boolean().optional().describe('Actually run the query to get real timings (default: false)'),
        }),
        execute: async ({ sql, analyze }: { sql: string; analyze?: boolean }) => {
          const safetyCheck = isSafeQuery(sql);
          if (!safetyCheck.safe) {
            return createToolError(this.id, safetyCheck.reason || 'Query not allowed', {
              kind: 'invalid_request',
            });
          }

          try {
            const client = getPool();
            const explainPrefix = analyze ? 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)' : 'EXPLAIN (FORMAT JSON)';
            const result = await client.query(`${explainPrefix} ${sql}`);

            const plan = result.rows[0]['QUERY PLAN'];

            return {
              plan: plan[0],
              executionTime: analyze && plan[0] ? plan[0]['Execution Time'] : null,
              planningTime: analyze && plan[0] ? plan[0]['Planning Time'] : null,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
