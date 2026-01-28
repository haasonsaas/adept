import { tool } from 'ai';
import { google, drive_v3 } from 'googleapis';
import { z } from 'zod';
import { BaseIntegration } from './base.js';
import { tokenStore } from '../lib/token-store.js';
import type { SearchResult } from '../types/index.js';

const MAX_TEXT_CHARS = 20000;
const MAX_BINARY_BYTES = 1024 * 1024;

interface DriveAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
}

const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const sanitizeQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toBuffer = (data: unknown): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (typeof data === 'string') {
    return Buffer.from(data);
  }

  return Buffer.from('');
};

class DriveClient {
  private drive?: drive_v3.Drive;

  constructor(private config: DriveAuthConfig) {}

  getDrive(): drive_v3.Drive {
    if (!this.drive) {
      const auth = new google.auth.OAuth2(
        this.config.clientId,
        this.config.clientSecret,
        this.config.redirectUri,
      );

      auth.setCredentials({ refresh_token: this.config.refreshToken });

      this.drive = google.drive({ version: 'v3', auth });
    }

    return this.drive;
  }
}

export class GoogleDriveIntegration extends BaseIntegration {
  id = 'google_drive';
  name = 'Google Drive';
  description = 'Search and read Google Drive files and documents';
  icon = '📂';

  private client?: DriveClient;
  private clientKey?: string;

  isEnabled(): boolean {
    return Boolean(
      process.env.GOOGLE_DRIVE_CLIENT_ID &&
        process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
        process.env.GOOGLE_DRIVE_REDIRECT_URI &&
        (process.env.GOOGLE_DRIVE_REFRESH_TOKEN || tokenStore.hasTokens(this.id)),
    );
  }

  getTools() {
    return {
      drive_search_files: tool({
        description: 'Search Google Drive files by name or MIME type',
        inputSchema: z.object({
          query: z.string().optional().describe('Search term applied to file names'),
          mimeType: z.string().optional().describe('Filter by MIME type (e.g. application/pdf)'),
          includeTrashed: z.boolean().optional().describe('Include trashed files'),
          limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 10)'),
        }),
        execute: async ({ query, mimeType, includeTrashed, limit }: {
          query?: string;
          mimeType?: string;
          includeTrashed?: boolean;
          limit?: number;
        }) => {
          try {
            return await this.searchFiles({ query, mimeType, includeTrashed, limit: limit ?? 10 });
          } catch (error) {
            return { error: formatError(error) };
          }
        },
      }),

      drive_get_file_metadata: tool({
        description: 'Get metadata for a Google Drive file',
        inputSchema: z.object({
          fileId: z.string().describe('Google Drive file ID'),
        }),
        execute: async ({ fileId }: { fileId: string }) => {
          try {
            return await this.getFileMetadata(fileId);
          } catch (error) {
            return { error: formatError(error) };
          }
        },
      }),

      drive_read_file_text: tool({
        description: 'Read textual content from a Google Drive file or Google Doc',
        inputSchema: z.object({
          fileId: z.string().describe('Google Drive file ID'),
          maxChars: z.number().int().min(500).max(50000).optional().describe('Maximum characters to return'),
        }),
        execute: async ({ fileId, maxChars }: { fileId: string; maxChars?: number }) => {
          try {
            return await this.readFileText(fileId, maxChars ?? MAX_TEXT_CHARS);
          } catch (error) {
            return { error: formatError(error) };
          }
        },
      }),
    };
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const results = await this.searchFiles({ query, limit: 5 });
      const files = results.files ?? [];

      return files.map((file) => ({
        integrationId: this.id,
        title: file.name || 'Untitled file',
        snippet: `${file.mimeType ?? 'unknown'} • ${file.modifiedTime ?? ''}`.trim(),
        url: file.webViewLink ?? undefined,
        metadata: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
        },
      }));
    } catch (error) {
      console.error('[Google Drive] Search error:', error);
      return [];
    }
  }

  private async getClient(): Promise<DriveClient> {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;
    const stored = await tokenStore.getTokens<{ refreshToken?: string }>(this.id);
    const refreshToken = stored?.refreshToken || process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
      throw new Error('Google Drive OAuth configuration is missing.');
    }

    const key = `${clientId}:${redirectUri}:${refreshToken}`;
    if (!this.client || this.clientKey !== key) {
      this.client = new DriveClient({
        clientId,
        clientSecret,
        redirectUri,
        refreshToken,
      });
      this.clientKey = key;
    }

    return this.client;
  }

  private async searchFiles({
    query,
    mimeType,
    includeTrashed,
    limit,
  }: {
    query?: string;
    mimeType?: string;
    includeTrashed?: boolean;
    limit: number;
  }) {
    const drive = (await this.getClient()).getDrive();
    const filters: string[] = [];

    if (query) {
      filters.push(`name contains '${sanitizeQuery(query)}'`);
    }

    if (mimeType) {
      filters.push(`mimeType = '${sanitizeQuery(mimeType)}'`);
    }

    if (!includeTrashed) {
      filters.push('trashed = false');
    }

    const q = filters.length > 0 ? filters.join(' and ') : undefined;
    const pageSize = clamp(limit, 1, 50);
    const response = await drive.files.list({
      q,
      pageSize,
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress),size)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    return { files: response.data.files ?? [] };
  }

  private async getFileMetadata(fileId: string) {
    const drive = (await this.getClient()).getDrive();
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress),size',
      supportsAllDrives: true,
    });

    return { file: response.data };
  }

  private async readFileText(fileId: string, maxChars: number) {
    const drive = (await this.getClient()).getDrive();
    const metadataResponse = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,webViewLink,size',
      supportsAllDrives: true,
    });

    const file = metadataResponse.data;
    const mimeType = file.mimeType || '';
    const size = file.size ? Number(file.size) : undefined;

    if (size && size > MAX_BINARY_BYTES && !mimeType.startsWith('application/vnd.google-apps.')) {
      return { error: `File is too large to read (${size} bytes).` };
    }

    let responseData: ArrayBuffer | Uint8Array | Buffer | string;

    if (mimeType.startsWith('application/vnd.google-apps.')) {
      const exportType = mimeType.includes('spreadsheet') ? 'text/csv' : 'text/plain';
      const exportResponse = await drive.files.export(
        { fileId, mimeType: exportType },
        { responseType: 'arraybuffer' },
      );
      responseData = exportResponse.data as ArrayBuffer;
    } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      const mediaResponse = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      responseData = mediaResponse.data as ArrayBuffer;
    } else {
      return { error: `File type ${mimeType || 'unknown'} is not supported for text extraction.` };
    }

    const content = toBuffer(responseData).toString('utf-8');
    const truncated = content.length > maxChars;
    const text = truncated ? content.slice(0, maxChars) : content;

    return {
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
      },
      content: text,
      truncated,
    };
  }
}
