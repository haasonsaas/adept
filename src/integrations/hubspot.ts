import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class HubSpotIntegration extends BaseIntegration {
  id = 'hubspot';
  name = 'HubSpot';
  description = 'Access HubSpot CRM - deals, contacts, and companies';
  icon = '🟠';

  isEnabled(): boolean {
    return !!(process.env.HUBSPOT_ACCESS_TOKEN || process.env.HUBSPOT_API_KEY);
  }

  getTools() {
    return {
      search_contacts: tool({
        description: 'Search for contacts in HubSpot by name, email, or company',
        inputSchema: z.object({
          query: z.string().describe('Search query (name, email, or company)'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query: string; limit?: number }) => {
          return createToolError(this.id, 'HubSpot integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set HUBSPOT_ACCESS_TOKEN and implement the API calls',
          });
        },
      }),

      get_contact: tool({
        description: 'Get detailed information about a specific HubSpot contact',
        inputSchema: z.object({
          contactId: z.string().describe('HubSpot contact ID'),
        }),
        execute: async (_params: { contactId: string }) => {
          return createToolError(this.id, 'HubSpot integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      search_deals: tool({
        description: 'Search for deals in HubSpot pipeline',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query'),
          stage: z.string().optional().describe('Filter by deal stage'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query?: string; stage?: string; limit?: number }) => {
          return createToolError(this.id, 'HubSpot integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_deal: tool({
        description: 'Get detailed information about a specific deal',
        inputSchema: z.object({
          dealId: z.string().describe('HubSpot deal ID'),
        }),
        execute: async (_params: { dealId: string }) => {
          return createToolError(this.id, 'HubSpot integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      search_companies: tool({
        description: 'Search for companies in HubSpot',
        inputSchema: z.object({
          query: z.string().describe('Company name or domain to search'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query: string; limit?: number }) => {
          return createToolError(this.id, 'HubSpot integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_company: tool({
        description: 'Get detailed information about a specific company',
        inputSchema: z.object({
          companyId: z.string().describe('HubSpot company ID'),
        }),
        execute: async (_params: { companyId: string }) => {
          return createToolError(this.id, 'HubSpot integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_pipeline_summary: tool({
        description: 'Get a summary of the sales pipeline by stage',
        inputSchema: z.object({
          pipelineId: z.string().optional().describe('Pipeline ID (default: default pipeline)'),
        }),
        execute: async (_params: { pipelineId?: string }) => {
          return createToolError(this.id, 'HubSpot integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
