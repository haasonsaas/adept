import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

interface ZendeskConfig {
  subdomain: string;
  email?: string;
  apiToken?: string;
  oauthToken?: string;
}

const getZendeskConfig = (): ZendeskConfig | null => {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  if (!subdomain) return null;

  const email = process.env.ZENDESK_EMAIL;
  const apiToken = process.env.ZENDESK_API_TOKEN;
  const oauthToken = process.env.ZENDESK_OAUTH_TOKEN;

  if (!oauthToken && (!email || !apiToken)) {
    return null;
  }

  return { subdomain, email, apiToken, oauthToken };
};

const zendeskFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const config = getZendeskConfig();
  if (!config) throw new Error('Zendesk is not configured');

  const url = `https://${config.subdomain}.zendesk.com/api/v2${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (config.oauthToken) {
    headers['Authorization'] = `Bearer ${config.oauthToken}`;
  } else if (config.email && config.apiToken) {
    const auth = Buffer.from(`${config.email}/token:${config.apiToken}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Zendesk API error (${response.status}): ${errorBody}`);
  }

  return response;
};

interface ZendeskTicket {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  requester_id: number;
  assignee_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface ZendeskUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface ZendeskComment {
  id: number;
  body: string;
  author_id: number;
  public: boolean;
  created_at: string;
}

export class ZendeskIntegration extends BaseIntegration {
  id = 'zendesk';
  name = 'Zendesk';
  description = 'Access Zendesk - tickets, users, and satisfaction data';
  icon = '🎫';

  isEnabled(): boolean {
    return getZendeskConfig() !== null;
  }

  getTools() {
    return {
      search_tickets: tool({
        description: 'Search for tickets in Zendesk',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query'),
          status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional().describe('Filter by status'),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Filter by priority'),
          assigneeId: z.number().optional().describe('Filter by assignee ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 25)'),
        }),
        execute: async ({
          query,
          status,
          priority,
          assigneeId,
          limit,
        }: {
          query?: string;
          status?: string;
          priority?: string;
          assigneeId?: number;
          limit?: number;
        }) => {
          try {
            const searchParts: string[] = ['type:ticket'];
            if (query) searchParts.push(query);
            if (status) searchParts.push(`status:${status}`);
            if (priority) searchParts.push(`priority:${priority}`);
            if (assigneeId) searchParts.push(`assignee:${assigneeId}`);

            const searchQuery = encodeURIComponent(searchParts.join(' '));
            const response = await withRetry(
              () => zendeskFetch(`/search.json?query=${searchQuery}&per_page=${limit || 25}`),
              { integrationId: this.id, operation: 'search tickets' },
            );

            const data = await response.json() as { results: ZendeskTicket[]; count: number };

            return {
              total: data.count,
              tickets: data.results.map((ticket) => ({
                id: ticket.id,
                subject: ticket.subject,
                status: ticket.status,
                priority: ticket.priority,
                requesterId: ticket.requester_id,
                assigneeId: ticket.assignee_id,
                tags: ticket.tags,
                createdAt: ticket.created_at,
                updatedAt: ticket.updated_at,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_ticket: tool({
        description: 'Get details of a specific ticket',
        inputSchema: z.object({
          ticketId: z.number().describe('Zendesk ticket ID'),
        }),
        execute: async ({ ticketId }: { ticketId: number }) => {
          try {
            const response = await withRetry(
              () => zendeskFetch(`/tickets/${ticketId}.json?include=users`),
              { integrationId: this.id, operation: 'get ticket' },
            );

            const data = await response.json() as { ticket: ZendeskTicket; users: ZendeskUser[] };
            const ticket = data.ticket;
            const users = data.users || [];

            const requester = users.find((u) => u.id === ticket.requester_id);
            const assignee = ticket.assignee_id ? users.find((u) => u.id === ticket.assignee_id) : null;

            return {
              id: ticket.id,
              subject: ticket.subject,
              description: ticket.description,
              status: ticket.status,
              priority: ticket.priority,
              requester: requester ? { id: requester.id, name: requester.name, email: requester.email } : null,
              assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
              tags: ticket.tags,
              createdAt: ticket.created_at,
              updatedAt: ticket.updated_at,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_ticket_comments: tool({
        description: 'Get comments/conversation for a ticket',
        inputSchema: z.object({
          ticketId: z.number().describe('Zendesk ticket ID'),
        }),
        execute: async ({ ticketId }: { ticketId: number }) => {
          try {
            const response = await withRetry(
              () => zendeskFetch(`/tickets/${ticketId}/comments.json?include=users`),
              { integrationId: this.id, operation: 'get ticket comments' },
            );

            const data = await response.json() as { comments: ZendeskComment[]; users: ZendeskUser[] };
            const users = data.users || [];

            return {
              ticketId,
              comments: data.comments.map((comment) => {
                const author = users.find((u) => u.id === comment.author_id);
                return {
                  id: comment.id,
                  body: comment.body,
                  author: author ? { id: author.id, name: author.name, email: author.email } : null,
                  public: comment.public,
                  createdAt: comment.created_at,
                };
              }),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      create_ticket: tool({
        description: 'Create a new support ticket',
        inputSchema: z.object({
          subject: z.string().describe('Ticket subject'),
          description: z.string().describe('Ticket description'),
          requesterId: z.number().optional().describe('Requester user ID'),
          assigneeId: z.number().optional().describe('Assignee user ID'),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Ticket priority'),
          tags: z.array(z.string()).optional().describe('Tags to apply'),
        }),
        execute: async ({
          subject,
          description,
          requesterId,
          assigneeId,
          priority,
          tags,
        }: {
          subject: string;
          description: string;
          requesterId?: number;
          assigneeId?: number;
          priority?: string;
          tags?: string[];
        }) => {
          try {
            const ticketData: Record<string, unknown> = {
              subject,
              comment: { body: description },
            };
            if (requesterId) ticketData.requester_id = requesterId;
            if (assigneeId) ticketData.assignee_id = assigneeId;
            if (priority) ticketData.priority = priority;
            if (tags) ticketData.tags = tags;

            const response = await withRetry(
              () => zendeskFetch('/tickets.json', {
                method: 'POST',
                body: JSON.stringify({ ticket: ticketData }),
              }),
              { integrationId: this.id, operation: 'create ticket' },
            );

            const data = await response.json() as { ticket: ZendeskTicket };

            return {
              id: data.ticket.id,
              subject: data.ticket.subject,
              status: data.ticket.status,
              message: `Ticket #${data.ticket.id} created successfully`,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      update_ticket: tool({
        description: 'Update an existing ticket',
        inputSchema: z.object({
          ticketId: z.number().describe('Ticket ID to update'),
          status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional().describe('New status'),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('New priority'),
          assigneeId: z.number().optional().describe('New assignee'),
          comment: z.string().optional().describe('Comment to add'),
          tags: z.array(z.string()).optional().describe('Tags to set'),
        }),
        execute: async ({
          ticketId,
          status,
          priority,
          assigneeId,
          comment,
          tags,
        }: {
          ticketId: number;
          status?: string;
          priority?: string;
          assigneeId?: number;
          comment?: string;
          tags?: string[];
        }) => {
          try {
            const ticketData: Record<string, unknown> = {};
            if (status) ticketData.status = status;
            if (priority) ticketData.priority = priority;
            if (assigneeId) ticketData.assignee_id = assigneeId;
            if (comment) ticketData.comment = { body: comment, public: false };
            if (tags) ticketData.tags = tags;

            const response = await withRetry(
              () => zendeskFetch(`/tickets/${ticketId}.json`, {
                method: 'PUT',
                body: JSON.stringify({ ticket: ticketData }),
              }),
              { integrationId: this.id, operation: 'update ticket' },
            );

            const data = await response.json() as { ticket: ZendeskTicket };

            return {
              id: data.ticket.id,
              subject: data.ticket.subject,
              status: data.ticket.status,
              priority: data.ticket.priority,
              message: `Ticket #${data.ticket.id} updated successfully`,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      search_users: tool({
        description: 'Search for users in Zendesk',
        inputSchema: z.object({
          query: z.string().describe('Search by name or email'),
          role: z.enum(['end-user', 'agent', 'admin']).optional().describe('Filter by role'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 25)'),
        }),
        execute: async ({ query, role, limit }: { query: string; role?: string; limit?: number }) => {
          try {
            const searchParts = ['type:user', query];
            if (role) searchParts.push(`role:${role}`);

            const searchQuery = encodeURIComponent(searchParts.join(' '));
            const response = await withRetry(
              () => zendeskFetch(`/search.json?query=${searchQuery}&per_page=${limit || 25}`),
              { integrationId: this.id, operation: 'search users' },
            );

            const data = await response.json() as { results: ZendeskUser[]; count: number };

            return {
              total: data.count,
              users: data.results.map((user) => ({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_satisfaction_ratings: tool({
        description: 'Get customer satisfaction ratings',
        inputSchema: z.object({
          startDate: z.string().optional().describe('Start date (ISO format)'),
          endDate: z.string().optional().describe('End date (ISO format)'),
          score: z.enum(['good', 'bad']).optional().describe('Filter by score'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 100)'),
        }),
        execute: async ({
          startDate,
          endDate,
          score,
          limit,
        }: {
          startDate?: string;
          endDate?: string;
          score?: string;
          limit?: number;
        }) => {
          try {
            let path = `/satisfaction_ratings.json?per_page=${limit || 100}`;
            if (startDate) path += `&start_time=${new Date(startDate).toISOString()}`;
            if (endDate) path += `&end_time=${new Date(endDate).toISOString()}`;
            if (score) path += `&score=${score}`;

            const response = await withRetry(
              () => zendeskFetch(path),
              { integrationId: this.id, operation: 'get satisfaction ratings' },
            );

            const data = await response.json() as {
              satisfaction_ratings: Array<{
                id: number;
                ticket_id: number;
                score: string;
                comment: string;
                created_at: string;
              }>;
            };

            const ratings = data.satisfaction_ratings || [];
            const goodCount = ratings.filter((r) => r.score === 'good').length;
            const badCount = ratings.filter((r) => r.score === 'bad').length;

            return {
              totalRatings: ratings.length,
              goodRatings: goodCount,
              badRatings: badCount,
              satisfactionScore: ratings.length > 0 ? Math.round((goodCount / ratings.length) * 100) : null,
              ratings: ratings.slice(0, 10).map((r) => ({
                ticketId: r.ticket_id,
                score: r.score,
                comment: r.comment,
                createdAt: r.created_at,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_ticket_metrics: tool({
        description: 'Get ticket metrics and statistics',
        inputSchema: z.object({
          startDate: z.string().optional().describe('Start date (ISO format)'),
          endDate: z.string().optional().describe('End date (ISO format)'),
        }),
        execute: async ({ startDate, endDate }: { startDate?: string; endDate?: string }) => {
          try {
            // Get tickets solved in the period
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const end = endDate || new Date().toISOString().split('T')[0];

            const query = encodeURIComponent(`type:ticket solved>${start} solved<${end}`);
            const response = await withRetry(
              () => zendeskFetch(`/search.json?query=${query}&per_page=100`),
              { integrationId: this.id, operation: 'get ticket metrics' },
            );

            const data = await response.json() as { results: ZendeskTicket[]; count: number };

            // Group by assignee
            const byAssignee = data.results.reduce((acc, ticket) => {
              const key = ticket.assignee_id || 0;
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {} as Record<number, number>);

            // Group by priority
            const byPriority = data.results.reduce((acc, ticket) => {
              const key = ticket.priority || 'none';
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);

            return {
              period: { startDate: start, endDate: end },
              totalSolved: data.count,
              byAssignee: Object.entries(byAssignee).map(([id, count]) => ({
                assigneeId: id === '0' ? null : parseInt(id),
                ticketsSolved: count,
              })),
              byPriority,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
