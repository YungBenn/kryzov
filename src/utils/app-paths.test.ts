import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureAppDataMigration, getProjectAppRoot } from './app-paths.js';

const TEST_ROOT = join(tmpdir(), 'kryzov-app-paths-test');

describe('ensureAppDataMigration', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('copies legacy project settings and chat history into .kryzov on first run', () => {
    const legacyRoot = join(TEST_ROOT, '.dexter');
    mkdirSync(join(legacyRoot, 'messages'), { recursive: true });
    writeFileSync(join(legacyRoot, 'settings.json'), JSON.stringify({ modelId: 'gpt-5.2' }, null, 2));
    writeFileSync(
      join(legacyRoot, 'messages', 'chat_history.json'),
      JSON.stringify({ messages: [{ id: '1', userMessage: 'hello', agentResponse: 'world' }] }, null, 2),
    );

    ensureAppDataMigration({ projectRoot: TEST_ROOT, homeRoot: TEST_ROOT });

    const kryzovRoot = getProjectAppRoot(TEST_ROOT);
    expect(existsSync(join(kryzovRoot, 'settings.json'))).toBe(true);
    expect(existsSync(join(kryzovRoot, 'messages', 'chat_history.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(kryzovRoot, 'settings.json'), 'utf8'))).toEqual({
      modelId: 'gpt-5.2',
    });
    expect(
      JSON.parse(readFileSync(join(kryzovRoot, 'messages', 'chat_history.json'), 'utf8')),
    ).toEqual({
      messages: [{ id: '1', userMessage: 'hello', agentResponse: 'world' }],
    });
    expect(existsSync(join(legacyRoot, 'settings.json'))).toBe(true);
  });
});
