import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelSelectionController } from './model-selection.js';

const TEST_ROOT = join(tmpdir(), 'kryzov-model-selection-test');

describe('ModelSelectionController', () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    process.chdir(TEST_ROOT);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('calls model-applied callback after successful ollama switch', async () => {
    const applied: Array<{ provider: string; model: string }> = [];
    const controller = new ModelSelectionController(
      () => {},
      undefined,
      (provider, model) => applied.push({ provider, model }),
    );

    await controller.handleProviderSelect('ollama');
    controller.handleModelSelect('qwen3.5:9b');

    expect(controller.provider).toBe('ollama');
    expect(controller.model).toBe('ollama:qwen3.5:9b');
    expect(applied).toEqual([{ provider: 'ollama', model: 'ollama:qwen3.5:9b' }]);
  });
});
