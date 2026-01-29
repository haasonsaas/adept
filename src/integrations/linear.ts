import { tool } from 'ai';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { createToolError } from '../lib/errors.js';

export class LinearIntegration extends BaseIntegration {
  id = 'linear';
  name = 'Linear';
  description = 'Access Linear - issues, projects, and roadmaps';
  icon = '🔷';

  isEnabled(): boolean {
    return !!process.env.LINEAR_API_KEY;
  }

  getTools() {
    return {
      search_issues: tool({
        description: 'Search for issues in Linear',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          teamId: z.string().optional().describe('Filter by team ID'),
          state: z.string().optional().describe('Filter by state (e.g., "In Progress", "Done")'),
          assigneeId: z.string().optional().describe('Filter by assignee'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: {
          query: string;
          teamId?: string;
          state?: string;
          assigneeId?: string;
          limit?: number;
        }) => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
            hint: 'Set LINEAR_API_KEY and implement the API calls',
          });
        },
      }),

      get_issue: tool({
        description: 'Get detailed information about a specific issue',
        inputSchema: z.object({
          issueId: z.string().describe('Linear issue ID or identifier (e.g., "ENG-123")'),
        }),
        execute: async (_params: { issueId: string }) => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      create_issue: tool({
        description: 'Create a new issue in Linear',
        inputSchema: z.object({
          title: z.string().describe('Issue title'),
          description: z.string().optional().describe('Issue description in markdown'),
          teamId: z.string().describe('Team ID'),
          assigneeId: z.string().optional().describe('Assignee user ID'),
          priority: z.number().int().min(0).max(4).optional().describe('Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)'),
          labelIds: z.array(z.string()).optional().describe('Label IDs to apply'),
          projectId: z.string().optional().describe('Project ID'),
        }),
        execute: async (_params: {
          title: string;
          description?: string;
          teamId: string;
          assigneeId?: string;
          priority?: number;
          labelIds?: string[];
          projectId?: string;
        }) => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      update_issue: tool({
        description: 'Update an existing Linear issue',
        inputSchema: z.object({
          issueId: z.string().describe('Issue ID to update'),
          title: z.string().optional().describe('New title'),
          description: z.string().optional().describe('New description'),
          stateId: z.string().optional().describe('New state ID'),
          assigneeId: z.string().optional().describe('New assignee ID'),
          priority: z.number().int().min(0).max(4).optional().describe('New priority'),
        }),
        execute: async (_params: {
          issueId: string;
          title?: string;
          description?: string;
          stateId?: string;
          assigneeId?: string;
          priority?: number;
        }) => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_projects: tool({
        description: 'List projects in Linear',
        inputSchema: z.object({
          teamId: z.string().optional().describe('Filter by team ID'),
          limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
        }),
        execute: async (_params: { teamId?: string; limit?: number }) => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_project: tool({
        description: 'Get detailed information about a project',
        inputSchema: z.object({
          projectId: z.string().describe('Project ID'),
        }),
        execute: async (_params: { projectId: string }) => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      list_teams: tool({
        description: 'List all teams in the workspace',
        inputSchema: z.object({}),
        execute: async () => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),

      get_roadmap: tool({
        description: 'Get roadmap information including milestones',
        inputSchema: z.object({
          teamId: z.string().optional().describe('Filter by team ID'),
        }),
        execute: async (_params: { teamId?: string }) => {
          return createToolError(this.id, 'Linear integration not yet implemented', {
            kind: 'upstream',
          });
        },
      }),
    };
  }
}
