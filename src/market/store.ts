import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AggressionMetrics, AuctionBehavior, InterpretiveRead, MarketTrade, SessionRange } from './analytics.js';
import { getProjectAppPath } from '../utils/app-paths.js';

export interface MarketFreshness {
  lastTradeAt: number | null;
  lastAssetContextAt: number | null;
  updatedAt: number;
}

export interface MarketAssetContext {
  markPx?: number | null;
  oraclePx?: number | null;
  funding?: number | null;
  openInterest?: number | null;
  dayNtlVlm?: number | null;
  premium?: number | null;
  [key: string]: unknown;
}

export interface MarketAssetContextPoint extends MarketAssetContext {
  timestamp: number;
}

export interface PersistedSessionSummary {
  sessionDate: string;
  sessionStart: number;
  sessionEnd: number;
  source: 'stream' | 'archive' | 'bootstrap' | 'mixed';
  range: SessionRange;
  sessionVwap: number | null;
  rolling30mVwap: number | null;
  cumulativeDelta: number;
  sessionAggression: AggressionMetrics;
  trailing5mAggression: AggressionMetrics;
  tradeCount: number;
  totalVolume: number;
  lastTradeTimestamp: number | null;
  auctionBehavior: AuctionBehavior;
  interpretiveRead: InterpretiveRead;
  assetContext: MarketAssetContext | null;
  freshness: MarketFreshness;
  dataQuality: MarketDataQuality;
}

export interface MarketDataQuality {
  tradeCoverage: {
    realTradeCount: number;
    syntheticTradeCount: number;
    totalTradeCount: number;
    realTradeVolume: number;
    syntheticTradeVolume: number;
    totalVolume: number;
    realTradeShare: number;
    syntheticTradeShare: number;
  };
  historyCoverage: {
    sessionMinutes: number;
    coveredMinutes: number;
    realTradeMinutes: number;
    syntheticTradeMinutes: number;
    uncoveredMinutes: number;
    realMinuteCoverage: number;
    syntheticFallbackUsed: boolean;
    archiveUsed: boolean;
  };
  freshness: {
    tradeAgeMs: number | null;
    assetContextAgeMs: number | null;
    orderBookAgeMs: number | null;
  };
  confidenceFlags: Array<
    'thin_real_flow' | 'synthetic_fallback' | 'bootstrap_only' | 'stale_trades' | 'stale_book' | 'no_archive_history'
  >;
}

const RECENT_SESSIONS_FILE = 'recent-sessions.json';
const LIVE_SESSION_FILE = 'live-session.json';
const TRADE_ARCHIVE_DIR = 'trade-archive';
const ASSET_CONTEXT_ARCHIVE_DIR = 'asset-context-archive';
const MAX_COMPLETED_SESSIONS = 7;

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function buildEmptyDataQuality(): MarketDataQuality {
  return {
    tradeCoverage: {
      realTradeCount: 0,
      syntheticTradeCount: 0,
      totalTradeCount: 0,
      realTradeVolume: 0,
      syntheticTradeVolume: 0,
      totalVolume: 0,
      realTradeShare: 0,
      syntheticTradeShare: 0,
    },
    historyCoverage: {
      sessionMinutes: 0,
      coveredMinutes: 0,
      realTradeMinutes: 0,
      syntheticTradeMinutes: 0,
      uncoveredMinutes: 0,
      realMinuteCoverage: 0,
      syntheticFallbackUsed: false,
      archiveUsed: false,
    },
    freshness: {
      tradeAgeMs: null,
      assetContextAgeMs: null,
      orderBookAgeMs: null,
    },
    confidenceFlags: [],
  };
}

function normalizeSummary(session: PersistedSessionSummary): PersistedSessionSummary {
  return {
    ...session,
    source: session.source ?? 'bootstrap',
    dataQuality: session.dataQuality ?? buildEmptyDataQuality(),
  };
}

export class MarketStore {
  private readonly rootPath: string;

  constructor(rootPath: string = getProjectAppPath('market')) {
    this.rootPath = rootPath;
    ensureDir(this.rootPath);
    ensureDir(this.getTradeArchivePath());
    ensureDir(this.getAssetContextArchivePath());
  }

  loadCompletedSessions(): PersistedSessionSummary[] {
    return readJsonFile<PersistedSessionSummary[]>(join(this.rootPath, RECENT_SESSIONS_FILE), []).map(normalizeSummary);
  }

  saveCompletedSession(session: PersistedSessionSummary): PersistedSessionSummary[] {
    const deduped = this.loadCompletedSessions().filter(
      (existing) => existing.sessionDate !== session.sessionDate,
    );
    const next = [...deduped, session]
      .sort((left, right) => left.sessionStart - right.sessionStart)
      .slice(-MAX_COMPLETED_SESSIONS);

    writeFileSync(join(this.rootPath, RECENT_SESSIONS_FILE), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  loadLiveSession(): PersistedSessionSummary | null {
    const session = readJsonFile<PersistedSessionSummary | null>(join(this.rootPath, LIVE_SESSION_FILE), null);
    return session ? normalizeSummary(session) : null;
  }

  saveLiveSession(session: PersistedSessionSummary): void {
    writeFileSync(join(this.rootPath, LIVE_SESSION_FILE), JSON.stringify(session, null, 2), 'utf8');
  }

  loadArchivedTrades(sessionDate: string): MarketTrade[] {
    return readJsonFile<MarketTrade[]>(join(this.getTradeArchivePath(), `${sessionDate}.json`), []);
  }

  appendArchivedTrades(sessionDate: string, trades: MarketTrade[]): MarketTrade[] {
    const normalized = trades
      .filter((trade) => Number.isFinite(trade.timestamp) && Number.isFinite(trade.price) && Number.isFinite(trade.size))
      .map((trade) => ({
        ...trade,
        source: 'real' as const,
      }));
    const next = dedupeTrades([...this.loadArchivedTrades(sessionDate), ...normalized]);

    writeFileSync(
      join(this.getTradeArchivePath(), `${sessionDate}.json`),
      JSON.stringify(next, null, 2),
      'utf8',
    );

    return next;
  }

  private getTradeArchivePath(): string {
    return join(this.rootPath, TRADE_ARCHIVE_DIR);
  }

  loadArchivedAssetContext(sessionDate: string): MarketAssetContextPoint[] {
    return readJsonFile<MarketAssetContextPoint[]>(
      join(this.getAssetContextArchivePath(), `${sessionDate}.json`),
      [],
    );
  }

  appendArchivedAssetContext(
    sessionDate: string,
    points: MarketAssetContextPoint[],
  ): MarketAssetContextPoint[] {
    const normalized = points.filter((point) => Number.isFinite(point.timestamp));
    const next = dedupeAssetContextPoints([
      ...this.loadArchivedAssetContext(sessionDate),
      ...normalized,
    ]);

    writeFileSync(
      join(this.getAssetContextArchivePath(), `${sessionDate}.json`),
      JSON.stringify(next, null, 2),
      'utf8',
    );

    return next;
  }

  private getAssetContextArchivePath(): string {
    return join(this.rootPath, ASSET_CONTEXT_ARCHIVE_DIR);
  }
}

function dedupeTrades(trades: MarketTrade[]): MarketTrade[] {
  const byKey = new Map<string, MarketTrade>();

  for (const trade of trades) {
    const key = `${trade.timestamp}:${trade.price}:${trade.size}:${trade.side}`;
    byKey.set(key, { ...trade, source: 'real' });
  }

  return [...byKey.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function dedupeAssetContextPoints(points: MarketAssetContextPoint[]): MarketAssetContextPoint[] {
  const byKey = new Map<string, MarketAssetContextPoint>();

  for (const point of points) {
    const key = [
      point.timestamp,
      point.markPx ?? '',
      point.openInterest ?? '',
      point.funding ?? '',
      point.premium ?? '',
    ].join(':');
    byKey.set(key, point);
  }

  return [...byKey.values()].sort((left, right) => left.timestamp - right.timestamp);
}
