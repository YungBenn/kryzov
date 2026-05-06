import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarketStore, type PersistedSessionSummary } from './store.js';

const TEST_ROOT = join(tmpdir(), 'kryzov-market-store-test');

function session(sessionDate: string): PersistedSessionSummary {
  return {
    sessionDate,
    sessionStart: Date.parse(`${sessionDate}T00:00:00.000Z`),
    sessionEnd: Date.parse(`${sessionDate}T23:59:59.999Z`),
    source: 'stream',
    range: {
      open: 100,
      high: 110,
      low: 95,
      last: 105,
    },
    sessionVwap: 102,
    rolling30mVwap: 104,
    cumulativeDelta: 5,
    sessionAggression: {
      buyVolume: 10,
      sellVolume: 5,
      buyPct: 66.67,
      sellPct: 33.33,
      netDelta: 5,
    },
    trailing5mAggression: {
      buyVolume: 3,
      sellVolume: 1,
      buyPct: 75,
      sellPct: 25,
      netDelta: 2,
    },
    tradeCount: 50,
    totalVolume: 15,
    lastTradeTimestamp: Date.parse(`${sessionDate}T23:59:00.000Z`),
    auctionBehavior: 'initiative',
    interpretiveRead: {
      label: 'initiative_continuation',
      phrase: 'This reads as initiative continuation so far.',
      evidence: ['session delta 5.00'],
    },
    assetContext: null,
    freshness: {
      lastTradeAt: Date.parse(`${sessionDate}T23:59:00.000Z`),
      lastAssetContextAt: null,
      updatedAt: Date.parse(`${sessionDate}T23:59:59.999Z`),
    },
    dataQuality: {
      tradeCoverage: {
        realTradeCount: 50,
        syntheticTradeCount: 0,
        totalTradeCount: 50,
        realTradeVolume: 15,
        syntheticTradeVolume: 0,
        totalVolume: 15,
        realTradeShare: 1,
        syntheticTradeShare: 0,
      },
      historyCoverage: {
        sessionMinutes: 1440,
        coveredMinutes: 50,
        realTradeMinutes: 50,
        syntheticTradeMinutes: 0,
        uncoveredMinutes: 1390,
        realMinuteCoverage: 50 / 1440,
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

describe('MarketStore', () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('retains only the 7 most recent completed sessions and persists live state', () => {
    const store = new MarketStore(TEST_ROOT);

    for (let day = 1; day <= 9; day++) {
      const date = `2026-04-${String(day).padStart(2, '0')}`;
      store.saveCompletedSession(session(date));
    }

    const live = session('2026-04-10');
    store.saveLiveSession(live);

    const recent = store.loadCompletedSessions();
    expect(recent).toHaveLength(7);
    expect(recent[0]?.sessionDate).toBe('2026-04-03');
    expect(recent[6]?.sessionDate).toBe('2026-04-09');
    expect(store.loadLiveSession()?.sessionDate).toBe('2026-04-10');
    expect(existsSync(join(TEST_ROOT, 'live-session.json'))).toBe(true);
    expect(existsSync(join(TEST_ROOT, 'recent-sessions.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(TEST_ROOT, 'recent-sessions.json'), 'utf8'))).toHaveLength(7);
  });

  test('archives and dedupes real trades by UTC session date', () => {
    const store = new MarketStore(TEST_ROOT);

    store.appendArchivedTrades('2026-04-10', [
      { timestamp: 1, price: 100, size: 1, side: 'B', source: 'real' },
      { timestamp: 1, price: 100, size: 1, side: 'B', source: 'real' },
      { timestamp: 2, price: 101, size: 2, side: 'A', source: 'real' },
    ]);

    const archived = store.loadArchivedTrades('2026-04-10');

    expect(archived).toHaveLength(2);
    expect(archived[0]?.source).toBe('real');
    expect(existsSync(join(TEST_ROOT, 'trade-archive', '2026-04-10.json'))).toBe(true);
  });

  test('archives and dedupes asset-context history by UTC session date', () => {
    const store = new MarketStore(TEST_ROOT);

    store.appendArchivedAssetContext('2026-04-10', [
      { timestamp: 1, markPx: 100, openInterest: 1000, funding: 0.0001, premium: 0.0002 },
      { timestamp: 1, markPx: 100, openInterest: 1000, funding: 0.0001, premium: 0.0002 },
      { timestamp: 2, markPx: 101, openInterest: 1010, funding: 0.00015, premium: 0.0003 },
    ]);

    const archived = store.loadArchivedAssetContext('2026-04-10');

    expect(archived).toHaveLength(2);
    expect(archived[1]?.markPx).toBe(101);
    expect(existsSync(join(TEST_ROOT, 'asset-context-archive', '2026-04-10.json'))).toBe(true);
  });
});
