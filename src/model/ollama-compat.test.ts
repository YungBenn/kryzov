import { describe, expect, test } from 'bun:test';
import {
  getOllamaThinkCapability,
  normalizeOllamaThinkForModel,
  validateOllamaThinkForModel,
} from './ollama-compat.js';

describe('getOllamaThinkCapability', () => {
  test('classifies GPT-OSS models as level-capable', () => {
    expect(getOllamaThinkCapability('ollama:gpt-oss:20b')).toBe('level');
  });

  test('classifies qwen models as boolean-capable', () => {
    expect(getOllamaThinkCapability('ollama:qwen3.5:9b')).toBe('boolean');
  });

  test('defaults unknown Ollama models to boolean-capable', () => {
    expect(getOllamaThinkCapability('ollama:custom-model')).toBe('boolean');
  });
});

describe('normalizeOllamaThinkForModel', () => {
  test('allows only level-based values for GPT-OSS models', () => {
    expect(normalizeOllamaThinkForModel('ollama:gpt-oss:20b', 'medium')).toBe('medium');
    expect(() => normalizeOllamaThinkForModel('ollama:gpt-oss:20b', true)).toThrow(
      'requires level-based think values',
    );
    expect(() => normalizeOllamaThinkForModel('ollama:gpt-oss:20b', false)).toThrow(
      'requires level-based think values',
    );
  });

  test('normalizes boolean-capable models to boolean think values', () => {
    expect(normalizeOllamaThinkForModel('ollama:qwen3.5:9b', 'medium')).toBeTrue();
    expect(normalizeOllamaThinkForModel('ollama:qwen3.5:9b', false)).toBeFalse();
  });
});

describe('validateOllamaThinkForModel', () => {
  test('rejects boolean think values for GPT-OSS models', () => {
    expect(() => validateOllamaThinkForModel('ollama:gpt-oss:20b', true)).toThrow(
      'requires level-based think values',
    );
    expect(() => validateOllamaThinkForModel('ollama:gpt-oss:20b', false)).toThrow(
      'requires level-based think values',
    );
  });
});
