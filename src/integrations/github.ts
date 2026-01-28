import { tool } from 'ai';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { tokenStore } from '../lib/token-store.js';
import type { SearchResult } from '../types/index.js';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const resolveRepo = (repoInput?: string) => {
  if (repoInput) {
    const [owner, repo] = repoInput.split('/');
    if (owner && repo) {
      return { owner, repo };
    }
  }

  const owner = process.env.GITHUB_DEFAULT_OWNER;
  const repo = process.env.GITHUB_DEFAULT_REPO;
  if (owner && repo) {
    return { owner, repo };
  }

  return null;
};

const getOctokit = async () => {
  const stored = await tokenStore.getTokens<{ accessToken?: string }>('github');
  const token = stored?.accessToken || process.env.GITHUB_OAUTH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('Missing GITHUB_OAUTH_TOKEN or GITHUB_TOKEN');
  }

  const baseUrl = process.env.GITHUB_BASE_URL;
  return new Octokit({ auth: token, baseUrl: baseUrl || undefined });
};

export class GitHubIntegration extends BaseIntegration {
  id = 'github';
  name = 'GitHub';
  description = 'Access GitHub repositories, issues, and pull requests';
  icon = '🐙';

  isEnabled(): boolean {
    return Boolean(process.env.GITHUB_OAUTH_TOKEN || process.env.GITHUB_TOKEN || tokenStore.hasTokens(this.id));
  }

  getTools() {
    return {
      search_issues: tool({
        description: 'Search GitHub issues or pull requests with optional repo scoping',
        inputSchema: z.object({
          query: z.string().describe('Search query for issues or pull requests'),
          repo: z.string().optional().describe('Optional repo in owner/repo format'),
          state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by state'),
          type: z.enum(['issue', 'pull_request', 'all']).optional().describe('Search issues, PRs, or both'),
          limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 10)'),
        }),
        execute: async ({ query, repo, state, type, limit }: {
          query: string;
          repo?: string;
          state?: 'open' | 'closed' | 'all';
          type?: 'issue' | 'pull_request' | 'all';
          limit?: number;
        }) => {
          try {
            const octokit = await getOctokit();
            const qualifiers: string[] = [];
            const resolved = resolveRepo(repo);

            if (resolved) {
              qualifiers.push(`repo:${resolved.owner}/${resolved.repo}`);
            }

            if (state && state !== 'all') {
              qualifiers.push(`state:${state}`);
            }

            if (type === 'issue') {
              qualifiers.push('is:issue');
            } else if (type === 'pull_request') {
              qualifiers.push('is:pr');
            }

            const q = [query, ...qualifiers].join(' ').trim();
            const perPage = clamp(limit ?? 10, 1, 50);
            const result = await octokit.search.issuesAndPullRequests({ q, per_page: perPage });

            return {
              total: result.data.total_count,
              items: result.data.items.map((item) => ({
                id: item.id,
                number: item.number,
                title: item.title,
                url: item.html_url,
                state: item.state,
                author: item.user?.login,
                labels: item.labels
                  .map((label) => (typeof label === 'string' ? label : label.name ?? ''))
                  .filter((label) => label.length > 0),
                repo: item.repository_url?.split('repos/')[1],
                updatedAt: item.updated_at,
              })),
            };
          } catch (error) {
            return { error: formatError(error) };
          }
        },
      }),

      list_pull_requests: tool({
        description: 'List pull requests for a repository',
        inputSchema: z.object({
          repo: z.string().optional().describe('Repo in owner/repo format (defaults to env config)'),
          state: z.enum(['open', 'closed', 'all']).optional().describe('PR state'),
          limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 10)'),
        }),
        execute: async ({ repo, state, limit }: {
          repo?: string;
          state?: 'open' | 'closed' | 'all';
          limit?: number;
        }) => {
          try {
            const octokit = await getOctokit();
            const resolved = resolveRepo(repo);

            if (!resolved) {
              return { error: 'Provide repo or set GITHUB_DEFAULT_OWNER/GITHUB_DEFAULT_REPO.' };
            }

            const perPage = clamp(limit ?? 10, 1, 50);
            const result = await octokit.pulls.list({
              owner: resolved.owner,
              repo: resolved.repo,
              state: state ?? 'open',
              per_page: perPage,
            });

            return {
              repo: `${resolved.owner}/${resolved.repo}`,
              pullRequests: result.data.map((pr) => ({
                id: pr.id,
                number: pr.number,
                title: pr.title,
                url: pr.html_url,
                state: pr.state,
                author: pr.user?.login,
                createdAt: pr.created_at,
                updatedAt: pr.updated_at,
              })),
            };
          } catch (error) {
            return { error: formatError(error) };
          }
        },
      }),

      get_repo_summary: tool({
        description: 'Get summary information for a GitHub repository',
        inputSchema: z.object({
          repo: z.string().optional().describe('Repo in owner/repo format (defaults to env config)'),
        }),
        execute: async ({ repo }: { repo?: string }) => {
          try {
            const octokit = await getOctokit();
            const resolved = resolveRepo(repo);

            if (!resolved) {
              return { error: 'Provide repo or set GITHUB_DEFAULT_OWNER/GITHUB_DEFAULT_REPO.' };
            }

            const result = await octokit.repos.get({
              owner: resolved.owner,
              repo: resolved.repo,
            });

            return {
              repo: result.data.full_name,
              description: result.data.description,
              defaultBranch: result.data.default_branch,
              stars: result.data.stargazers_count,
              forks: result.data.forks_count,
              openIssues: result.data.open_issues_count,
              visibility: result.data.visibility,
              updatedAt: result.data.updated_at,
              url: result.data.html_url,
            };
          } catch (error) {
            return { error: formatError(error) };
          }
        },
      }),
    };
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const octokit = await getOctokit();
      const result = await octokit.search.issuesAndPullRequests({
        q: query,
        per_page: 5,
      });

      return result.data.items.map((item) => ({
        integrationId: this.id,
        title: item.title,
        snippet: `${item.state} • ${item.user?.login ?? 'unknown'}`,
        url: item.html_url,
        metadata: {
          id: item.id,
          number: item.number,
          repo: item.repository_url?.split('repos/')[1],
        },
      }));
    } catch (error) {
      console.error('[GitHub] Search error:', error);
      return [];
    }
  }
}
