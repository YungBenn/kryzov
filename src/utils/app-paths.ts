import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const APP_DIR_NAME = '.kryzov';
export const LEGACY_APP_DIR_NAME = '.dexter';

const migratedKeys = new Set<string>();

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function copyPathIfMissing(source: string, destination: string): void {
  if (!existsSync(source) || existsSync(destination)) {
    return;
  }

  ensureDirectory(dirname(destination));
  cpSync(source, destination, { recursive: true });
}

function getMigrationKey(projectRoot: string, homeRoot: string): string {
  return `${projectRoot}::${homeRoot}`;
}

export function getProjectAppRoot(projectRoot: string = process.cwd()): string {
  return join(projectRoot, APP_DIR_NAME);
}

export function getLegacyProjectAppRoot(projectRoot: string = process.cwd()): string {
  return join(projectRoot, LEGACY_APP_DIR_NAME);
}

export function getHomeAppRoot(homeRoot: string = homedir()): string {
  return join(homeRoot, APP_DIR_NAME);
}

export function getLegacyHomeAppRoot(homeRoot: string = homedir()): string {
  return join(homeRoot, LEGACY_APP_DIR_NAME);
}

export function ensureAppDataMigration(params?: {
  projectRoot?: string;
  homeRoot?: string;
}): void {
  const projectRoot = params?.projectRoot ?? process.cwd();
  const homeRoot = params?.homeRoot ?? homedir();
  const migrationKey = getMigrationKey(projectRoot, homeRoot);

  if (migratedKeys.has(migrationKey)) {
    return;
  }

  const legacyProjectRoot = getLegacyProjectAppRoot(projectRoot);
  const projectAppRoot = getProjectAppRoot(projectRoot);
  const legacyHomeRoot = getLegacyHomeAppRoot(homeRoot);
  const homeAppRoot = getHomeAppRoot(homeRoot);

  ensureDirectory(projectAppRoot);
  ensureDirectory(homeAppRoot);

  copyPathIfMissing(join(legacyProjectRoot, 'settings.json'), join(projectAppRoot, 'settings.json'));
  copyPathIfMissing(join(legacyProjectRoot, 'messages'), join(projectAppRoot, 'messages'));
  copyPathIfMissing(join(legacyProjectRoot, 'skills'), join(projectAppRoot, 'skills'));

  copyPathIfMissing(join(legacyHomeRoot, 'gateway.json'), join(homeAppRoot, 'gateway.json'));
  copyPathIfMissing(join(legacyHomeRoot, 'gateway-debug.log'), join(homeAppRoot, 'gateway-debug.log'));
  copyPathIfMissing(join(legacyHomeRoot, 'sessions'), join(homeAppRoot, 'sessions'));
  copyPathIfMissing(join(legacyHomeRoot, 'credentials'), join(homeAppRoot, 'credentials'));
  copyPathIfMissing(join(legacyHomeRoot, 'pairing'), join(homeAppRoot, 'pairing'));
  copyPathIfMissing(join(legacyHomeRoot, 'skills'), join(homeAppRoot, 'skills'));

  migratedKeys.add(migrationKey);
}

export function getProjectAppPath(...segments: string[]): string {
  ensureAppDataMigration();
  return join(getProjectAppRoot(), ...segments);
}

export function getHomeAppPath(...segments: string[]): string {
  ensureAppDataMigration();
  return join(getHomeAppRoot(), ...segments);
}

export function getSettingsPath(projectRoot: string = process.cwd()): string {
  ensureAppDataMigration({ projectRoot });
  return join(getProjectAppRoot(projectRoot), 'settings.json');
}

export function resetAppPathMigrationCache(): void {
  migratedKeys.clear();
}
