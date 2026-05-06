import { describe, expect, test } from 'bun:test';
import type { MarketTrade } from './analytics.js';
import {
  derivePositioningRegime,
  deriveVolatilityPace,
  extractSessionFeatureVector,
  rankSessionAnalogs,
} from './contextual.js';
import type { MarketAssetContextPoint, PersistedSessionSummary } from './store.js';

function session(params: {
  sessionDate: string;
  high: number;
  low: number;
  last: number;
  tradeCount: number;
  totalVolume: number;
}): PersistedSessionSummary {
  return {
    sessionDate: params.sessionDate,
    sessionStart: Date.parse(`${params.sessionDate}T00:00:00.000Z`),
    sessionEnd: Date.parse(`${params.sessionDate}T23:59:59.999Z`),
    source: 'archive',
    range: {
      open: params.low,
      high: params.high,
      low: params.low,
      last: params.last,
    },
    sessionVwap: (params.high + params.low) / 2,
    rolling30mVwap: (params.high + params.low) / 2,
    cumulativeDelta: 0,
    sessionAggression: {
      buyVolume: 50,
      sellVolume: 50,
      buyPct: 50,
      sellPct: 50,
      netDelta: 0,
    },
    trailing5mAggression: {
      buyVolume: 50,
      sellVolume: 50,
      buyPct: 50,
      sellPct: 50,
      netDelta: 0,
    },
    tradeCount: params.tradeCount,
    totalVolume: params.totalVolume,
    lastTradeTimestamp: Date.parse(`${params.sessionDate}T12:00:00.000Z`),
    auctionBehavior: 'balanced',
    interpretiveRead: {
      label: 'balance_to_imbalance_shift',
      phrase: 'Not enough evidence for a session read yet.',
      evidence: ['test'],
    },
    assetContext: null,
    freshness: {
      lastTradeAt: Date.parse(`${params.sessionDate}T12:00:00.000Z`),
      lastAssetContextAt: null,
      updatedAt: Date.parse(`${params.sessionDate}T12:00:00.000Z`),
    },
    dataQuality: {
      tradeCoverage: {
        realTradeCount: params.tradeCount,
        syntheticTradeCount: 0,
        totalTradeCount: params.tradeCount,
        realTradeVolume: params.totalVolume,
        syntheticTradeVolume: 0,
        totalVolume: params.totalVolume,
        realTradeShare: 1,
        syntheticTradeShare: 0,
      },
      historyCoverage: {
        sessionMinutes: 1440,
        coveredMinutes: params.tradeCount,
        realTradeMinutes: params.tradeCount,
        syntheticTradeMinutes: 0,
        uncoveredMinutes: 1440 - params.tradeCount,
        realMinuteCoverage: params.tradeCount / 1440,
        syntheticFallbackUsed: false,
        archiveUsed: true,
      },
      freshness: {
        tradeAgeMs: 0,
        assetContextAgeMs: null,
        orderBookAgeMs: null,
      },
      confidenceFlags: [],
    },
  };
}

describe('derivePositioningRegime', () => {
  test('classifies price up with open interest up as long buildup', () => {
    const points: MarketAssetContextPoint[] = [
      {
        timestamp: Date.parse('2026-04-28T00:00:00.000Z'),
        markPx: 100,
        openInterest: 1_000_000,
        funding: 0.00005,
        premium: 0.0001,
      },
      {
        timestamp: Date.parse('2026-04-28T01:00:00.000Z'),
        markPx: 100.5,
        openInterest: 1_020_000,
        funding: 0.00012,
        premium: 0.0008,
      },
    ];

    const regime = derivePositioningRegime({
      assetContextHistory: points,
      now: Date.parse('2026-04-28T01:00:00.000Z'),
      sessionStart: Date.parse('2026-04-28T00:00:00.000Z'),
    });

    expect(regime.regime).toBe('long_buildup');
    expect(regime.crowding).toBe('long_crowded');
    expect(regime.priceChangePct).toBeGreaterThan(0);
    expect(regime.openInterestChangePct).toBeGreaterThan(0);
  });
});

describe('deriveVolatilityPace', () => {
  test('classifies fast pace when current session outpaces recent norms', () => {
    const liveSession = session({
      sessionDate: '2026-04-28',
      high: 110,
      low: 100,
      last: 109,
      tradeCount: 400,
      totalVolume: 900,
    });
    const recentSessions = [
      session({ sessionDate: '2026-04-25', high: 104, low: 100, last: 103, tradeCount: 200, totalVolume: 300 }),
      session({ sessionDate: '2026-04-26', high: 105, low: 101, last: 104, tradeCount: 210, totalVolume: 320 }),
      session({ sessionDate: '2026-04-27', high: 106, low: 102, last: 105, tradeCount: 220, totalVolume: 350 }),
    ];
    const trades: MarketTrade[] = [
      { timestamp: Date.parse('2026-04-28T00:35:00.000Z'), price: 107, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:45:00.000Z'), price: 108, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:55:00.000Z'), price: 109, size: 1, side: 'B', source: 'real' },
    ];

    const pace = deriveVolatilityPace({
      liveSession: {
        ...liveSession,
        sessionEnd: Date.parse('2026-04-28T01:00:00.000Z'),
      },
      recentSessions,
      trades,
      now: Date.parse('2026-04-28T01:00:00.000Z'),
    });

    expect(pace.regime).toBe('fast');
    expect(pace.rangePaceRatio).toBeGreaterThan(1);
    expect(pace.tradeRateRatio).toBeGreaterThan(1);
  });
});

describe('extractSessionFeatureVector', () => {
  test('builds a feature vector from session, trades, and asset context history', () => {
    const liveSession = session({
      sessionDate: '2026-04-28',
      high: 110,
      low: 100,
      last: 109,
      tradeCount: 400,
      totalVolume: 900,
    });
    const trades: MarketTrade[] = [
      { timestamp: Date.parse('2026-04-28T00:01:00.000Z'), price: 100, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:03:00.000Z'), price: 101, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:45:00.000Z'), price: 108, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:55:00.000Z'), price: 109, size: 1, side: 'B', source: 'real' },
    ];
    const points: MarketAssetContextPoint[] = [
      { timestamp: Date.parse('2026-04-28T00:00:00.000Z'), markPx: 100, openInterest: 1_000, funding: 0.0001, premium: 0.0001 },
      { timestamp: Date.parse('2026-04-28T01:00:00.000Z'), markPx: 109, openInterest: 1_050, funding: 0.00015, premium: 0.0008 },
    ];

    const vector = extractSessionFeatureVector({
      session: { ...liveSession, sessionEnd: Date.parse('2026-04-28T01:00:00.000Z') },
      trades,
      assetContextHistory: points,
      baselineSessions: [
        session({ sessionDate: '2026-04-27', high: 104, low: 100, last: 103, tradeCount: 200, totalVolume: 300 }),
      ],
      now: Date.parse('2026-04-28T01:00:00.000Z'),
    });

    expect(vector.sessionDate).toBe('2026-04-28');
    expect(vector.positioningRegime).toBe('long_buildup');
    expect(vector.currentRange).toBe(10);
    expect(vector.openingRangeSize).toBe(1);
  });
});

describe('rankSessionAnalogs', () => {
  test('ranks the closest historical vector first', () => {
    const liveVector = {
      sessionDate: '2026-04-28',
      sessionProgressPct: 25,
      structureState: 'accepted_up' as const,
      positioningRegime: 'long_buildup' as const,
      volatilityRegime: 'fast' as const,
      currentRange: 10,
      openingRangeSize: 2,
      initialBalanceSize: 8,
      rangePaceRatio: 2.2,
      tradeRateRatio: 2.1,
      volumeRateRatio: 2.0,
      aggressionSkew: 22,
      normalizedDelta: 0.35,
      realizedVol30mBps: 18,
    };

    const matches = rankSessionAnalogs({
      liveVector,
      historicalVectors: [
        { ...liveVector, sessionDate: '2026-04-27' },
        {
          ...liveVector,
          sessionDate: '2026-04-26',
          structureState: 'balanced',
          positioningRegime: 'mixed',
          volatilityRegime: 'compressed',
          rangePaceRatio: 0.6,
          tradeRateRatio: 0.5,
          volumeRateRatio: 0.5,
          aggressionSkew: -10,
          normalizedDelta: -0.2,
        },
      ],
    });

    expect(matches[0]?.sessionDate).toBe('2026-04-27');
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
    expect(matches[0]?.matchedDimensions).toContain('structure');
  });
});
