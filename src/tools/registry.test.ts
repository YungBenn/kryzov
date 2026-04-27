import { describe, expect, test } from 'bun:test';
import { getToolRegistry } from './registry.js';

describe('getToolRegistry', () => {
  test('only exposes Kryzov-native market tools', () => {
    const names = getToolRegistry('gpt-5.2').map((tool) => tool.name);
    expect(names).toEqual(['market_context', 'recent_sessions', 'level_response']);
  });
});
