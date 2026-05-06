import { describe, expect, test } from 'bun:test';
import { computeSessionMetrics, type MarketTrade } from './analytics.js';
import {
  buildReferenceMap,
  deriveIntradayReferences,
  deriveOrderBookState,
  detectFlowEvents,
  type OrderBookSnapshot,
} from './microstructure.js';

function trade(timestamp: string, price: number, size: number, side: 'B' | 'A'): MarketTrade {
  return {
    timestamp: Date.parse(timestamp),
    price,
    size,
    side,
  };
}

describe('deriveOrderBookState', () => {
  test('summarizes spread, imbalance, depth, walls, and dynamics', () => {
    const previousBook: OrderBookSnapshot = {
      timestamp: Date.parse('2026-04-27T00:00:00.000Z'),
      bids: [
        { price: 100, size: 2, count: 1 },
        { price: 99.95, size: 2, count: 1 },
        { price: 99.9, size: 1.5, count: 1 },
      ],
      asks: [
        { price: 100.1, size: 3, count: 1 },
        { price: 100.15, size: 2.5, count: 1 },
        { price: 100.2, size: 2, count: 1 },
      ],
    };
    const book: OrderBookSnapshot = {
      timestamp: Date.parse('2026-04-27T00:00:05.000Z'),
      bids: [
        { price: 100, size: 4, count: 1 },
        { price: 99.95, size: 3, count: 1 },
        { price: 99.9, size: 2.5, count: 1 },
      ],
      asks: [
        { price: 100.1, size: 1.5, count: 1 },
        { price: 100.15, size: 1.25, count: 1 },
        { price: 100.2, size: 1, count: 1 },
      ],
    };

    const state = deriveOrderBookState({
      book,
      previousBook,
    });

    expect(state?.bestBid).toBe(100);
    expect(state?.bestAsk).toBe(100.1);
    expect(state?.spread).toBeCloseTo(0.1, 5);
    expect(state?.topOfBookImbalance).toBeGreaterThan(0);
    expect(state?.pressure).toBe('bid_support');
    expect(state?.depthBands).toHaveLength(3);
    expect(state?.bidWall?.price).toBe(100);
    expect(state?.dynamics.dominantChange).toBe('stacking_bids');
  });
});

describe('deriveIntradayReferences', () => {
  test('extracts opening range and initial balance from the session tape', () => {
    const trades = [
      trade('2026-04-27T00:01:00.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:03:00.000Z', 101, 1, 'A'),
      trade('2026-04-27T00:20:00.000Z', 102, 1, 'B'),
      trade('2026-04-27T00:45:00.000Z', 103, 1, 'B'),
    ];

    const references = deriveIntradayReferences({
      trades,
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
      now: Date.parse('2026-04-27T00:50:00.000Z'),
    });

    expect(references.opening_range_high).toBe(101);
    expect(references.opening_range_low).toBe(100);
    expect(references.initial_balance_high).toBe(103);
    expect(references.initial_balance_low).toBe(100);
  });
});

describe('buildReferenceMap', () => {
  test('ranks nearer and more recently tested references higher', () => {
    const trades = [
      trade('2026-04-27T00:01:00.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:02:00.000Z', 100.2, 1, 'B'),
      trade('2026-04-27T00:03:00.000Z', 100.35, 1, 'A'),
      trade('2026-04-27T00:04:00.000Z', 100.25, 1, 'A'),
    ];

    const references = buildReferenceMap({
      trades,
      now: Date.parse('2026-04-27T00:05:00.000Z'),
      currentPrice: 100.22,
      references: {
        session_high: 100.3,
        session_vwap: 100.05,
        prior_session_high: 101.4,
        opening_range_high: 100.25,
      },
    });

    const sessionHigh = references.find((reference) => reference.name === 'session_high');
    const priorSessionHigh = references.find((reference) => reference.name === 'prior_session_high');

    expect(references.some((reference) => reference.name === 'opening_range_high')).toBe(true);
    expect(sessionHigh?.score).toBeGreaterThan(priorSessionHigh?.score ?? 0);
    expect(sessionHigh?.distanceBps).toBeLessThan(priorSessionHigh?.distanceBps ?? Infinity);
  });
});

describe('detectFlowEvents', () => {
  test('detects a recent failed breakout above the session high', () => {
    const trades = [
      trade('2026-04-27T00:00:00.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:10:00.000Z', 100.4, 1, 'B'),
      trade('2026-04-27T00:16:00.000Z', 100.9, 1.2, 'B'),
      trade('2026-04-27T00:18:00.000Z', 101.2, 1, 'B'),
      trade('2026-04-27T00:19:00.000Z', 100.3, 1.5, 'A'),
      trade('2026-04-27T00:20:00.000Z', 99.9, 1.2, 'A'),
    ];
    const now = Date.parse('2026-04-27T00:20:30.000Z');
    const metrics = computeSessionMetrics({
      trades,
      now,
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    const events = detectFlowEvents({
      trades,
      now,
      metrics,
      orderBookState: {
        timestamp: now,
        bestBid: 99.9,
        bestAsk: 100,
        midPrice: 99.95,
        spread: 0.1,
        spreadBps: 10.005002501250624,
        topOfBookImbalance: -0.25,
        depthBands: [],
        pressure: 'ask_pressure',
        bidWall: null,
        askWall: null,
        sweepEstimates: [],
        dynamics: {
          bidDepthChangePct: -15,
          askDepthChangePct: 8,
          dominantChange: 'pulling_bids',
        },
      },
      levelReferences: {
        session_high: 101,
        session_low: 99.8,
        session_vwap: metrics.sessionVwap,
        prior_session_high: null,
        prior_session_low: null,
        prior_session_vwap: null,
        opening_range_high: 100.4,
        opening_range_low: 100,
        initial_balance_high: 101,
        initial_balance_low: 99.8,
      },
    });

    expect(events.some((event) => event.type === 'failed_breakout' && event.reference === 'session_high')).toBe(
      true,
    );
  });

  test('detects a buy sweep when aggressive buying lifts price quickly', () => {
    const trades = [
      trade('2026-04-27T00:17:40.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:18:10.000Z', 100.08, 1.5, 'B'),
      trade('2026-04-27T00:18:40.000Z', 100.16, 1.5, 'B'),
      trade('2026-04-27T00:19:10.000Z', 100.24, 1.75, 'B'),
      trade('2026-04-27T00:19:40.000Z', 100.33, 2, 'B'),
    ];
    const now = Date.parse('2026-04-27T00:20:00.000Z');
    const metrics = computeSessionMetrics({
      trades,
      now,
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    const events = detectFlowEvents({
      trades,
      now,
      metrics,
      orderBookState: {
        timestamp: now,
        bestBid: 100.32,
        bestAsk: 100.34,
        midPrice: 100.33,
        spread: 0.02,
        spreadBps: 1.993421708362404,
        topOfBookImbalance: 0.2,
        depthBands: [],
        pressure: 'bid_support',
        bidWall: null,
        askWall: null,
        sweepEstimates: [],
        dynamics: {
          bidDepthChangePct: 20,
          askDepthChangePct: -4,
          dominantChange: 'stacking_bids',
        },
      },
      levelReferences: {
        session_high: 100.33,
        session_low: 100,
        session_vwap: metrics.sessionVwap,
        prior_session_high: null,
        prior_session_low: null,
        prior_session_vwap: null,
        opening_range_high: null,
        opening_range_low: null,
        initial_balance_high: null,
        initial_balance_low: null,
      },
    });

    expect(events.some((event) => event.type === 'buy_sweep')).toBe(true);
  });
});
