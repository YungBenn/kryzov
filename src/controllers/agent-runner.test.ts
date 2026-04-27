import { describe, expect, test } from 'bun:test';
import { AgentRunnerController } from './agent-runner.js';
import type { AgentConfig, DoneEvent } from '../agent/index.js';

describe('AgentRunnerController', () => {
  test('uses updated runtime model config for new queries', async () => {
    const capturedConfigs: AgentConfig[] = [];
    const fakeHistory = {
      saveUserQuery() {},
      saveAnswer: async () => {},
    };

    const createAgent = async (config: AgentConfig) => {
      capturedConfigs.push(config);
      return {
        async *run() {
          const done: DoneEvent = {
            type: 'done',
            answer: 'ok',
            toolCalls: [],
            iterations: 1,
            totalTime: 1,
          };
          yield done;
        },
      };
    };

    const controller = new AgentRunnerController(
      { model: 'gpt-5.2', modelProvider: 'openai', maxIterations: 10 },
      fakeHistory as never,
      undefined,
      createAgent as never,
    );

    controller.updateConfig({ model: 'ollama:qwen3.5:9b', modelProvider: 'ollama' });
    await controller.runQuery('how is the market right now?');

    expect(capturedConfigs).toHaveLength(1);
    expect(capturedConfigs[0]?.model).toBe('ollama:qwen3.5:9b');
    expect(capturedConfigs[0]?.modelProvider).toBe('ollama');
  });
});
