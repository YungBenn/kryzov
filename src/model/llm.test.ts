import { afterEach, describe, expect, test } from 'bun:test';
import { ChatOllama } from '@langchain/ollama';
import { getChatModel, resolveAgentOllamaThink } from './llm.js';
import type { KryzovChatOllamaInput, OllamaThinkSetting } from './ollama-compat.js';

const originalThink = process.env.KRYZOV_OLLAMA_THINK;

describe('getChatModel', () => {
  const mediumThinkConfig: KryzovChatOllamaInput = {
    model: 'qwen3.5:9b',
    think: 'medium',
  };
  const getThink = (model: ChatOllama): OllamaThinkSetting | undefined =>
    Reflect.get(model, 'think') as OllamaThinkSetting | undefined;

  test('ChatOllamaInput accepts level-based think values', () => {
    expect(mediumThinkConfig.think).toBe('medium');
  });

  afterEach(() => {
    if (originalThink === undefined) {
      delete process.env.KRYZOV_OLLAMA_THINK;
    } else {
      process.env.KRYZOV_OLLAMA_THINK = originalThink;
    }
  });

  test('defaults Ollama thinking to false', () => {
    delete process.env.KRYZOV_OLLAMA_THINK;

    const model = getChatModel('ollama:qwen3.5:9b');

    expect(model).toBeInstanceOf(ChatOllama);
    expect(getThink(model as ChatOllama)).toBeFalse();
  });

  test('accepts boolean and level-based Ollama thinking overrides', () => {
    process.env.KRYZOV_OLLAMA_THINK = 'medium';
    const mediumModel = getChatModel('ollama:qwen3.5:9b') as ChatOllama;
    expect(getThink(mediumModel)).toBeTrue();

    process.env.KRYZOV_OLLAMA_THINK = 'true';
    const trueModel = getChatModel('ollama:qwen3.5:9b') as ChatOllama;
    expect(getThink(trueModel)).toBeTrue();

    process.env.KRYZOV_OLLAMA_THINK = 'false';
    const falseModel = getChatModel('ollama:qwen3.5:9b') as ChatOllama;
    expect(getThink(falseModel)).toBeFalse();
  });

  test('rejects boolean GPT-OSS think settings from env config', () => {
    process.env.KRYZOV_OLLAMA_THINK = 'true';
    expect(() => getChatModel('ollama:gpt-oss:20b')).toThrow('requires level-based think values');

    process.env.KRYZOV_OLLAMA_THINK = 'false';
    expect(() => getChatModel('ollama:gpt-oss:20b')).toThrow('requires level-based think values');
  });

  test('accepts level-based GPT-OSS think settings from env config', () => {
    process.env.KRYZOV_OLLAMA_THINK = 'medium';
    const model = getChatModel('ollama:gpt-oss:20b') as ChatOllama;
    expect(getThink(model)).toBe('medium');
  });
});

describe('resolveAgentOllamaThink', () => {
  afterEach(() => {
    if (originalThink === undefined) {
      delete process.env.KRYZOV_OLLAMA_THINK;
    } else {
      process.env.KRYZOV_OLLAMA_THINK = originalThink;
    }
  });

  test('resolves simple GPT-OSS prompts to low in auto mode', () => {
    process.env.KRYZOV_OLLAMA_THINK = 'auto';
    expect(resolveAgentOllamaThink('ollama:gpt-oss:20b', 'how is the market right now?')).toBe('low');
  });

  test('resolves simple boolean-capable prompts to false in auto mode', () => {
    process.env.KRYZOV_OLLAMA_THINK = 'auto';
    expect(resolveAgentOllamaThink('ollama:qwen3.5:9b', 'how is the market right now?')).toBeFalse();
  });

  test('resolves complex prompts to medium in auto mode', () => {
    process.env.KRYZOV_OLLAMA_THINK = 'auto';
    expect(
      resolveAgentOllamaThink('ollama:gpt-oss:20b', 'compare the current session to the last 5 sessions and explain the divergence'),
    ).toBe('medium');
  });
});
