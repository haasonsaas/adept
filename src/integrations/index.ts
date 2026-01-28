import { integrationRegistry } from './registry.js';
import { SalesforceIntegration } from './salesforce.js';
import { GitHubIntegration } from './github.js';
import { GoogleDriveIntegration } from './google-drive.js';

export function registerAllIntegrations(): void {
  integrationRegistry.register(new SalesforceIntegration());
  integrationRegistry.register(new GitHubIntegration());
  integrationRegistry.register(new GoogleDriveIntegration());

  const enabled = integrationRegistry.getEnabled();
  console.log(`[Integrations] ${enabled.length} integrations enabled: ${enabled.map((i) => i.name).join(', ')}`);
}

export { integrationRegistry } from './registry.js';
