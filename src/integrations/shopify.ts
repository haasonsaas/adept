import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class ShopifyIntegration extends BaseIntegration {
  id = 'shopify';
  name = 'Shopify';
  description = 'Access Shopify - orders, inventory, and products';
  icon = '🛍️';

  isEnabled(): boolean {
    return !!(process.env.SHOPIFY_SHOP_NAME && process.env.SHOPIFY_ACCESS_TOKEN);
  }

  getTools() {
    return {
      list_orders: tool({
        description: 'List orders from Shopify',
        inputSchema: z.object({
          status: z.enum(['open', 'closed', 'cancelled', 'any']).optional()
            .describe('Filter by order status'),
          financialStatus: z.enum(['pending', 'paid', 'refunded', 'any']).optional()
            .describe('Filter by financial status'),
          createdAtMin: z.string().optional().describe('Orders created after (ISO date)'),
          createdAtMax: z.string().optional().describe('Orders created before (ISO date)'),
          limit: z.number().int().min(1).max(250).optional().describe('Max results (default: 50)'),
        }),
        execute: async (_params: {
          status?: string;
          financialStatus?: string;
          createdAtMin?: string;
          createdAtMax?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set SHOPIFY_SHOP_NAME and SHOPIFY_ACCESS_TOKEN',
          });
        },
      }),

      get_order: tool({
        description: 'Get details of a specific order',
        inputSchema: z.object({
          orderId: z.string().describe('Shopify order ID'),
        }),
        execute: async (_params: { orderId: string }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_products: tool({
        description: 'List products from Shopify',
        inputSchema: z.object({
          status: z.enum(['active', 'archived', 'draft']).optional()
            .describe('Filter by product status'),
          productType: z.string().optional().describe('Filter by product type'),
          vendor: z.string().optional().describe('Filter by vendor'),
          limit: z.number().int().min(1).max(250).optional().describe('Max results (default: 50)'),
        }),
        execute: async (_params: {
          status?: string;
          productType?: string;
          vendor?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_product: tool({
        description: 'Get details of a specific product',
        inputSchema: z.object({
          productId: z.string().describe('Shopify product ID'),
        }),
        execute: async (_params: { productId: string }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_inventory: tool({
        description: 'List inventory levels across locations',
        inputSchema: z.object({
          locationId: z.string().optional().describe('Filter by location'),
          limit: z.number().int().min(1).max(250).optional().describe('Max results (default: 50)'),
        }),
        execute: async (_params: { locationId?: string; limit?: number }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_inventory_item: tool({
        description: 'Get inventory details for a specific item',
        inputSchema: z.object({
          inventoryItemId: z.string().describe('Inventory item ID'),
        }),
        execute: async (_params: { inventoryItemId: string }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_customers: tool({
        description: 'List customers from Shopify',
        inputSchema: z.object({
          query: z.string().optional().describe('Search by name or email'),
          limit: z.number().int().min(1).max(250).optional().describe('Max results (default: 50)'),
        }),
        execute: async (_params: { query?: string; limit?: number }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_sales_summary: tool({
        description: 'Get sales summary for a time period',
        inputSchema: z.object({
          startDate: z.string().describe('Start date (YYYY-MM-DD)'),
          endDate: z.string().describe('End date (YYYY-MM-DD)'),
        }),
        execute: async (_params: { startDate: string; endDate: string }) => {
          return createToolError(this.id, 'Shopify integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
