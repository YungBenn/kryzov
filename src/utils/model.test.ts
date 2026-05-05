import { describe, expect, test } from 'bun:test';
import { DEFAULT_MODEL } from '../model/llm.js';
import {
  getDefaultModelForProvider,
  getModelDisplayName,
  getModelsForProvider,
} from './model.js';

describe('OpenAI model catalog', () => {
  test('includes GPT 5.5 and GPT 5.4 and defaults to GPT 5.5', () => {
    expect(getModelsForProvider('openai').map((model) => model.id)).toEqual([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.2',
      'gpt-4.1',
    ]);
    expect(getDefaultModelForProvider('openai')).toBe('gpt-5.5');
    expect(DEFAULT_MODEL).toBe('gpt-5.5');
  });

  test('formats display names for the new GPT 5.x models', () => {
    expect(getModelDisplayName('gpt-5.5')).toBe('GPT 5.5');
    expect(getModelDisplayName('gpt-5.4')).toBe('GPT 5.4');
  });
});
