import { describe, expect, test } from 'bun:test';
import {
  analyzeLevelResponse,
  classifyAuctionBehavior,
  computeSessionMetrics,
  deriveSessionProfile,
  deriveInterpretiveRead,
  getUtcSessionStart,
  type MarketTrade,
} from './analytics.js';

function trade(timestamp: string, price: number, size: number, side: 'B' | 'A'): MarketTrade {
  return {
    timestamp: Date.parse(timestamp),
    price,
    size,
    side,
  };
}

describe('getUtcSessionStart', () => {
  test('rounds timestamps down to midnight UTC', () => {
    expect(getUtcSessionStart(Date.parse('2026-04-27T15:42:31.000Z'))).toBe(
      Date.parse('2026-04-27T00:00:00.000Z'),
    );
  });
});

describe('computeSessionMetrics', () => {
  test('computes session vwap, rolling vwap, cumulative delta, and aggression splits', () => {
    const trades = [
      trade('2026-04-27T00:01:00.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:02:00.000Z', 110, 2, 'A'),
      trade('2026-04-27T00:40:00.000Z', 120, 3, 'B'),
    ];

    const metrics = computeSessionMetrics({
      trades,
      now: Date.parse('2026-04-27T00:45:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    expect(metrics.sessionVwap).toBeCloseTo(113.333333, 5);
    expect(metrics.rolling30mVwap).toBeCloseTo(120, 5);
    expect(metrics.cumulativeDelta).toBeCloseTo(2, 5);
    expect(metrics.sessionAggression.buyPct).toBeCloseTo(66.666666, 5);
    expect(metrics.sessionAggression.sellPct).toBeCloseTo(33.333333, 5);
    expect(metrics.trailing5mAggression.buyPct).toBeCloseTo(100, 5);
    expect(metrics.trailing5mAggression.sellPct).toBeCloseTo(0, 5);
    expect(metrics.range.high).toBe(120);
    expect(metrics.range.low).toBe(100);
    expect(metrics.range.open).toBe(100);
    expect(metrics.range.last).toBe(120);
  });
});

describe('analyzeLevelResponse', () => {
  test('classifies sustained trade above a level as acceptance', () => {
    const trades = [
      trade('2026-04-27T00:00:00.000Z', 99, 1, 'A'),
      trade('2026-04-27T00:01:00.000Z', 100.5, 1, 'B'),
      trade('2026-04-27T00:02:00.000Z', 101, 1.5, 'B'),
      trade('2026-04-27T00:03:00.000Z', 102, 1, 'B'),
    ];

    const response = analyzeLevelResponse({
      level: 100,
      trades,
      now: Date.parse('2026-04-27T00:04:00.000Z'),
    });

    expect(response.status).toBe('accepted');
    expect(response.netDeltaAfterCross).toBeGreaterThan(0);
  });

  test('classifies quick return back through a level as rejection', () => {
    const trades = [
      trade('2026-04-27T00:00:00.000Z', 99.5, 1, 'B'),
      trade('2026-04-27T00:01:00.000Z', 100.4, 1, 'B'),
      trade('2026-04-27T00:02:00.000Z', 99.8, 1.5, 'A'),
      trade('2026-04-27T00:03:00.000Z', 99.2, 1, 'A'),
    ];

    const response = analyzeLevelResponse({
      level: 100,
      trades,
      now: Date.parse('2026-04-27T00:04:00.000Z'),
    });

    expect(response.status).toBe('rejected');
    expect(response.netDeltaAfterCross).toBeLessThan(0);
  });
});

describe('classifyAuctionBehavior', () => {
  test('marks strong expansion at session highs as initiative', () => {
    const metrics = computeSessionMetrics({
      trades: [
        trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
        trade('2026-04-27T00:11:00.000Z', 102, 1.5, 'B'),
        trade('2026-04-27T00:12:00.000Z', 104, 2, 'B'),
      ],
      now: Date.parse('2026-04-27T00:13:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    expect(classifyAuctionBehavior(metrics)).toBe('initiative');
  });

  test('marks failure from session extremes as responsive', () => {
    const metrics = computeSessionMetrics({
      trades: [
        trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
        trade('2026-04-27T00:11:00.000Z', 103, 1, 'B'),
        trade('2026-04-27T00:12:00.000Z', 100.5, 2, 'A'),
      ],
      now: Date.parse('2026-04-27T00:13:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    expect(classifyAuctionBehavior(metrics)).toBe('responsive');
  });
});

describe('deriveInterpretiveRead', () => {
  test('derives a bounded initiative continuation read from measured evidence', () => {
    const metrics = computeSessionMetrics({
      trades: [
        trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
        trade('2026-04-27T00:11:00.000Z', 102, 2, 'B'),
        trade('2026-04-27T00:12:00.000Z', 104, 2, 'B'),
        trade('2026-04-27T00:13:00.000Z', 105, 1, 'B'),
      ],
      now: Date.parse('2026-04-27T00:14:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    const read = deriveInterpretiveRead(metrics);

    expect(read.label).toBe('initiative_continuation');
    expect(read.phrase).toContain('reads as');
    expect(read.evidence.length).toBeGreaterThan(0);
  });
});

describe('deriveSessionProfile', () => {
  test('classifies a balanced rotation session', () => {
    const metrics = computeSessionMetrics({
      trades: [
        trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
        trade('2026-04-27T00:11:00.000Z', 102, 1, 'A'),
        trade('2026-04-27T00:12:00.000Z', 101, 1, 'B'),
        trade('2026-04-27T00:13:00.000Z', 100.5, 1, 'A'),
      ],
      now: Date.parse('2026-04-27T00:14:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    const profile = deriveSessionProfile({
      metrics,
      trades: [
        trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
        trade('2026-04-27T00:11:00.000Z', 102, 1, 'A'),
        trade('2026-04-27T00:12:00.000Z', 101, 1, 'B'),
        trade('2026-04-27T00:13:00.000Z', 100.5, 1, 'A'),
      ],
      now: Date.parse('2026-04-27T00:14:00.000Z'),
      freshness: {
        lastTradeAt: Date.parse('2026-04-27T00:13:00.000Z'),
        lastAssetContextAt: null,
        updatedAt: Date.parse('2026-04-27T00:14:00.000Z'),
      },
      recentSessions: [],
      levelReferences: {
        session_open: 100,
        session_high: 102,
        session_low: 100,
        session_vwap: 101,
        prior_session_high: null,
        prior_session_low: null,
        prior_session_vwap: null,
      },
    });

    expect(profile.state).toBe('balanced');
    expect(profile.bias).toBe('balanced');
    expect(profile.confidence).toBe('medium');
    expect(profile.transition).toBeNull();
  });

  test('classifies upside expansion and acceptance', () => {
    const trades = [
      trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:11:00.000Z', 101.5, 1.5, 'B'),
      trade('2026-04-27T00:12:00.000Z', 103, 2, 'B'),
      trade('2026-04-27T00:13:00.000Z', 104, 2, 'B'),
      trade('2026-04-27T00:14:00.000Z', 104.5, 1, 'B'),
    ];
    const metrics = computeSessionMetrics({
      trades,
      now: Date.parse('2026-04-27T00:15:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    const profile = deriveSessionProfile({
      metrics,
      trades,
      now: Date.parse('2026-04-27T00:15:00.000Z'),
      freshness: {
        lastTradeAt: Date.parse('2026-04-27T00:14:00.000Z'),
        lastAssetContextAt: null,
        updatedAt: Date.parse('2026-04-27T00:15:00.000Z'),
      },
      recentSessions: [],
      levelReferences: {
        session_open: 100,
        session_high: 104.5,
        session_low: 100,
        session_vwap: metrics.sessionVwap,
        prior_session_high: null,
        prior_session_low: null,
        prior_session_vwap: null,
      },
    });

    expect(profile.state).toBe('accepted_up');
    expect(profile.bias).toBe('buy');
    expect(profile.confidence).toBe('high');
    expect(profile.transition?.to).toBe('accepted_up');
  });

  test('classifies a failed upside move', () => {
    const trades = [
      trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:11:00.000Z', 103, 2, 'B'),
      trade('2026-04-27T00:12:00.000Z', 104, 1, 'B'),
      trade('2026-04-27T00:13:00.000Z', 101, 2, 'A'),
      trade('2026-04-27T00:14:00.000Z', 100.5, 1.5, 'A'),
    ];
    const metrics = computeSessionMetrics({
      trades,
      now: Date.parse('2026-04-27T00:15:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    const profile = deriveSessionProfile({
      metrics,
      trades,
      now: Date.parse('2026-04-27T00:15:00.000Z'),
      freshness: {
        lastTradeAt: Date.parse('2026-04-27T00:14:00.000Z'),
        lastAssetContextAt: null,
        updatedAt: Date.parse('2026-04-27T00:15:00.000Z'),
      },
      recentSessions: [],
      levelReferences: {
        session_open: 100,
        session_high: 104,
        session_low: 100,
        session_vwap: metrics.sessionVwap,
        prior_session_high: null,
        prior_session_low: null,
        prior_session_vwap: null,
      },
    });

    expect(profile.state).toBe('failed_up');
    expect(profile.bias).toBe('sell');
    expect(profile.transition?.to).toBe('failed_up');
  });

  test('degrades confidence and adds a caveat when the session is stale', () => {
    const trades = [
      trade('2026-04-27T00:10:00.000Z', 100, 1, 'B'),
      trade('2026-04-27T00:11:00.000Z', 100.5, 1, 'A'),
    ];
    const metrics = computeSessionMetrics({
      trades,
      now: Date.parse('2026-04-27T01:00:00.000Z'),
      sessionStart: Date.parse('2026-04-27T00:00:00.000Z'),
    });

    const profile = deriveSessionProfile({
      metrics,
      trades,
      now: Date.parse('2026-04-27T01:00:00.000Z'),
      freshness: {
        lastTradeAt: Date.parse('2026-04-27T00:11:00.000Z'),
        lastAssetContextAt: null,
        updatedAt: Date.parse('2026-04-27T01:00:00.000Z'),
      },
      recentSessions: [],
      levelReferences: {
        session_open: 100,
        session_high: 100.5,
        session_low: 100,
        session_vwap: metrics.sessionVwap,
        prior_session_high: null,
        prior_session_low: null,
        prior_session_vwap: null,
      },
    });

    expect(profile.confidence).toBe('low');
    expect(profile.caveat).toBeTruthy();
  });
});
