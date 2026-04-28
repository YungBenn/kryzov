import { describe, expect, test } from 'bun:test';
import { Scratchpad } from './scratchpad.js';

describe('Scratchpad', () => {
  test('omits tool-usage status after the first successful call', () => {
    const scratchpad = new Scratchpad(`first-call-${Date.now()}`);

    scratchpad.recordToolCall('market_context');

    expect(scratchpad.formatToolUsageForPrompt()).toBeNull();
  });

  test('includes tool-usage status near the retry threshold', () => {
    const scratchpad = new Scratchpad(`near-threshold-${Date.now()}`);

    scratchpad.recordToolCall('market_context');
    scratchpad.recordToolCall('market_context');

    expect(scratchpad.formatToolUsageForPrompt()).toContain('market_context: 2/3 calls');
  });
});
