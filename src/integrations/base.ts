import type { Integration, SearchResult } from '../types/index.js';
import type { ToolSet } from 'ai';

export abstract class BaseIntegration implements Integration {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  icon?: string;

  abstract isEnabled(): boolean;
  abstract getTools(): ToolSet;

  search?(query: string): Promise<SearchResult[]>;
}
