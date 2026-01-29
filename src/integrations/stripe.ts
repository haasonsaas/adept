import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class StripeIntegration extends BaseIntegration {
  id = 'stripe';
  name = 'Stripe';
  description = 'Access Stripe - subscriptions, invoices, and payments';
  icon = '💳';

  isEnabled(): boolean {
    return !!process.env.STRIPE_API_KEY;
  }

  getTools() {
    return {
      search_customers: tool({
        description: 'Search for customers in Stripe',
        inputSchema: z.object({
          query: z.string().describe('Search by email, name, or customer ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { query: string; limit?: number }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set STRIPE_API_KEY and implement the API calls',
          });
        },
      }),

      get_customer: tool({
        description: 'Get detailed information about a Stripe customer',
        inputSchema: z.object({
          customerId: z.string().describe('Stripe customer ID (cus_xxx)'),
        }),
        execute: async (_params: { customerId: string }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_subscriptions: tool({
        description: 'List subscriptions, optionally filtered by customer or status',
        inputSchema: z.object({
          customerId: z.string().optional().describe('Filter by customer ID'),
          status: z.enum(['active', 'canceled', 'incomplete', 'past_due', 'trialing', 'all']).optional()
            .describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          customerId?: string;
          status?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_subscription: tool({
        description: 'Get details of a specific subscription',
        inputSchema: z.object({
          subscriptionId: z.string().describe('Stripe subscription ID (sub_xxx)'),
        }),
        execute: async (_params: { subscriptionId: string }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_invoices: tool({
        description: 'List invoices, optionally filtered by customer or status',
        inputSchema: z.object({
          customerId: z.string().optional().describe('Filter by customer ID'),
          status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).optional()
            .describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          customerId?: string;
          status?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_invoice: tool({
        description: 'Get details of a specific invoice',
        inputSchema: z.object({
          invoiceId: z.string().describe('Stripe invoice ID (in_xxx)'),
        }),
        execute: async (_params: { invoiceId: string }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_revenue_summary: tool({
        description: 'Get revenue summary for a time period',
        inputSchema: z.object({
          startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
          endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
        }),
        execute: async (_params: { startDate?: string; endDate?: string }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_products: tool({
        description: 'List all products in Stripe',
        inputSchema: z.object({
          active: z.boolean().optional().describe('Filter by active status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { active?: boolean; limit?: number }) => {
          return createToolError(this.id, 'Stripe integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
