import { describe, expect, test } from 'bun:test';
import { getToolRegistry } from './registry.js';

describe('getToolRegistry', () => {
  test('only exposes Kryzov-native market tools', () => {
    const names = getToolRegistry('gpt-5.2').map((tool) => tool.name);
    expect(names).toEqual(['market_context', 'session_profile', 'recent_sessions', 'level_response']);
  });

  test('stores compact prompt descriptions in the registry metadata', () => {
    const tools = getToolRegistry('gpt-5.2');

    expect(tools.map((tool) => tool.promptDescription)).toEqual([
      'market_context: current BTC/USD Hyperliquid session state',
      'session_profile: computed BTC/USD Hyperliquid session structure and transition state',
      'recent_sessions: recent completed BTC/USD Hyperliquid sessions for comparison',
      'level_response: measured acceptance/rejection analysis for explicit levels or session landmarks',
    ]);
  });
});
