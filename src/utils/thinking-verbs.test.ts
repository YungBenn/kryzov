import { describe, expect, test } from 'bun:test';
import { THINKING_VERBS, getRandomThinkingVerb } from './thinking-verbs.js';

describe('THINKING_VERBS', () => {
  test('keeps a strict market-research tone with a small Russian accent set', () => {
    expect(THINKING_VERBS).toContain('Analyzing');
    expect(THINKING_VERBS).toContain('Assessing');
    expect(THINKING_VERBS).toContain('Evaluating');
    expect(THINKING_VERBS).toContain('Triangulating');
    expect(THINKING_VERBS).toContain('Verifying');
    expect(THINKING_VERBS).toContain('Думаю');
    expect(THINKING_VERBS).toContain('Наблюдаю');
    expect(THINKING_VERBS).toContain('Проверяю');

    expect(THINKING_VERBS).not.toContain('Brainstorming');
    expect(THINKING_VERBS).not.toContain('Brewing');
    expect(THINKING_VERBS).not.toContain('Dumayu');
    expect(THINKING_VERBS).not.toContain('Marinating');
    expect(THINKING_VERBS).not.toContain('Nablyudayu');
    expect(THINKING_VERBS).not.toContain('Proveryayu');
    expect(THINKING_VERBS).not.toContain('Riffing');
    expect(THINKING_VERBS).not.toContain('Hmm');
  });
});

describe('getRandomThinkingVerb', () => {
  test('always returns a verb from the curated list', () => {
    for (let i = 0; i < 100; i++) {
      expect(THINKING_VERBS as readonly string[]).toContain(getRandomThinkingVerb());
    }
  });
});
