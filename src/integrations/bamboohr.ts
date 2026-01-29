import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class BambooHRIntegration extends BaseIntegration {
  id = 'bamboohr';
  name = 'BambooHR';
  description = 'Access BambooHR - employee data and org charts';
  icon = '🎋';

  isEnabled(): boolean {
    return !!(process.env.BAMBOOHR_SUBDOMAIN && process.env.BAMBOOHR_API_KEY);
  }

  getTools() {
    return {
      search_employees: tool({
        description: 'Search for employees in BambooHR',
        inputSchema: z.object({
          query: z.string().optional().describe('Search by name or email'),
          department: z.string().optional().describe('Filter by department'),
          location: z.string().optional().describe('Filter by location'),
          status: z.enum(['active', 'inactive', 'all']).optional().describe('Employment status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          query?: string;
          department?: string;
          location?: string;
          status?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set BAMBOOHR_SUBDOMAIN and BAMBOOHR_API_KEY',
          });
        },
      }),

      get_employee: tool({
        description: 'Get detailed information about an employee',
        inputSchema: z.object({
          employeeId: z.string().describe('BambooHR employee ID'),
          fields: z.array(z.string()).optional().describe('Specific fields to retrieve'),
        }),
        execute: async (_params: { employeeId: string; fields?: string[] }) => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_directory: tool({
        description: 'Get the employee directory',
        inputSchema: z.object({
          department: z.string().optional().describe('Filter by department'),
        }),
        execute: async (_params: { department?: string }) => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_org_chart: tool({
        description: 'Get the organizational chart',
        inputSchema: z.object({
          employeeId: z.string().optional().describe('Root employee ID (default: company)'),
        }),
        execute: async (_params: { employeeId?: string }) => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_time_off_requests: tool({
        description: 'List time off requests',
        inputSchema: z.object({
          employeeId: z.string().optional().describe('Filter by employee'),
          status: z.enum(['approved', 'pending', 'denied', 'canceled']).optional()
            .describe('Filter by status'),
          startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
          endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
        }),
        execute: async (_params: {
          employeeId?: string;
          status?: string;
          startDate?: string;
          endDate?: string;
        }) => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_whos_out: tool({
        description: 'Get employees who are out today or in a date range',
        inputSchema: z.object({
          startDate: z.string().optional().describe('Start date (YYYY-MM-DD, default: today)'),
          endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
        }),
        execute: async (_params: { startDate?: string; endDate?: string }) => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_departments: tool({
        description: 'List all departments',
        inputSchema: z.object({}),
        execute: async () => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_headcount_report: tool({
        description: 'Get headcount by department or location',
        inputSchema: z.object({
          groupBy: z.enum(['department', 'location', 'employmentStatus']).optional()
            .describe('Group results by'),
        }),
        execute: async (_params: { groupBy?: string }) => {
          return createToolError(this.id, 'BambooHR integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
