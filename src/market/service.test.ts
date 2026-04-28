import { describe, expect, test } from 'bun:test';
import {
  buildPlainComparisonSummary,
  computeComparison,
  type MarketComparison,
} from './service.js';
import type { PersistedSessionSummary } from './store.js';

function session(params: {
  sessionDate: string;
  high: number;
  low: number;
  last: number;
  sessionVwap: number;
  buyPct: number;
  sellPct: number;
}): PersistedSessionSummary {
  return {
    sessionDate: params.sessionDate,
    sessionStart: Date.parse(`${params.sessionDate}T00:00:00.000Z`),
    sessionEnd: Date.parse(`${params.sessionDate}T23:59:59.999Z`),
    source: 'stream',
    range: {
      open: params.low,
      high: params.high,
      low: params.low,
      last: params.last,
    },
    sessionVwap: params.sessionVwap,
    rolling30mVwap: params.sessionVwap,
    cumulativeDelta: 0,
    sessionAggression: {
      buyVolume: params.buyPct,
      sellVolume: params.sellPct,
      buyPct: params.buyPct,
      sellPct: params.sellPct,
      netDelta: params.buyPct - params.sellPct,
    },
    trailing5mAggression: {
      buyVolume: params.buyPct,
      sellVolume: params.sellPct,
      buyPct: params.buyPct,
      sellPct: params.sellPct,
      netDelta: params.buyPct - params.sellPct,
    },
    tradeCount: 10,
    totalVolume: 100,
    lastTradeTimestamp: Date.parse(`${params.sessionDate}T12:00:00.000Z`),
    auctionBehavior: 'responsive',
    interpretiveRead: {
      label: 'responsive_defense',
      phrase: 'This looks more responsive than initiative right now.',
      evidence: ['session delta 0.00'],
    },
    assetContext: null,
    freshness: {
      lastTradeAt: Date.parse(`${params.sessionDate}T12:00:00.000Z`),
      lastAssetContextAt: null,
      updatedAt: Date.parse(`${params.sessionDate}T23:59:59.999Z`),
    },
  };
}

describe('computeComparison', () => {
  test('classifies 1664 vs 560 as wider and lower price with sell bias', () => {
    const liveSession = session({
      sessionDate: '2026-04-28',
      high: 77422,
      low: 75758,
      last: 75941,
      sessionVwap: 76508,
      buyPct: 48,
      sellPct: 52,
    });
    const recentSessions = [
      session({ sessionDate: '2026-04-23', high: 77560, low: 77000, last: 77200, sessionVwap: 76950, buyPct: 100, sellPct: 0 }),
      session({ sessionDate: '2026-04-24', high: 77800, low: 77240, last: 77400, sessionVwap: 77050, buyPct: 0, sellPct: 100 }),
      session({ sessionDate: '2026-04-25', high: 77900, low: 77340, last: 77500, sessionVwap: 77100, buyPct: 100, sellPct: 0 }),
      session({ sessionDate: '2026-04-26', high: 78000, low: 77440, last: 77600, sessionVwap: 77150, buyPct: 100, sellPct: 0 }),
      session({ sessionDate: '2026-04-27', high: 78100, low: 77540, last: 77700, sessionVwap: 77250, buyPct: 45, sellPct: 55 }),
    ];

    const comparison = computeComparison(liveSession, recentSessions);

    expect(comparison.currentRange).toBe(1664);
    expect(comparison.recentAverageRange).toBe(560);
    expect(comparison.rangeRatioVsRecentAverage).toBeCloseTo(1664 / 560, 5);
    expect(comparison.rangeComparison).toBe('wider');
    expect(comparison.recentAverageSessionVwap).toBeCloseTo(77100, 5);
    expect(comparison.sessionVwapVsRecentAverage).toBeCloseTo(-592, 5);
    expect(comparison.sessionVwapComparison).toBe('lower');
    expect(comparison.currentFlowBias).toBe('sell');
    expect(comparison.recentFlowPattern).toContain('one-sided');
  });
});

describe('buildPlainComparisonSummary', () => {
  test('builds a compact plain-language comparison summary', () => {
    const comparison: MarketComparison = {
      currentRange: 1664,
      recentAverageRange: 560,
      rangeRatioVsRecentAverage: 2.97,
      rangeComparison: 'wider',
      recentAverageSessionVwap: 77000,
      sessionVwapVsRecentAverage: -492,
      sessionVwapComparison: 'lower',
      currentFlowBias: 'sell',
      recentFlowPattern: 'recent sessions were mostly one-sided',
    };

    const summary = buildPlainComparisonSummary(comparison);

    expect(summary.takeaway).toContain('lower in price');
    expect(summary.takeaway).toContain('more balanced');
    expect(summary.range).toContain('wider');
    expect(summary.flow).toContain('small sell edge');
  });
});
