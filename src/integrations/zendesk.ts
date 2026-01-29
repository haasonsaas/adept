import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class ZendeskIntegration extends BaseIntegration {
  id = 'zendesk';
  name = 'Zendesk';
  description = 'Access Zendesk - tickets, users, and satisfaction data';
  icon = '🎫';

  isEnabled(): boolean {
    return !!(
      process.env.ZENDESK_SUBDOMAIN &&
      (process.env.ZENDESK_API_TOKEN || process.env.ZENDESK_OAUTH_TOKEN)
    );
  }

  getTools() {
    return {
      search_tickets: tool({
        description: 'Search for tickets in Zendesk',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional()
            .describe('Filter by status'),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
            .describe('Filter by priority'),
          assigneeId: z.string().optional().describe('Filter by assignee'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          query: string;
          status?: string;
          priority?: string;
          assigneeId?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set ZENDESK_SUBDOMAIN and ZENDESK_API_TOKEN',
          });
        },
      }),

      get_ticket: tool({
        description: 'Get details of a specific ticket',
        inputSchema: z.object({
          ticketId: z.string().describe('Zendesk ticket ID'),
        }),
        execute: async (_params: { ticketId: string }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_ticket_comments: tool({
        description: 'Get comments/conversation for a ticket',
        inputSchema: z.object({
          ticketId: z.string().describe('Zendesk ticket ID'),
        }),
        execute: async (_params: { ticketId: string }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      create_ticket: tool({
        description: 'Create a new support ticket',
        inputSchema: z.object({
          subject: z.string().describe('Ticket subject'),
          description: z.string().describe('Ticket description'),
          requesterId: z.string().optional().describe('Requester user ID'),
          assigneeId: z.string().optional().describe('Assignee user ID'),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
            .describe('Ticket priority'),
          tags: z.array(z.string()).optional().describe('Tags to apply'),
        }),
        execute: async (_params: {
          subject: string;
          description: string;
          requesterId?: string;
          assigneeId?: string;
          priority?: string;
          tags?: string[];
        }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      update_ticket: tool({
        description: 'Update an existing ticket',
        inputSchema: z.object({
          ticketId: z.string().describe('Ticket ID to update'),
          status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional()
            .describe('New status'),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
            .describe('New priority'),
          assigneeId: z.string().optional().describe('New assignee'),
          comment: z.string().optional().describe('Comment to add'),
          tags: z.array(z.string()).optional().describe('Tags to set'),
        }),
        execute: async (_params: {
          ticketId: string;
          status?: string;
          priority?: string;
          assigneeId?: string;
          comment?: string;
          tags?: string[];
        }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      search_users: tool({
        description: 'Search for users in Zendesk',
        inputSchema: z.object({
          query: z.string().describe('Search by name or email'),
          role: z.enum(['end-user', 'agent', 'admin']).optional().describe('Filter by role'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query: string; role?: string; limit?: number }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_satisfaction_ratings: tool({
        description: 'Get customer satisfaction ratings',
        inputSchema: z.object({
          startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
          endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
          score: z.enum(['good', 'bad']).optional().describe('Filter by score'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          startDate?: string;
          endDate?: string;
          score?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_ticket_metrics: tool({
        description: 'Get ticket metrics and statistics',
        inputSchema: z.object({
          startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
          endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
        }),
        execute: async (_params: { startDate?: string; endDate?: string }) => {
          return createToolError(this.id, 'Zendesk integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
