import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class GreenhouseIntegration extends BaseIntegration {
  id = 'greenhouse';
  name = 'Greenhouse';
  description = 'Access Greenhouse - candidates, jobs, and interviews';
  icon = '🌱';

  isEnabled(): boolean {
    return !!process.env.GREENHOUSE_API_KEY;
  }

  getTools() {
    return {
      search_candidates: tool({
        description: 'Search for candidates in Greenhouse',
        inputSchema: z.object({
          query: z.string().optional().describe('Search by name or email'),
          jobId: z.string().optional().describe('Filter by job'),
          stage: z.string().optional().describe('Filter by stage'),
          status: z.enum(['active', 'hired', 'rejected']).optional().describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          query?: string;
          jobId?: string;
          stage?: string;
          status?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set GREENHOUSE_API_KEY and implement the API calls',
          });
        },
      }),

      get_candidate: tool({
        description: 'Get detailed information about a candidate',
        inputSchema: z.object({
          candidateId: z.string().describe('Greenhouse candidate ID'),
        }),
        execute: async (_params: { candidateId: string }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_jobs: tool({
        description: 'List open jobs in Greenhouse',
        inputSchema: z.object({
          status: z.enum(['open', 'closed', 'draft']).optional().describe('Filter by status'),
          department: z.string().optional().describe('Filter by department'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          status?: string;
          department?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_job: tool({
        description: 'Get detailed information about a job',
        inputSchema: z.object({
          jobId: z.string().describe('Greenhouse job ID'),
        }),
        execute: async (_params: { jobId: string }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_applications: tool({
        description: 'List job applications',
        inputSchema: z.object({
          jobId: z.string().optional().describe('Filter by job'),
          candidateId: z.string().optional().describe('Filter by candidate'),
          status: z.enum(['active', 'hired', 'rejected']).optional().describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          jobId?: string;
          candidateId?: string;
          status?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_interviews: tool({
        description: 'List scheduled interviews',
        inputSchema: z.object({
          candidateId: z.string().optional().describe('Filter by candidate'),
          applicationId: z.string().optional().describe('Filter by application'),
          startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
          endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          candidateId?: string;
          applicationId?: string;
          startDate?: string;
          endDate?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_interview: tool({
        description: 'Get details of a specific interview',
        inputSchema: z.object({
          interviewId: z.string().describe('Interview ID'),
        }),
        execute: async (_params: { interviewId: string }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_pipeline_summary: tool({
        description: 'Get hiring pipeline summary by job or overall',
        inputSchema: z.object({
          jobId: z.string().optional().describe('Filter by job'),
        }),
        execute: async (_params: { jobId?: string }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_offers: tool({
        description: 'List job offers',
        inputSchema: z.object({
          status: z.enum(['pending', 'accepted', 'rejected', 'deprecated']).optional()
            .describe('Filter by status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { status?: string; limit?: number }) => {
          return createToolError(this.id, 'Greenhouse integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
