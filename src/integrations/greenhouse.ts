import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

const getGreenhouseConfig = (): string | null => {
  return process.env.GREENHOUSE_API_KEY || null;
};

const greenhouseFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const apiKey = getGreenhouseConfig();
  if (!apiKey) throw new Error('Greenhouse API key is not configured');

  const url = `https://harvest.greenhouse.io/v1${path}`;
  const auth = Buffer.from(`${apiKey}:`).toString('base64');

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Greenhouse API error (${response.status}): ${errorBody}`);
  }

  return response;
};

interface GreenhouseJob {
  id: number;
  name: string;
  status: string;
  departments: Array<{ id: number; name: string }>;
  offices: Array<{ id: number; name: string }>;
  opened_at: string;
  closed_at: string | null;
}

interface GreenhouseCandidate {
  id: number;
  first_name: string;
  last_name: string;
  company: string | null;
  title: string | null;
  emails: Array<{ value: string; type: string }>;
  phone_numbers: Array<{ value: string; type: string }>;
  applications: Array<{
    id: number;
    status: string;
    jobs: Array<{ id: number; name: string }>;
    current_stage: { id: number; name: string } | null;
  }>;
  created_at: string;
  updated_at: string;
}

interface GreenhouseApplication {
  id: number;
  candidate_id: number;
  status: string;
  source: { id: number; public_name: string } | null;
  jobs: Array<{ id: number; name: string }>;
  current_stage: { id: number; name: string } | null;
  applied_at: string;
  rejected_at: string | null;
}

export class GreenhouseIntegration extends BaseIntegration {
  id = 'greenhouse';
  name = 'Greenhouse';
  description = 'Access Greenhouse for recruiting and hiring data';
  icon = '🌱';

  isEnabled(): boolean {
    return !!getGreenhouseConfig();
  }

  getTools() {
    return {
      list_jobs: tool({
        description: 'List open jobs/positions',
        inputSchema: z.object({
          status: z.enum(['open', 'closed', 'all']).optional().describe('Job status (default: open)'),
          department: z.string().optional().describe('Filter by department name'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 50)'),
        }),
        execute: async ({ status, department, limit }: { status?: string; department?: string; limit?: number }) => {
          try {
            let path = `/jobs?per_page=${limit || 50}`;
            if (status && status !== 'all') path += `&status=${status}`;

            const response = await withRetry(
              () => greenhouseFetch(path),
              { integrationId: this.id, operation: 'list jobs' },
            );

            let jobs = await response.json() as GreenhouseJob[];

            if (department) {
              const lowerDept = department.toLowerCase();
              jobs = jobs.filter((j) =>
                j.departments.some((d) => d.name.toLowerCase().includes(lowerDept)),
              );
            }

            return {
              jobs: jobs.map((job) => ({
                id: job.id,
                name: job.name,
                status: job.status,
                departments: job.departments.map((d) => d.name),
                offices: job.offices.map((o) => o.name),
                openedAt: job.opened_at,
                closedAt: job.closed_at,
              })),
              total: jobs.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_job: tool({
        description: 'Get detailed information about a specific job',
        inputSchema: z.object({
          jobId: z.number().describe('Greenhouse job ID'),
        }),
        execute: async ({ jobId }: { jobId: number }) => {
          try {
            const response = await withRetry(
              () => greenhouseFetch(`/jobs/${jobId}`),
              { integrationId: this.id, operation: 'get job' },
            );

            const job = await response.json() as GreenhouseJob & {
              hiring_team: { hiring_managers: Array<{ user_id: number; first_name: string; last_name: string }> };
            };

            return {
              id: job.id,
              name: job.name,
              status: job.status,
              departments: job.departments.map((d) => d.name),
              offices: job.offices.map((o) => o.name),
              hiringManagers: job.hiring_team?.hiring_managers?.map((hm) => ({
                id: hm.user_id,
                name: `${hm.first_name} ${hm.last_name}`,
              })),
              openedAt: job.opened_at,
              closedAt: job.closed_at,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      search_candidates: tool({
        description: 'Search for candidates',
        inputSchema: z.object({
          query: z.string().optional().describe('Search query (name, email)'),
          jobId: z.number().optional().describe('Filter by job ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 25)'),
        }),
        execute: async ({ query, jobId, limit }: { query?: string; jobId?: number; limit?: number }) => {
          try {
            let path = `/candidates?per_page=${limit || 25}`;
            if (jobId) path += `&job_id=${jobId}`;

            const response = await withRetry(
              () => greenhouseFetch(path),
              { integrationId: this.id, operation: 'search candidates' },
            );

            let candidates = await response.json() as GreenhouseCandidate[];

            if (query) {
              const lowerQuery = query.toLowerCase();
              candidates = candidates.filter((c) =>
                c.first_name?.toLowerCase().includes(lowerQuery) ||
                c.last_name?.toLowerCase().includes(lowerQuery) ||
                c.emails?.some((e) => e.value.toLowerCase().includes(lowerQuery)),
              );
            }

            return {
              candidates: candidates.map((c) => ({
                id: c.id,
                name: `${c.first_name} ${c.last_name}`,
                email: c.emails?.[0]?.value,
                phone: c.phone_numbers?.[0]?.value,
                company: c.company,
                title: c.title,
                applications: c.applications?.map((app) => ({
                  id: app.id,
                  status: app.status,
                  job: app.jobs?.[0]?.name,
                  stage: app.current_stage?.name,
                })),
                createdAt: c.created_at,
              })),
              total: candidates.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_candidate: tool({
        description: 'Get detailed information about a specific candidate',
        inputSchema: z.object({
          candidateId: z.number().describe('Greenhouse candidate ID'),
        }),
        execute: async ({ candidateId }: { candidateId: number }) => {
          try {
            const response = await withRetry(
              () => greenhouseFetch(`/candidates/${candidateId}`),
              { integrationId: this.id, operation: 'get candidate' },
            );

            const c = await response.json() as GreenhouseCandidate;

            return {
              id: c.id,
              name: `${c.first_name} ${c.last_name}`,
              emails: c.emails?.map((e) => ({ value: e.value, type: e.type })),
              phones: c.phone_numbers?.map((p) => ({ value: p.value, type: p.type })),
              company: c.company,
              title: c.title,
              applications: c.applications?.map((app) => ({
                id: app.id,
                status: app.status,
                jobs: app.jobs?.map((j) => j.name),
                stage: app.current_stage?.name,
              })),
              createdAt: c.created_at,
              updatedAt: c.updated_at,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_applications: tool({
        description: 'List job applications with filters',
        inputSchema: z.object({
          jobId: z.number().optional().describe('Filter by job ID'),
          status: z.enum(['active', 'rejected', 'hired', 'all']).optional().describe('Application status'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 50)'),
        }),
        execute: async ({ jobId, status, limit }: { jobId?: number; status?: string; limit?: number }) => {
          try {
            let path = `/applications?per_page=${limit || 50}`;
            if (jobId) path += `&job_id=${jobId}`;
            if (status && status !== 'all') path += `&status=${status}`;

            const response = await withRetry(
              () => greenhouseFetch(path),
              { integrationId: this.id, operation: 'list applications' },
            );

            const applications = await response.json() as GreenhouseApplication[];

            return {
              applications: applications.map((app) => ({
                id: app.id,
                candidateId: app.candidate_id,
                status: app.status,
                source: app.source?.public_name,
                jobs: app.jobs?.map((j) => ({ id: j.id, name: j.name })),
                stage: app.current_stage?.name,
                appliedAt: app.applied_at,
                rejectedAt: app.rejected_at,
              })),
              total: applications.length,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_pipeline_stats: tool({
        description: 'Get pipeline statistics for a job',
        inputSchema: z.object({
          jobId: z.number().describe('Greenhouse job ID'),
        }),
        execute: async ({ jobId }: { jobId: number }) => {
          try {
            // Get job stages
            const stagesResponse = await withRetry(
              () => greenhouseFetch(`/jobs/${jobId}/stages`),
              { integrationId: this.id, operation: 'get job stages' },
            );
            const stages = await stagesResponse.json() as Array<{ id: number; name: string; priority: number }>;

            // Get applications for this job
            const appsResponse = await withRetry(
              () => greenhouseFetch(`/applications?job_id=${jobId}&per_page=500`),
              { integrationId: this.id, operation: 'get job applications' },
            );
            const applications = await appsResponse.json() as GreenhouseApplication[];

            // Count by stage
            const stageCounts: Record<number, number> = {};
            let activeCount = 0;
            let rejectedCount = 0;
            let hiredCount = 0;

            for (const app of applications) {
              if (app.status === 'active' && app.current_stage) {
                stageCounts[app.current_stage.id] = (stageCounts[app.current_stage.id] || 0) + 1;
                activeCount++;
              } else if (app.status === 'rejected') {
                rejectedCount++;
              } else if (app.status === 'hired') {
                hiredCount++;
              }
            }

            return {
              jobId,
              totalApplications: applications.length,
              active: activeCount,
              rejected: rejectedCount,
              hired: hiredCount,
              byStage: stages
                .sort((a, b) => a.priority - b.priority)
                .map((stage) => ({
                  stageId: stage.id,
                  stageName: stage.name,
                  count: stageCounts[stage.id] || 0,
                })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_hiring_summary: tool({
        description: 'Get a summary of hiring activity',
        inputSchema: z.object({
          daysBack: z.number().int().min(1).max(365).optional().describe('Days to look back (default: 30)'),
        }),
        execute: async ({ daysBack }: { daysBack?: number }) => {
          try {
            const days = daysBack || 30;
            const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

            // Get recent applications
            const response = await withRetry(
              () => greenhouseFetch(`/applications?per_page=500&created_after=${sinceDate}`),
              { integrationId: this.id, operation: 'get recent applications' },
            );
            const applications = await response.json() as GreenhouseApplication[];

            // Group by source
            const bySource: Record<string, number> = {};
            const byStatus: Record<string, number> = {};
            const byJob: Record<string, number> = {};

            for (const app of applications) {
              const source = app.source?.public_name || 'Unknown';
              bySource[source] = (bySource[source] || 0) + 1;

              byStatus[app.status] = (byStatus[app.status] || 0) + 1;

              const jobName = app.jobs?.[0]?.name || 'Unknown';
              byJob[jobName] = (byJob[jobName] || 0) + 1;
            }

            return {
              periodDays: days,
              totalApplications: applications.length,
              byStatus,
              bySource: Object.entries(bySource)
                .map(([source, count]) => ({ source, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
              byJob: Object.entries(byJob)
                .map(([job, count]) => ({ job, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),
    };
  }
}
