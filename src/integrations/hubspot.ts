import { tool } from 'ai';
import { Client } from '@hubspot/api-client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts/models/Filter.js';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

const getHubSpotClient = (): Client | null => {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) return null;

  return new Client({ accessToken });
};

interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
  createdAt: Date;
  updatedAt: Date;
}

interface HubSpotCompany {
  id: string;
  properties: Record<string, string | null>;
  createdAt: Date;
  updatedAt: Date;
}

interface HubSpotDeal {
  id: string;
  properties: Record<string, string | null>;
  createdAt: Date;
  updatedAt: Date;
}

export class HubSpotIntegration extends BaseIntegration {
  id = 'hubspot';
  name = 'HubSpot';
  description = 'Access HubSpot CRM - contacts, companies, and deals';
  icon = '🟠';

  isEnabled(): boolean {
    return !!process.env.HUBSPOT_ACCESS_TOKEN;
  }

  getTools() {
    return {
      search_contacts: tool({
        description: 'Search for contacts in HubSpot',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query (name, email)'),
          email: z.string().optional().describe('Filter by exact email'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, email, limit }: { query?: string; email?: string; limit?: number }) => {
          try {
            const client = getHubSpotClient();
            if (!client) throw new Error('HubSpot is not configured');

            const properties = ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'lifecyclestage'];

            let response;

            if (email) {
              response = await withRetry(
                () => client.crm.contacts.searchApi.doSearch({
                  filterGroups: [{
                    filters: [{
                      propertyName: 'email',
                      operator: FilterOperatorEnum.Eq,
                      value: email,
                    }],
                  }],
                  properties,
                  limit: limit || 10,
                }),
                { integrationId: this.id, operation: 'search contacts by email' },
              );
            } else if (query) {
              response = await withRetry(
                () => client.crm.contacts.searchApi.doSearch({
                  query,
                  properties,
                  limit: limit || 10,
                }),
                { integrationId: this.id, operation: 'search contacts' },
              );
            } else {
              const listResponse = await withRetry(
                () => client.crm.contacts.basicApi.getPage(limit || 10, undefined, properties),
                { integrationId: this.id, operation: 'list contacts' },
              );
              response = { results: listResponse.results, total: listResponse.results.length };
            }

            return {
              contacts: response.results.map((c: HubSpotContact) => ({
                id: c.id,
                firstName: c.properties.firstname,
                lastName: c.properties.lastname,
                email: c.properties.email,
                phone: c.properties.phone,
                company: c.properties.company,
                jobTitle: c.properties.jobtitle,
                lifecycleStage: c.properties.lifecyclestage,
              })),
              total: response.total || response.results.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_contact: tool({
        description: 'Get detailed information about a contact',
        inputSchema: z.object({
          contactId: z.string().describe('HubSpot contact ID'),
        }),
        execute: async ({ contactId }: { contactId: string }) => {
          try {
            const client = getHubSpotClient();
            if (!client) throw new Error('HubSpot is not configured');

            const properties = [
              'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle',
              'lifecyclestage', 'hs_lead_status', 'createdate', 'lastmodifieddate',
              'address', 'city', 'state', 'zip', 'country',
            ];

            const contact = await withRetry(
              () => client.crm.contacts.basicApi.getById(contactId, properties),
              { integrationId: this.id, operation: 'get contact' },
            );

            return {
              id: contact.id,
              firstName: contact.properties.firstname,
              lastName: contact.properties.lastname,
              email: contact.properties.email,
              phone: contact.properties.phone,
              company: contact.properties.company,
              jobTitle: contact.properties.jobtitle,
              lifecycleStage: contact.properties.lifecyclestage,
              leadStatus: contact.properties.hs_lead_status,
              address: {
                street: contact.properties.address,
                city: contact.properties.city,
                state: contact.properties.state,
                zip: contact.properties.zip,
                country: contact.properties.country,
              },
              createdAt: contact.createdAt,
              updatedAt: contact.updatedAt,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      search_companies: tool({
        description: 'Search for companies in HubSpot',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query (company name, domain)'),
          domain: z.string().optional().describe('Filter by exact domain'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, domain, limit }: { query?: string; domain?: string; limit?: number }) => {
          try {
            const client = getHubSpotClient();
            if (!client) throw new Error('HubSpot is not configured');

            const properties = ['name', 'domain', 'industry', 'numberofemployees', 'annualrevenue', 'city', 'state', 'country'];

            let response;

            if (domain) {
              response = await withRetry(
                () => client.crm.companies.searchApi.doSearch({
                  filterGroups: [{
                    filters: [{
                      propertyName: 'domain',
                      operator: FilterOperatorEnum.Eq,
                      value: domain,
                    }],
                  }],
                  properties,
                  limit: limit || 10,
                }),
                { integrationId: this.id, operation: 'search companies by domain' },
              );
            } else if (query) {
              response = await withRetry(
                () => client.crm.companies.searchApi.doSearch({
                  query,
                  properties,
                  limit: limit || 10,
                }),
                { integrationId: this.id, operation: 'search companies' },
              );
            } else {
              const listResponse = await withRetry(
                () => client.crm.companies.basicApi.getPage(limit || 10, undefined, properties),
                { integrationId: this.id, operation: 'list companies' },
              );
              response = { results: listResponse.results, total: listResponse.results.length };
            }

            return {
              companies: response.results.map((c: HubSpotCompany) => ({
                id: c.id,
                name: c.properties.name,
                domain: c.properties.domain,
                industry: c.properties.industry,
                employeeCount: c.properties.numberofemployees,
                annualRevenue: c.properties.annualrevenue,
                location: `${c.properties.city || ''}${c.properties.state ? ', ' + c.properties.state : ''}${c.properties.country ? ', ' + c.properties.country : ''}`.trim() || null,
              })),
              total: response.total || response.results.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_company: tool({
        description: 'Get detailed information about a company',
        inputSchema: z.object({
          companyId: z.string().describe('HubSpot company ID'),
        }),
        execute: async ({ companyId }: { companyId: string }) => {
          try {
            const client = getHubSpotClient();
            if (!client) throw new Error('HubSpot is not configured');

            const properties = [
              'name', 'domain', 'industry', 'numberofemployees', 'annualrevenue',
              'description', 'phone', 'address', 'city', 'state', 'zip', 'country',
              'createdate', 'hs_lastmodifieddate',
            ];

            const company = await withRetry(
              () => client.crm.companies.basicApi.getById(companyId, properties),
              { integrationId: this.id, operation: 'get company' },
            );

            return {
              id: company.id,
              name: company.properties.name,
              domain: company.properties.domain,
              industry: company.properties.industry,
              employeeCount: company.properties.numberofemployees,
              annualRevenue: company.properties.annualrevenue,
              description: company.properties.description,
              phone: company.properties.phone,
              address: {
                street: company.properties.address,
                city: company.properties.city,
                state: company.properties.state,
                zip: company.properties.zip,
                country: company.properties.country,
              },
              createdAt: company.createdAt,
              updatedAt: company.updatedAt,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      search_deals: tool({
        description: 'Search for deals in HubSpot',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query (deal name)'),
          stage: z.string().optional().describe('Filter by deal stage'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, stage, limit }: { query?: string; stage?: string; limit?: number }) => {
          try {
            const client = getHubSpotClient();
            if (!client) throw new Error('HubSpot is not configured');

            const properties = ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'createdate'];

            let response;

            if (stage) {
              response = await withRetry(
                () => client.crm.deals.searchApi.doSearch({
                  filterGroups: [{
                    filters: [{
                      propertyName: 'dealstage',
                      operator: FilterOperatorEnum.Eq,
                      value: stage,
                    }],
                  }],
                  properties,
                  limit: limit || 10,
                }),
                { integrationId: this.id, operation: 'search deals by stage' },
              );
            } else if (query) {
              response = await withRetry(
                () => client.crm.deals.searchApi.doSearch({
                  query,
                  properties,
                  limit: limit || 10,
                }),
                { integrationId: this.id, operation: 'search deals' },
              );
            } else {
              const listResponse = await withRetry(
                () => client.crm.deals.basicApi.getPage(limit || 10, undefined, properties),
                { integrationId: this.id, operation: 'list deals' },
              );
              response = { results: listResponse.results, total: listResponse.results.length };
            }

            return {
              deals: response.results.map((d: HubSpotDeal) => ({
                id: d.id,
                name: d.properties.dealname,
                amount: d.properties.amount ? parseFloat(d.properties.amount) : null,
                stage: d.properties.dealstage,
                pipeline: d.properties.pipeline,
                closeDate: d.properties.closedate,
                createdAt: d.properties.createdate,
              })),
              total: response.total || response.results.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_deal: tool({
        description: 'Get detailed information about a deal',
        inputSchema: z.object({
          dealId: z.string().describe('HubSpot deal ID'),
        }),
        execute: async ({ dealId }: { dealId: string }) => {
          try {
            const client = getHubSpotClient();
            if (!client) throw new Error('HubSpot is not configured');

            const properties = [
              'dealname', 'amount', 'dealstage', 'pipeline', 'closedate',
              'createdate', 'hs_lastmodifieddate', 'description',
              'hs_deal_stage_probability', 'hubspot_owner_id',
            ];

            const deal = await withRetry(
              () => client.crm.deals.basicApi.getById(dealId, properties),
              { integrationId: this.id, operation: 'get deal' },
            );

            return {
              id: deal.id,
              name: deal.properties.dealname,
              amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
              stage: deal.properties.dealstage,
              pipeline: deal.properties.pipeline,
              probability: deal.properties.hs_deal_stage_probability,
              description: deal.properties.description,
              closeDate: deal.properties.closedate,
              ownerId: deal.properties.hubspot_owner_id,
              createdAt: deal.createdAt,
              updatedAt: deal.updatedAt,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_pipeline_summary: tool({
        description: 'Get a summary of deals grouped by pipeline stage',
        inputSchema: z.object({
          pipelineId: z.string().optional().describe('Pipeline ID (uses default if not specified)'),
        }),
        execute: async ({ pipelineId }: { pipelineId?: string }) => {
          try {
            const client = getHubSpotClient();
            if (!client) throw new Error('HubSpot is not configured');

            // Get all open deals (no closed stages)
            const properties = ['dealname', 'amount', 'dealstage', 'pipeline'];

            const allDeals: HubSpotDeal[] = [];
            let after: string | undefined;

            // Paginate through deals
            do {
              const response = await withRetry(
                () => client.crm.deals.basicApi.getPage(100, after, properties),
                { integrationId: this.id, operation: 'get deals for summary' },
              );
              allDeals.push(...response.results);
              after = response.paging?.next?.after;
            } while (after && allDeals.length < 500);

            // Filter by pipeline if specified
            const deals = pipelineId
              ? allDeals.filter((d) => d.properties.pipeline === pipelineId)
              : allDeals;

            // Group by stage
            const byStage: Record<string, { count: number; totalValue: number }> = {};

            for (const deal of deals) {
              const stage = deal.properties.dealstage || 'Unknown';
              if (!byStage[stage]) {
                byStage[stage] = { count: 0, totalValue: 0 };
              }
              byStage[stage].count += 1;
              byStage[stage].totalValue += deal.properties.amount ? parseFloat(deal.properties.amount) : 0;
            }

            return {
              pipelineId: pipelineId || 'all',
              totalDeals: deals.length,
              totalValue: deals.reduce((sum, d) => sum + (d.properties.amount ? parseFloat(d.properties.amount) : 0), 0),
              byStage: Object.entries(byStage).map(([stage, data]) => ({
                stage,
                dealCount: data.count,
                totalValue: data.totalValue,
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
