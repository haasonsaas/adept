import { tool } from 'ai';
import Stripe from 'stripe';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

const getStripeClient = (): Stripe | null => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) return null;

  return new Stripe(apiKey);
};

export class StripeIntegration extends BaseIntegration {
  id = 'stripe';
  name = 'Stripe';
  description = 'Access Stripe for payments, subscriptions, and invoices';
  icon = '💳';

  isEnabled(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  getTools() {
    return {
      list_customers: tool({
        description: 'List customers with optional filters',
        inputSchema: z.object({
          email: z.string().optional().describe('Filter by email'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ email, limit }: { email?: string; limit?: number }) => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const params: Stripe.CustomerListParams = { limit: limit || 10 };
            if (email) params.email = email;

            const customers = await withRetry(
              () => stripe.customers.list(params),
              { integrationId: this.id, operation: 'list customers' },
            );

            return {
              customers: customers.data.map((c) => ({
                id: c.id,
                name: c.name,
                email: c.email,
                phone: c.phone,
                balance: c.balance,
                currency: c.currency,
                created: new Date(c.created * 1000).toISOString(),
                metadata: c.metadata,
              })),
              hasMore: customers.has_more,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_customer: tool({
        description: 'Get detailed information about a customer',
        inputSchema: z.object({
          customerId: z.string().describe('Stripe customer ID'),
        }),
        execute: async ({ customerId }: { customerId: string }) => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const customer = await withRetry(
              () => stripe.customers.retrieve(customerId, { expand: ['subscriptions'] }),
              { integrationId: this.id, operation: 'get customer' },
            );

            if ((customer as Stripe.DeletedCustomer).deleted) {
              return { error: 'Customer has been deleted' };
            }

            const c = customer as Stripe.Customer;

            return {
              id: c.id,
              name: c.name,
              email: c.email,
              phone: c.phone,
              balance: c.balance,
              currency: c.currency,
              delinquent: c.delinquent,
              description: c.description,
              created: new Date(c.created * 1000).toISOString(),
              subscriptions: c.subscriptions?.data.map((sub) => ({
                id: sub.id,
                status: sub.status,
                items: sub.items.data.map((item) => ({
                  id: item.id,
                  priceId: item.price.id,
                  quantity: item.quantity,
                })),
              })),
              metadata: c.metadata,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_subscriptions: tool({
        description: 'List subscriptions with optional filters',
        inputSchema: z.object({
          customerId: z.string().optional().describe('Filter by customer ID'),
          status: z.enum(['active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'all']).optional().describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ customerId, status, limit }: { customerId?: string; status?: string; limit?: number }) => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const params: Stripe.SubscriptionListParams = { limit: limit || 10 };
            if (customerId) params.customer = customerId;
            if (status && status !== 'all') params.status = status as Stripe.SubscriptionListParams.Status;

            const subscriptions = await withRetry(
              () => stripe.subscriptions.list(params),
              { integrationId: this.id, operation: 'list subscriptions' },
            );

            return {
              subscriptions: subscriptions.data.map((sub) => ({
                id: sub.id,
                customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
                status: sub.status,
                cancelAtPeriodEnd: sub.cancel_at_period_end,
                canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
                items: sub.items.data.map((item) => ({
                  id: item.id,
                  priceId: item.price.id,
                  productId: typeof item.price.product === 'string' ? item.price.product : item.price.product.id,
                  quantity: item.quantity,
                  unitAmount: item.price.unit_amount,
                  currency: item.price.currency,
                })),
                created: new Date(sub.created * 1000).toISOString(),
              })),
              hasMore: subscriptions.has_more,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_subscription: tool({
        description: 'Get detailed information about a subscription',
        inputSchema: z.object({
          subscriptionId: z.string().describe('Stripe subscription ID'),
        }),
        execute: async ({ subscriptionId }: { subscriptionId: string }) => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const sub = await withRetry(
              () => stripe.subscriptions.retrieve(subscriptionId, { expand: ['customer', 'default_payment_method'] }),
              { integrationId: this.id, operation: 'get subscription' },
            );

            const customer = typeof sub.customer === 'string' ? null : sub.customer as Stripe.Customer;

            return {
              id: sub.id,
              customer: customer
                ? { id: customer.id, name: customer.name, email: customer.email }
                : { id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id },
              status: sub.status,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
              items: sub.items.data.map((item) => ({
                id: item.id,
                priceId: item.price.id,
                productId: typeof item.price.product === 'string' ? item.price.product : item.price.product.id,
                quantity: item.quantity,
                unitAmount: item.price.unit_amount,
                currency: item.price.currency,
                interval: item.price.recurring?.interval,
              })),
              billingCycleAnchor: new Date(sub.billing_cycle_anchor * 1000).toISOString(),
              created: new Date(sub.created * 1000).toISOString(),
              metadata: sub.metadata,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_invoices: tool({
        description: 'List invoices with optional filters',
        inputSchema: z.object({
          customerId: z.string().optional().describe('Filter by customer ID'),
          status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).optional().describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ customerId, status, limit }: { customerId?: string; status?: string; limit?: number }) => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const params: Stripe.InvoiceListParams = { limit: limit || 10 };
            if (customerId) params.customer = customerId;
            if (status) params.status = status as Stripe.InvoiceListParams.Status;

            const invoices = await withRetry(
              () => stripe.invoices.list(params),
              { integrationId: this.id, operation: 'list invoices' },
            );

            return {
              invoices: invoices.data.map((inv) => ({
                id: inv.id,
                number: inv.number,
                customerId: typeof inv.customer === 'string' ? inv.customer : inv.customer?.id,
                status: inv.status,
                amountDue: inv.amount_due,
                amountPaid: inv.amount_paid,
                amountRemaining: inv.amount_remaining,
                currency: inv.currency,
                dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
                hostedInvoiceUrl: inv.hosted_invoice_url,
                created: new Date(inv.created * 1000).toISOString(),
              })),
              hasMore: invoices.has_more,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_charges: tool({
        description: 'List charges/payments with optional filters',
        inputSchema: z.object({
          customerId: z.string().optional().describe('Filter by customer ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ customerId, limit }: { customerId?: string; limit?: number }) => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const params: Stripe.ChargeListParams = { limit: limit || 10 };
            if (customerId) params.customer = customerId;

            const charges = await withRetry(
              () => stripe.charges.list(params),
              { integrationId: this.id, operation: 'list charges' },
            );

            return {
              charges: charges.data.map((charge) => ({
                id: charge.id,
                amount: charge.amount,
                amountRefunded: charge.amount_refunded,
                currency: charge.currency,
                status: charge.status,
                paid: charge.paid,
                refunded: charge.refunded,
                description: charge.description,
                customerId: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id,
                receiptUrl: charge.receipt_url,
                created: new Date(charge.created * 1000).toISOString(),
              })),
              hasMore: charges.has_more,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_balance: tool({
        description: 'Get the current Stripe account balance',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const balance = await withRetry(
              () => stripe.balance.retrieve(),
              { integrationId: this.id, operation: 'get balance' },
            );

            return {
              available: balance.available.map((b) => ({
                amount: b.amount,
                currency: b.currency,
                sourceTypes: b.source_types,
              })),
              pending: balance.pending.map((b) => ({
                amount: b.amount,
                currency: b.currency,
                sourceTypes: b.source_types,
              })),
              livemode: balance.livemode,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_revenue_summary: tool({
        description: 'Get a summary of revenue over a time period',
        inputSchema: z.object({
          daysBack: z.number().int().min(1).max(365).optional().describe('Days to look back (default: 30)'),
        }),
        execute: async ({ daysBack }: { daysBack?: number }) => {
          try {
            const stripe = getStripeClient();
            if (!stripe) throw new Error('Stripe is not configured');

            const days = daysBack || 30;
            const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

            const charges = await withRetry(
              () => stripe.charges.list({ created: { gte: since }, limit: 100 }),
              { integrationId: this.id, operation: 'get charges for summary' },
            );

            // Group by currency
            const byCurrency: Record<string, { total: number; count: number; refunded: number }> = {};

            for (const charge of charges.data) {
              if (!charge.paid) continue;
              const currency = charge.currency;
              if (!byCurrency[currency]) {
                byCurrency[currency] = { total: 0, count: 0, refunded: 0 };
              }
              byCurrency[currency].total += charge.amount;
              byCurrency[currency].count += 1;
              byCurrency[currency].refunded += charge.amount_refunded;
            }

            return {
              periodDays: days,
              byCurrency: Object.entries(byCurrency).map(([currency, data]) => ({
                currency,
                totalGross: data.total,
                totalRefunded: data.refunded,
                totalNet: data.total - data.refunded,
                chargeCount: data.count,
              })),
              totalCharges: charges.data.filter((c) => c.paid).length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
