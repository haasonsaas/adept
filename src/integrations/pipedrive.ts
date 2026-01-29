import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

const getPipedriveToken = (): string | null => {
  return process.env.PIPEDRIVE_API_TOKEN || null;
};

const pipedriveFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const token = getPipedriveToken();
  if (!token) throw new Error('Pipedrive API token is not configured');

  const url = new URL(`https://api.pipedrive.com/v1${path}`);
  url.searchParams.set('api_token', token);

  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Pipedrive API error (${response.status}): ${errorBody}`);
  }

  return response;
};

interface PipedrivePerson {
  id: number;
  name: string;
  email: Array<{ value: string; primary: boolean }>;
  phone: Array<{ value: string; primary: boolean }>;
  org_id: { value: number; name: string } | null;
  owner_id: { id: number; name: string };
  add_time: string;
  update_time: string;
}

interface PipedriveDeal {
  id: number;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage_id: number;
  pipeline_id: number;
  person_id: { value: number; name: string } | null;
  org_id: { value: number; name: string } | null;
  owner_id: { id: number; name: string };
  add_time: string;
  update_time: string;
  expected_close_date: string | null;
}

interface PipedriveOrganization {
  id: number;
  name: string;
  address: string;
  owner_id: { id: number; name: string };
  add_time: string;
  update_time: string;
}

export class PipedriveIntegration extends BaseIntegration {
  id = 'pipedrive';
  name = 'Pipedrive';
  description = 'Access Pipedrive CRM - deals, contacts, and organizations';
  icon = '🔵';

  isEnabled(): boolean {
    return !!getPipedriveToken();
  }

  getTools() {
    return {
      search_persons: tool({
        description: 'Search for persons/contacts in Pipedrive',
        inputSchema: z.object({
          query: z.string().describe('Search query (name, email, phone)'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, limit }: { query: string; limit?: number }) => {
          try {
            const response = await withRetry(
              () => pipedriveFetch(`/persons/search?term=${encodeURIComponent(query)}&limit=${limit || 10}`),
              { integrationId: this.id, operation: 'search persons' },
            );

            const data = await response.json() as {
              data: { items: Array<{ item: PipedrivePerson }> } | null;
            };

            if (!data.data) {
              return { persons: [] };
            }

            return {
              persons: data.data.items.map(({ item }) => ({
                id: item.id,
                name: item.name,
                email: item.email?.find((e) => e.primary)?.value || item.email?.[0]?.value,
                phone: item.phone?.find((p) => p.primary)?.value || item.phone?.[0]?.value,
                organization: item.org_id?.name,
                owner: item.owner_id?.name,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_person: tool({
        description: 'Get detailed information about a specific person',
        inputSchema: z.object({
          personId: z.number().describe('Pipedrive person ID'),
        }),
        execute: async ({ personId }: { personId: number }) => {
          try {
            const response = await withRetry(
              () => pipedriveFetch(`/persons/${personId}`),
              { integrationId: this.id, operation: 'get person' },
            );

            const data = await response.json() as { data: PipedrivePerson };
            const person = data.data;

            return {
              id: person.id,
              name: person.name,
              emails: person.email?.map((e) => ({ value: e.value, primary: e.primary })),
              phones: person.phone?.map((p) => ({ value: p.value, primary: p.primary })),
              organization: person.org_id ? { id: person.org_id.value, name: person.org_id.name } : null,
              owner: { id: person.owner_id.id, name: person.owner_id.name },
              createdAt: person.add_time,
              updatedAt: person.update_time,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      search_deals: tool({
        description: 'Search for deals in Pipedrive',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query'),
          status: z.enum(['open', 'won', 'lost', 'all']).optional().describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, status, limit }: { query?: string; status?: string; limit?: number }) => {
          try {
            let path = `/deals?limit=${limit || 10}`;
            if (status && status !== 'all') path += `&status=${status}`;

            const response = await withRetry(
              () => pipedriveFetch(path),
              { integrationId: this.id, operation: 'list deals' },
            );

            const data = await response.json() as { data: PipedriveDeal[] | null };
            let deals = data.data || [];

            // Filter by query if provided (client-side since API doesn't support it well)
            if (query) {
              const lowerQuery = query.toLowerCase();
              deals = deals.filter((d) => d.title.toLowerCase().includes(lowerQuery));
            }

            return {
              deals: deals.map((deal) => ({
                id: deal.id,
                title: deal.title,
                value: deal.value,
                currency: deal.currency,
                status: deal.status,
                stageId: deal.stage_id,
                pipelineId: deal.pipeline_id,
                person: deal.person_id ? { id: deal.person_id.value, name: deal.person_id.name } : null,
                organization: deal.org_id ? { id: deal.org_id.value, name: deal.org_id.name } : null,
                owner: { id: deal.owner_id.id, name: deal.owner_id.name },
                expectedCloseDate: deal.expected_close_date,
                createdAt: deal.add_time,
                updatedAt: deal.update_time,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_deal: tool({
        description: 'Get detailed information about a specific deal',
        inputSchema: z.object({
          dealId: z.number().describe('Pipedrive deal ID'),
        }),
        execute: async ({ dealId }: { dealId: number }) => {
          try {
            const response = await withRetry(
              () => pipedriveFetch(`/deals/${dealId}`),
              { integrationId: this.id, operation: 'get deal' },
            );

            const data = await response.json() as { data: PipedriveDeal };
            const deal = data.data;

            return {
              id: deal.id,
              title: deal.title,
              value: deal.value,
              currency: deal.currency,
              status: deal.status,
              stageId: deal.stage_id,
              pipelineId: deal.pipeline_id,
              person: deal.person_id ? { id: deal.person_id.value, name: deal.person_id.name } : null,
              organization: deal.org_id ? { id: deal.org_id.value, name: deal.org_id.name } : null,
              owner: { id: deal.owner_id.id, name: deal.owner_id.name },
              expectedCloseDate: deal.expected_close_date,
              createdAt: deal.add_time,
              updatedAt: deal.update_time,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      search_organizations: tool({
        description: 'Search for organizations in Pipedrive',
        inputSchema: z.object({
          query: z.string().describe('Search query (organization name)'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, limit }: { query: string; limit?: number }) => {
          try {
            const response = await withRetry(
              () => pipedriveFetch(`/organizations/search?term=${encodeURIComponent(query)}&limit=${limit || 10}`),
              { integrationId: this.id, operation: 'search organizations' },
            );

            const data = await response.json() as {
              data: { items: Array<{ item: PipedriveOrganization }> } | null;
            };

            if (!data.data) {
              return { organizations: [] };
            }

            return {
              organizations: data.data.items.map(({ item }) => ({
                id: item.id,
                name: item.name,
                address: item.address,
                owner: item.owner_id?.name,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_pipeline_summary: tool({
        description: 'Get a summary of deals by pipeline and stage',
        inputSchema: z.object({
          pipelineId: z.number().optional().describe('Pipeline ID (default: first pipeline)'),
        }),
        execute: async ({ pipelineId }: { pipelineId?: number }) => {
          try {
            // Get pipelines
            const pipelinesResponse = await withRetry(
              () => pipedriveFetch('/pipelines'),
              { integrationId: this.id, operation: 'get pipelines' },
            );
            const pipelinesData = await pipelinesResponse.json() as {
              data: Array<{ id: number; name: string }>;
            };

            const targetPipeline = pipelineId
              ? pipelinesData.data.find((p) => p.id === pipelineId)
              : pipelinesData.data[0];

            if (!targetPipeline) {
              return { error: 'Pipeline not found' };
            }

            // Get stages for pipeline
            const stagesResponse = await withRetry(
              () => pipedriveFetch(`/stages?pipeline_id=${targetPipeline.id}`),
              { integrationId: this.id, operation: 'get stages' },
            );
            const stagesData = await stagesResponse.json() as {
              data: Array<{ id: number; name: string; order_nr: number }>;
            };

            // Get open deals for pipeline
            const dealsResponse = await withRetry(
              () => pipedriveFetch(`/deals?pipeline_id=${targetPipeline.id}&limit=500&status=open`),
              { integrationId: this.id, operation: 'get pipeline deals' },
            );
            const dealsData = await dealsResponse.json() as { data: PipedriveDeal[] | null };
            const deals = dealsData.data || [];

            // Group deals by stage
            const stageStats = stagesData.data.map((stage) => {
              const stageDeals = deals.filter((d) => d.stage_id === stage.id);
              const totalValue = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);
              return {
                stageId: stage.id,
                stageName: stage.name,
                order: stage.order_nr,
                dealCount: stageDeals.length,
                totalValue,
                currency: stageDeals[0]?.currency || 'USD',
              };
            });

            return {
              pipelineId: targetPipeline.id,
              pipelineName: targetPipeline.name,
              stages: stageStats.sort((a, b) => a.order - b.order),
              totalDeals: deals.length,
              totalValue: deals.reduce((sum, d) => sum + (d.value || 0), 0),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_activities: tool({
        description: 'Get upcoming activities and tasks',
        inputSchema: z.object({
          type: z.string().optional().describe('Activity type filter (call, meeting, task, etc.)'),
          done: z.boolean().optional().describe('Filter by done status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ type, done, limit }: { type?: string; done?: boolean; limit?: number }) => {
          try {
            let path = `/activities?limit=${limit || 10}`;
            if (type) path += `&type=${type}`;
            if (done !== undefined) path += `&done=${done ? 1 : 0}`;

            const response = await withRetry(
              () => pipedriveFetch(path),
              { integrationId: this.id, operation: 'get activities' },
            );

            const data = await response.json() as {
              data: Array<{
                id: number;
                subject: string;
                type: string;
                done: boolean;
                due_date: string;
                due_time: string;
                deal_id: number | null;
                person_id: number | null;
                org_id: number | null;
              }> | null;
            };

            return {
              activities: (data.data || []).map((activity) => ({
                id: activity.id,
                subject: activity.subject,
                type: activity.type,
                done: activity.done,
                dueDate: activity.due_date,
                dueTime: activity.due_time,
                dealId: activity.deal_id,
                personId: activity.person_id,
                organizationId: activity.org_id,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
