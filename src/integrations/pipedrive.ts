import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class PipedriveIntegration extends BaseIntegration {
  id = 'pipedrive';
  name = 'Pipedrive';
  description = 'Access Pipedrive CRM - pipeline management, deals, and contacts';
  icon = '🟢';

  isEnabled(): boolean {
    return !!process.env.PIPEDRIVE_API_TOKEN;
  }

  getTools() {
    return {
      search_deals: tool({
        description: 'Search for deals in Pipedrive',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query'),
          status: z.enum(['open', 'won', 'lost', 'all']).optional().describe('Deal status filter'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query?: string; status?: string; limit?: number }) => {
          return createToolError(this.id, 'Pipedrive integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set PIPEDRIVE_API_TOKEN and implement the API calls',
          });
        },
      }),

      get_deal: tool({
        description: 'Get detailed information about a specific deal',
        inputSchema: z.object({
          dealId: z.string().describe('Pipedrive deal ID'),
        }),
        execute: async (_params: { dealId: string }) => {
          return createToolError(this.id, 'Pipedrive integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      search_persons: tool({
        description: 'Search for people/contacts in Pipedrive',
        inputSchema: z.object({
          query: z.string().describe('Name or email to search'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query: string; limit?: number }) => {
          return createToolError(this.id, 'Pipedrive integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_person: tool({
        description: 'Get detailed information about a specific person',
        inputSchema: z.object({
          personId: z.string().describe('Pipedrive person ID'),
        }),
        execute: async (_params: { personId: string }) => {
          return createToolError(this.id, 'Pipedrive integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      search_organizations: tool({
        description: 'Search for organizations in Pipedrive',
        inputSchema: z.object({
          query: z.string().describe('Organization name to search'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query: string; limit?: number }) => {
          return createToolError(this.id, 'Pipedrive integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_pipeline_summary: tool({
        description: 'Get a summary of deals by pipeline stage',
        inputSchema: z.object({
          pipelineId: z.number().int().optional().describe('Pipeline ID (default: default pipeline)'),
        }),
        execute: async (_params: { pipelineId?: number }) => {
          return createToolError(this.id, 'Pipedrive integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_activities: tool({
        description: 'Get activities (calls, meetings, tasks) for a deal or person',
        inputSchema: z.object({
          dealId: z.string().optional().describe('Filter by deal ID'),
          personId: z.string().optional().describe('Filter by person ID'),
          type: z.string().optional().describe('Activity type (call, meeting, task, etc.)'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { dealId?: string; personId?: string; type?: string; limit?: number }) => {
          return createToolError(this.id, 'Pipedrive integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
