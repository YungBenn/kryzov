import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AggressionMetrics, AuctionBehavior, InterpretiveRead, SessionRange } from './analytics.js';
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

export interface PersistedSessionSummary {
  sessionDate: string;
  sessionStart: number;
  sessionEnd: number;
  source: 'stream' | 'bootstrap';
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
}

const RECENT_SESSIONS_FILE = 'recent-sessions.json';
const LIVE_SESSION_FILE = 'live-session.json';
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

export class MarketStore {
  private readonly rootPath: string;

  constructor(rootPath: string = getProjectAppPath('market')) {
    this.rootPath = rootPath;
    ensureDir(this.rootPath);
  }

  loadCompletedSessions(): PersistedSessionSummary[] {
    return readJsonFile<PersistedSessionSummary[]>(join(this.rootPath, RECENT_SESSIONS_FILE), []);
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
    return readJsonFile<PersistedSessionSummary | null>(join(this.rootPath, LIVE_SESSION_FILE), null);
  }

  saveLiveSession(session: PersistedSessionSummary): void {
    writeFileSync(join(this.rootPath, LIVE_SESSION_FILE), JSON.stringify(session, null, 2), 'utf8');
  }
}
