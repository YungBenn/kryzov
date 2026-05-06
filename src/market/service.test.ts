import { describe, expect, test } from 'bun:test';
import {
  buildPlainComparisonSummary,
  computeComparison,
  MarketStateService,
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
    dataQuality: {
      tradeCoverage: {
        realTradeCount: 10,
        syntheticTradeCount: 0,
        totalTradeCount: 10,
        realTradeVolume: 100,
        syntheticTradeVolume: 0,
        totalVolume: 100,
        realTradeShare: 1,
        syntheticTradeShare: 0,
      },
      historyCoverage: {
        sessionMinutes: 1440,
        coveredMinutes: 10,
        realTradeMinutes: 10,
        syntheticTradeMinutes: 0,
        uncoveredMinutes: 1430,
        realMinuteCoverage: 10 / 1440,
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

describe('MarketStateService.getSessionProfile', () => {
  test('returns the computed session profile payload', async () => {
    const service = MarketStateService.getInstance() as any;

    const liveSession = session({
      sessionDate: '2026-04-28',
      high: 104,
      low: 100,
      last: 103.5,
      sessionVwap: 102,
      buyPct: 60,
      sellPct: 40,
    });

    service.ensureStarted = async () => {};
    service.buildLiveSessionSnapshot = async () => liveSession;
    service.store = {
      loadCompletedSessions: () => [],
    };
    service.bootstrapTrades = [];
    service.liveTrades = [];
    service.lastTradeAt = liveSession.lastTradeTimestamp;
    service.lastAssetContextAt = null;

    const result = await service.getSessionProfile();

    expect(result.liveSession.sessionDate).toBe('2026-04-28');
    expect(result.profile.state).toBeTruthy();
    expect(result.profile.evidence.length).toBeGreaterThan(0);
  });
});

describe('MarketStateService market microstructure snapshots', () => {
  test('returns the current order book snapshot payload', async () => {
    const service = MarketStateService.getInstance() as any;

    const liveSession = session({
      sessionDate: '2026-04-28',
      high: 104,
      low: 100,
      last: 103.5,
      sessionVwap: 102,
      buyPct: 60,
      sellPct: 40,
    });

    service.ensureStarted = async () => {};
    service.buildLiveSessionSnapshot = async () => liveSession;
    service.store = {
      loadCompletedSessions: () => [],
    };
    service.bootstrapTrades = [];
    service.liveTrades = [];
    service.currentOrderBook = {
      timestamp: Date.parse('2026-04-28T12:00:00.000Z'),
      bids: [{ price: 103.4, size: 3, count: 1 }],
      asks: [{ price: 103.6, size: 2, count: 1 }],
    };
    service.previousOrderBook = null;
    service.lastOrderBookAt = Date.parse('2026-04-28T12:00:00.000Z');

    const result = await service.getOrderBookState();

    expect(result.book?.midPrice).toBeCloseTo(103.5, 5);
    expect(result.freshness.lastOrderBookAt).toBeTruthy();
  });

  test('returns ranked live references', async () => {
    const service = MarketStateService.getInstance() as any;

    const liveSession = session({
      sessionDate: '2026-04-28',
      high: 104,
      low: 100,
      last: 103.5,
      sessionVwap: 102,
      buyPct: 60,
      sellPct: 40,
    });

    service.ensureStarted = async () => {};
    service.buildLiveSessionSnapshot = async () => liveSession;
    service.store = {
      loadCompletedSessions: () => [],
    };
    service.bootstrapTrades = [
      { timestamp: Date.parse('2026-04-28T00:01:00.000Z'), price: 100, size: 1, side: 'B' },
      { timestamp: Date.parse('2026-04-28T00:03:00.000Z'), price: 101, size: 1, side: 'B' },
      { timestamp: Date.parse('2026-04-28T00:30:00.000Z'), price: 103.3, size: 1, side: 'B' },
    ];
    service.liveTrades = [
      { timestamp: Date.parse('2026-04-28T00:35:00.000Z'), price: 103.5, size: 1, side: 'A' },
    ];

    const result = await service.getReferenceMap(5);

    expect(result.currentPrice).toBe(103.5);
    expect(result.references.length).toBeGreaterThan(0);
    expect(result.references.some((reference: { name: string }) => reference.name === 'session_high')).toBe(true);
  });

  test('builds live data quality from mixed real and synthetic session trades', async () => {
    const service = MarketStateService.getInstance() as any;
    const now = Date.parse('2026-04-28T01:00:00.000Z');
    const buildLiveSessionSnapshot = Object.getPrototypeOf(service).buildLiveSessionSnapshot;

    service.store = {
      loadArchivedTrades: () => [{ timestamp: Date.parse('2026-04-28T00:10:00.000Z'), price: 100, size: 1, side: 'B', source: 'real' }],
      loadLiveSession: () => null,
    };
    service.bootstrapTrades = [
      { timestamp: Date.parse('2026-04-28T00:10:00.000Z'), price: 100, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:20:00.000Z'), price: 101, size: 2, side: 'B', source: 'synthetic' },
    ];
    service.liveTrades = [];
    service.currentAssetContext = null;
    service.lastTradeAt = Date.parse('2026-04-28T00:59:00.000Z');
    service.lastAssetContextAt = null;
    service.lastOrderBookAt = Date.parse('2026-04-28T00:59:00.000Z');

    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const result = await buildLiveSessionSnapshot.call(service);

      expect(result.dataQuality.tradeCoverage.realTradeCount).toBe(1);
      expect(result.dataQuality.tradeCoverage.syntheticTradeCount).toBe(1);
      expect(result.dataQuality.historyCoverage.archiveUsed).toBe(true);
      expect(result.dataQuality.confidenceFlags).toContain('synthetic_fallback');
    } finally {
      Date.now = originalNow;
    }
  });

  test('prefers archived real trades over synthetic daily backfill when available', async () => {
    const service = MarketStateService.getInstance() as any;
    const currentSessionStart = Date.parse('2026-04-08T00:00:00.000Z');

    service.store = {
      loadArchivedTrades: (sessionDate: string) =>
        sessionDate === '2026-04-07'
          ? [{ timestamp: Date.parse('2026-04-07T12:00:00.000Z'), price: 105, size: 1, side: 'B', source: 'real' }]
          : [],
    };
    service.callInfoEndpoint = async () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = index + 1;
        return {
          t: Date.parse(`2026-04-${String(day).padStart(2, '0')}T00:00:00.000Z`),
          T: Date.parse(`2026-04-${String(day).padStart(2, '0')}T23:59:59.999Z`),
          o: 100,
          c: 101,
          h: 102,
          l: 99,
          v: 10,
        };
      });

    const sessions = await service.fetchRecentSessionBackfill(currentSessionStart);
    const archivedSession = sessions.find((entry: PersistedSessionSummary) => entry.sessionDate === '2026-04-07');
    const syntheticSession = sessions.find((entry: PersistedSessionSummary) => entry.sessionDate === '2026-04-06');

    expect(archivedSession?.source).toBe('archive');
    expect(archivedSession?.dataQuality.historyCoverage.archiveUsed).toBe(true);
    expect(syntheticSession?.source).toBe('bootstrap');
    expect(syntheticSession?.dataQuality.confidenceFlags).toContain('no_archive_history');
  });

  test('returns the current positioning regime payload', async () => {
    const service = MarketStateService.getInstance() as any;
    const now = Date.parse('2026-04-28T01:00:00.000Z');
    const liveSession = session({
      sessionDate: '2026-04-28',
      high: 104,
      low: 100,
      last: 103.5,
      sessionVwap: 102,
      buyPct: 60,
      sellPct: 40,
    });

    service.ensureStarted = async () => {};
    service.buildLiveSessionSnapshot = async () => liveSession;
    service.store = {
      loadArchivedAssetContext: () => [
        { timestamp: Date.parse('2026-04-28T00:00:00.000Z'), markPx: 100, openInterest: 1000, funding: 0.00005, premium: 0.0001 },
        { timestamp: now, markPx: 100.5, openInterest: 1020, funding: 0.00012, premium: 0.0008 },
      ],
    };

    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const result = await service.getPositioningRegime();

      expect(result.regime.regime).toBe('long_buildup');
      expect(result.assetContextHistoryPoints).toBe(2);
    } finally {
      Date.now = originalNow;
    }
  });

  test('returns the current volatility pace payload', async () => {
    const service = MarketStateService.getInstance() as any;
    const now = Date.parse('2026-04-28T01:00:00.000Z');
    const liveSession = {
      ...session({
        sessionDate: '2026-04-28',
        high: 110,
        low: 100,
        last: 109,
        sessionVwap: 105,
        buyPct: 60,
        sellPct: 40,
      }),
      sessionEnd: now,
      tradeCount: 400,
      totalVolume: 900,
    };

    service.ensureStarted = async () => {};
    service.buildLiveSessionSnapshot = async () => liveSession;
    service.store = {
      loadCompletedSessions: () => [
        { ...session({ sessionDate: '2026-04-25', high: 104, low: 100, last: 103, sessionVwap: 102, buyPct: 50, sellPct: 50 }), tradeCount: 200, totalVolume: 300 },
        { ...session({ sessionDate: '2026-04-26', high: 105, low: 101, last: 104, sessionVwap: 103, buyPct: 50, sellPct: 50 }), tradeCount: 210, totalVolume: 320 },
      ],
    };
    service.bootstrapTrades = [
      { timestamp: Date.parse('2026-04-28T00:35:00.000Z'), price: 107, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:45:00.000Z'), price: 108, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:55:00.000Z'), price: 109, size: 1, side: 'B', source: 'real' },
    ];
    service.liveTrades = [];

    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const result = await service.getVolatilityPace();

      expect(result.pace.regime).toBe('fast');
      expect(result.comparison.currentRange).toBe(10);
    } finally {
      Date.now = originalNow;
    }
  });

  test('returns ranked session analogs for the live session', async () => {
    const service = MarketStateService.getInstance() as any;
    const now = Date.parse('2026-04-28T01:00:00.000Z');
    const liveSession = {
      ...session({
        sessionDate: '2026-04-28',
        high: 110,
        low: 100,
        last: 109,
        sessionVwap: 105,
        buyPct: 61,
        sellPct: 39,
      }),
      sessionEnd: now,
      tradeCount: 400,
      totalVolume: 900,
      cumulativeDelta: 120,
    };
    const completedSessions = [
      {
        ...session({
          sessionDate: '2026-04-27',
          high: 109,
          low: 100,
          last: 108,
          sessionVwap: 104,
          buyPct: 60,
          sellPct: 40,
        }),
        tradeCount: 380,
        totalVolume: 850,
        cumulativeDelta: 110,
      },
      {
        ...session({
          sessionDate: '2026-04-26',
          high: 103,
          low: 100,
          last: 101,
          sessionVwap: 101.5,
          buyPct: 48,
          sellPct: 52,
        }),
        tradeCount: 180,
        totalVolume: 260,
        cumulativeDelta: -20,
      },
    ];

    service.ensureStarted = async () => {};
    service.buildLiveSessionSnapshot = async () => liveSession;
    service.store = {
      loadCompletedSessions: () => completedSessions,
      loadArchivedTrades: (sessionDate: string) =>
        sessionDate === '2026-04-27'
          ? [
              { timestamp: Date.parse('2026-04-27T00:01:00.000Z'), price: 100, size: 1, side: 'B', source: 'real' },
              { timestamp: Date.parse('2026-04-27T00:45:00.000Z'), price: 108, size: 1, side: 'B', source: 'real' },
            ]
          : [
              { timestamp: Date.parse('2026-04-26T00:01:00.000Z'), price: 100, size: 1, side: 'A', source: 'real' },
              { timestamp: Date.parse('2026-04-26T00:45:00.000Z'), price: 101, size: 1, side: 'A', source: 'real' },
            ],
      loadArchivedAssetContext: (sessionDate: string) =>
        sessionDate === '2026-04-27'
          ? [
              { timestamp: Date.parse('2026-04-27T00:00:00.000Z'), markPx: 100, openInterest: 1000, funding: 0.0001, premium: 0.0001 },
              { timestamp: Date.parse('2026-04-27T01:00:00.000Z'), markPx: 108, openInterest: 1040, funding: 0.00014, premium: 0.0007 },
            ]
          : [
              { timestamp: Date.parse('2026-04-26T00:00:00.000Z'), markPx: 100, openInterest: 1000, funding: -0.00005, premium: -0.0001 },
              { timestamp: Date.parse('2026-04-26T01:00:00.000Z'), markPx: 101, openInterest: 980, funding: -0.00008, premium: -0.0002 },
            ],
    };
    service.bootstrapTrades = [
      { timestamp: Date.parse('2026-04-28T00:01:00.000Z'), price: 100, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:45:00.000Z'), price: 108, size: 1, side: 'B', source: 'real' },
      { timestamp: Date.parse('2026-04-28T00:55:00.000Z'), price: 109, size: 1, side: 'B', source: 'real' },
    ];
    service.liveTrades = [];
    service.currentAssetContext = null;
    service.lastAssetContextAt = null;

    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const result = await service.getSessionAnalogs(2);

      expect(result.liveVector.sessionDate).toBe('2026-04-28');
      expect(result.analogs).toHaveLength(2);
      expect(result.analogs[0]?.sessionDate).toBe('2026-04-27');
    } finally {
      Date.now = originalNow;
    }
  });
});
