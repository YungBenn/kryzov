import { describe, expect, test } from 'bun:test';
import { hasMeaningfulEnvValue, sanitizeOptionalEnvIntegrations } from './env.js';

describe('hasMeaningfulEnvValue', () => {
  test('treats placeholders and blank values as unset', () => {
    expect(hasMeaningfulEnvValue(undefined)).toBe(false);
    expect(hasMeaningfulEnvValue('')).toBe(false);
    expect(hasMeaningfulEnvValue('   ')).toBe(false);
    expect(hasMeaningfulEnvValue('your-api-key')).toBe(false);
    expect(hasMeaningfulEnvValue('your-openai-key-here')).toBe(false);
  });

  test('accepts non-placeholder keys', () => {
    expect(hasMeaningfulEnvValue('sk-test-123')).toBe(true);
  });
});

describe('sanitizeOptionalEnvIntegrations', () => {
  test('disables LangSmith tracing when only placeholder credentials are present', () => {
    const env = {
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: 'your-api-key',
    };

    sanitizeOptionalEnvIntegrations(env);

    expect(env.LANGSMITH_TRACING).toBe('false');
  });

  test('preserves LangSmith tracing when a real key is present', () => {
    const env = {
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: 'lsv2_pt_real_key',
    };

    sanitizeOptionalEnvIntegrations(env);

    expect(env.LANGSMITH_TRACING).toBe('true');
  });
});
