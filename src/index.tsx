#!/usr/bin/env bun
import { config } from 'dotenv';
import { ensureAppDataMigration } from './utils/app-paths.js';
import { sanitizeOptionalEnvIntegrations } from './utils/env.js';

// Load environment variables
config({ quiet: true });
sanitizeOptionalEnvIntegrations();
ensureAppDataMigration();

const { runCli } = await import('./cli.js');
await runCli();
