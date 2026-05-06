import { describe, expect, test } from 'bun:test';
import { getToolRegistry } from './registry.js';

describe('getToolRegistry', () => {
  test('only exposes Kryzov-native market tools', () => {
    const names = getToolRegistry('gpt-5.2').map((tool) => tool.name);
    expect(names).toEqual([
      'market_context',
      'session_profile',
      'positioning_regime',
      'volatility_pace',
      'session_analogs',
      'order_book_state',
      'flow_events',
      'reference_map',
      'recent_sessions',
      'level_response',
    ]);
  });

  test('stores compact prompt descriptions in the registry metadata', () => {
    const tools = getToolRegistry('gpt-5.2');

    expect(tools.map((tool) => tool.promptDescription)).toEqual([
      'market_context: current BTC/USD Hyperliquid session state',
      'session_profile: computed BTC/USD Hyperliquid session structure and transition state',
      'positioning_regime: current BTC/USD Hyperliquid participation, open interest, funding, and premium regime',
      'volatility_pace: current BTC/USD Hyperliquid range, volume, trade-rate, and volatility pace',
      'session_analogs: closest recent BTC/USD Hyperliquid sessions by structure, pace, aggression, and positioning',
      'order_book_state: current BTC/USD Hyperliquid liquidity, imbalance, and book pressure',
      'flow_events: recent deterministic BTC/USD Hyperliquid sweeps, failures, and VWAP events',
      'reference_map: ranked BTC/USD Hyperliquid session and intraday references in play',
      'recent_sessions: recent completed BTC/USD Hyperliquid sessions for comparison',
      'level_response: measured acceptance/rejection analysis for explicit levels or session landmarks',
    ]);
  });
});
