import { promises as fs } from 'node:fs';
import path from 'node:path';

export type IntegrationTokens = Record<string, Record<string, unknown>>;

const DEFAULT_STORE_PATH = path.join(process.cwd(), '.data', 'tokens.json');

const isErrno = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === 'object' && error !== null && 'code' in error;

class TokenStore {
  private cache: IntegrationTokens | null = null;
  private storePath = process.env.TOKEN_STORE_PATH || DEFAULT_STORE_PATH;

  async load(): Promise<void> {
    if (this.cache) {
      return;
    }

    try {
      const data = await fs.readFile(this.storePath, 'utf-8');
      this.cache = JSON.parse(data) as IntegrationTokens;
    } catch (error) {
      if (isErrno(error) && error.code === 'ENOENT') {
        this.cache = {};
        return;
      }
      throw error;
    }
  }

  hasTokens(integrationId: string): boolean {
    return Boolean(this.cache?.[integrationId]);
  }

  async getTokens<T extends Record<string, unknown>>(integrationId: string): Promise<T | null> {
    await this.load();
    return (this.cache?.[integrationId] as T | undefined) ?? null;
  }

  async setTokens<T extends Record<string, unknown>>(integrationId: string, tokens: T): Promise<void> {
    await this.load();
    if (!this.cache) {
      this.cache = {};
    }
    this.cache[integrationId] = tokens;
    await this.persist();
  }

  async clearTokens(integrationId: string): Promise<void> {
    await this.load();
    if (!this.cache) {
      this.cache = {};
    }
    delete this.cache[integrationId];
    await this.persist();
  }

  getStorePath(): string {
    return this.storePath;
  }

  private async persist(): Promise<void> {
    if (!this.cache) {
      return;
    }

    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(this.cache, null, 2));
  }
}

export const tokenStore = new TokenStore();
