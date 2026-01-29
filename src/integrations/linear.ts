import { tool } from 'ai';
import { LinearClient } from '@linear/sdk';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { toToolError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

const getLinearClient = (): LinearClient | null => {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return null;

  return new LinearClient({ apiKey });
};

export class LinearIntegration extends BaseIntegration {
  id = 'linear';
  name = 'Linear';
  description = 'Access Linear for issue tracking and project management';
  icon = '📐';

  isEnabled(): boolean {
    return !!process.env.LINEAR_API_KEY;
  }

  getTools() {
    return {
      search_issues: tool({
        description: 'Search for issues in Linear',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ query, limit }: { query: string; limit?: number }) => {
          try {
            const client = getLinearClient();
            if (!client) throw new Error('Linear is not configured');

            const result = await withRetry(
              () => client.searchIssues(query, { first: limit || 10 }),
              { integrationId: this.id, operation: 'search issues' },
            );

            const issues = result.nodes;

            // Fetch state and assignee for each issue
            const issuesWithDetails = await Promise.all(
              issues.map(async (issue) => {
                const state = await issue.state;
                const assignee = await issue.assignee;
                const team = await issue.team;

                return {
                  id: issue.id,
                  identifier: issue.identifier,
                  title: issue.title,
                  description: issue.description?.substring(0, 200),
                  state: state ? { id: state.id, name: state.name, color: state.color } : null,
                  assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
                  team: team ? { id: team.id, name: team.name, key: team.key } : null,
                  priority: issue.priority,
                  priorityLabel: issue.priorityLabel,
                  createdAt: issue.createdAt,
                  updatedAt: issue.updatedAt,
                };
              }),
            );

            return {
              issues: issuesWithDetails,
              total: result.totalCount,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_issue: tool({
        description: 'Get detailed information about a specific issue',
        inputSchema: z.object({
          issueId: z.string().describe('Linear issue ID or identifier (e.g., ENG-123)'),
        }),
        execute: async ({ issueId }: { issueId: string }) => {
          try {
            const client = getLinearClient();
            if (!client) throw new Error('Linear is not configured');

            const issue = await withRetry(
              () => client.issue(issueId),
              { integrationId: this.id, operation: 'get issue' },
            );

            const state = await issue.state;
            const assignee = await issue.assignee;
            const creator = await issue.creator;
            const team = await issue.team;
            const project = await issue.project;
            const labels = await issue.labels();

            return {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              description: issue.description,
              state: state ? { id: state.id, name: state.name, color: state.color, type: state.type } : null,
              assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
              creator: creator ? { id: creator.id, name: creator.name, email: creator.email } : null,
              team: team ? { id: team.id, name: team.name, key: team.key } : null,
              project: project ? { id: project.id, name: project.name } : null,
              labels: labels.nodes.map((l) => ({ id: l.id, name: l.name, color: l.color })),
              priority: issue.priority,
              priorityLabel: issue.priorityLabel,
              estimate: issue.estimate,
              url: issue.url,
              createdAt: issue.createdAt,
              updatedAt: issue.updatedAt,
              dueDate: issue.dueDate,
              completedAt: issue.completedAt,
              canceledAt: issue.canceledAt,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_issues: tool({
        description: 'List issues with optional filters',
        inputSchema: z.object({
          teamId: z.string().optional().describe('Filter by team ID'),
          assigneeId: z.string().optional().describe('Filter by assignee ID'),
          state: z.string().optional().describe('Filter by state name'),
          priority: z.number().int().min(0).max(4).optional().describe('Filter by priority (0=none, 1=urgent, 4=low)'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default: 25)'),
        }),
        execute: async ({
          teamId,
          assigneeId,
          state,
          priority,
          limit,
        }: {
          teamId?: string;
          assigneeId?: string;
          state?: string;
          priority?: number;
          limit?: number;
        }) => {
          try {
            const client = getLinearClient();
            if (!client) throw new Error('Linear is not configured');

            // Build filter
            interface IssueFilter {
              team?: { id: { eq: string } };
              assignee?: { id: { eq: string } };
              state?: { name: { eq: string } };
              priority?: { eq: number };
            }
            const filter: IssueFilter = {};

            if (teamId) filter.team = { id: { eq: teamId } };
            if (assigneeId) filter.assignee = { id: { eq: assigneeId } };
            if (state) filter.state = { name: { eq: state } };
            if (priority !== undefined) filter.priority = { eq: priority };

            const result = await withRetry(
              () => client.issues({ filter, first: limit || 25 }),
              { integrationId: this.id, operation: 'list issues' },
            );

            const issues = await Promise.all(
              result.nodes.map(async (issue) => {
                const issueState = await issue.state;
                const assignee = await issue.assignee;
                const team = await issue.team;

                return {
                  id: issue.id,
                  identifier: issue.identifier,
                  title: issue.title,
                  state: issueState ? { name: issueState.name, color: issueState.color } : null,
                  assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
                  team: team ? { key: team.key, name: team.name } : null,
                  priority: issue.priority,
                  priorityLabel: issue.priorityLabel,
                  createdAt: issue.createdAt,
                };
              }),
            );

            return {
              issues,
              pageInfo: {
                hasNextPage: result.pageInfo.hasNextPage,
                endCursor: result.pageInfo.endCursor,
              },
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_teams: tool({
        description: 'List all teams in the workspace',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const client = getLinearClient();
            if (!client) throw new Error('Linear is not configured');

            const result = await withRetry(
              () => client.teams(),
              { integrationId: this.id, operation: 'list teams' },
            );

            return {
              teams: result.nodes.map((team) => ({
                id: team.id,
                name: team.name,
                key: team.key,
                description: team.description,
                private: team.private,
                issueCount: team.issueCount,
              })),
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      list_projects: tool({
        description: 'List projects with optional filters',
        inputSchema: z.object({
          teamId: z.string().optional().describe('Filter by team ID'),
          state: z.enum(['planned', 'started', 'paused', 'completed', 'canceled']).optional().describe('Filter by state'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default: 25)'),
        }),
        execute: async ({ teamId, state, limit }: { teamId?: string; state?: string; limit?: number }) => {
          try {
            const client = getLinearClient();
            if (!client) throw new Error('Linear is not configured');

            interface ProjectFilter {
              accessibleTeams?: { id: { eq: string } };
              state?: { eq: string };
            }
            const filter: ProjectFilter = {};
            if (teamId) filter.accessibleTeams = { id: { eq: teamId } };
            if (state) filter.state = { eq: state };

            const result = await withRetry(
              () => client.projects({ filter, first: limit || 25 }),
              { integrationId: this.id, operation: 'list projects' },
            );

            const projects = await Promise.all(
              result.nodes.map(async (project) => {
                const lead = await project.lead;

                return {
                  id: project.id,
                  name: project.name,
                  description: project.description?.substring(0, 200),
                  state: project.state,
                  progress: project.progress,
                  lead: lead ? { id: lead.id, name: lead.name } : null,
                  startDate: project.startDate,
                  targetDate: project.targetDate,
                  url: project.url,
                };
              }),
            );

            return { projects };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_my_issues: tool({
        description: 'Get issues assigned to the authenticated user',
        inputSchema: z.object({
          includeCompleted: z.boolean().optional().describe('Include completed issues (default: false)'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default: 25)'),
        }),
        execute: async ({ includeCompleted, limit }: { includeCompleted?: boolean; limit?: number }) => {
          try {
            const client = getLinearClient();
            if (!client) throw new Error('Linear is not configured');

            const me = await withRetry(
              () => client.viewer,
              { integrationId: this.id, operation: 'get viewer' },
            );

            interface IssueFilter {
              assignee: { id: { eq: string } };
              completedAt?: { null: boolean };
            }
            const filter: IssueFilter = {
              assignee: { id: { eq: me.id } },
            };

            if (!includeCompleted) {
              filter.completedAt = { null: true };
            }

            const result = await withRetry(
              () => client.issues({ filter, first: limit || 25 }),
              { integrationId: this.id, operation: 'get my issues' },
            );

            const issues = await Promise.all(
              result.nodes.map(async (issue) => {
                const state = await issue.state;
                const team = await issue.team;

                return {
                  id: issue.id,
                  identifier: issue.identifier,
                  title: issue.title,
                  state: state ? { name: state.name, color: state.color } : null,
                  team: team ? { key: team.key, name: team.name } : null,
                  priority: issue.priority,
                  priorityLabel: issue.priorityLabel,
                  dueDate: issue.dueDate,
                  url: issue.url,
                };
              }),
            );

            return {
              user: { id: me.id, name: me.name, email: me.email },
              issues,
            };
          } catch (error) {
            return toToolError(this.id, error);
          }
        },
      }),

      get_team_cycles: tool({
        description: 'Get cycles (sprints) for a team',
        inputSchema: z.object({
          teamId: z.string().describe('Team ID'),
          limit: z.number().int().min(1).max(20).optional().describe('Max results (default: 5)'),
        }),
        execute: async ({ teamId, limit }: { teamId: string; limit?: number }) => {
          try {
            const client = getLinearClient();
            if (!client) throw new Error('Linear is not configured');

            const team = await withRetry(
              () => client.team(teamId),
              { integrationId: this.id, operation: 'get team' },
            );

            const cycles = await team.cycles({ first: limit || 5 });

            return {
              team: { id: team.id, name: team.name, key: team.key },
              cycles: cycles.nodes.map((cycle) => ({
                id: cycle.id,
                name: cycle.name,
                number: cycle.number,
                startsAt: cycle.startsAt,
                endsAt: cycle.endsAt,
                completedAt: cycle.completedAt,
                progress: cycle.progress,
                issueCountHistory: cycle.issueCountHistory,
                completedIssueCountHistory: cycle.completedIssueCountHistory,
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
