import {
  analyzeLevelResponse,
  classifyAuctionBehavior,
  computeSessionMetrics,
  deriveSessionProfile,
  deriveInterpretiveRead,
  getUtcSessionStart,
  type LevelResponse,
  type MarketTrade,
  type SessionProfile,
  type SessionMetrics,
} from './analytics.js';
import {
  derivePositioningRegime,
  extractSessionFeatureVector,
  rankSessionAnalogs,
  deriveVolatilityPace,
  type PositioningRegime,
  type SessionAnalogMatch,
  type SessionFeatureVector,
  type VolatilityPace,
} from './contextual.js';
import {
  buildReferenceMap,
  deriveIntradayReferences,
  deriveOrderBookState,
  detectFlowEvents,
  type FlowEvent,
  type OrderBookLevel,
  type OrderBookSnapshot,
  type OrderBookState,
  type RankedReference,
} from './microstructure.js';
import {
  MarketStore,
  type MarketAssetContext,
  type MarketAssetContextPoint,
  type MarketDataQuality,
  type MarketFreshness,
  type PersistedSessionSummary,
} from './store.js';

const BTC_COIN = 'BTC';
const DEFAULT_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_INFO_URL = 'https://api.hyperliquid.xyz/info';
const ONE_MINUTE_MS = 60 * 1000;
const STALE_TRADE_WINDOW_MS = 15 * 60 * 1000;
const STALE_BOOK_WINDOW_MS = 5 * 60 * 1000;

interface HyperliquidTradeMessage {
  px?: string | number;
  sz?: string | number;
  side?: string;
  time?: number;
}

interface HyperliquidBookLevelMessage {
  px?: string | number;
  sz?: string | number;
  n?: string | number;
  price?: string | number;
  size?: string | number;
  count?: string | number;
}

interface HyperliquidCandle {
  t: number;
  T: number;
  o: number | string;
  c: number | string;
  h: number | string;
  l: number | string;
  v: number | string;
  n?: number;
}

export interface MarketComparison {
  currentRange: number | null;
  recentAverageRange: number | null;
  rangeRatioVsRecentAverage: number | null;
  rangeComparison: 'wider' | 'narrower' | 'similar' | null;
  recentAverageSessionVwap: number | null;
  sessionVwapVsRecentAverage: number | null;
  sessionVwapComparison: 'higher' | 'lower' | 'similar' | null;
  currentFlowBias: 'buy' | 'sell' | 'balanced' | null;
  recentFlowPattern: string | null;
}

export interface PlainComparisonSummary {
  takeaway: string;
  price: string;
  range: string;
  flow: string;
}

export interface MarketContextSnapshot extends PersistedSessionSummary {
  comparison: MarketComparison;
  levelReferences: Record<string, number | null>;
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

export interface SessionProfileSnapshot {
  profile: SessionProfile;
  liveSession: PersistedSessionSummary;
  levelReferences: Record<string, number | null>;
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

export interface OrderBookStateSnapshot {
  book: OrderBookState | null;
  liveSession: PersistedSessionSummary;
  levelReferences: Record<string, number | null>;
  freshness: {
    lastOrderBookAt: number | null;
    updatedAt: number;
  };
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

export interface FlowEventsSnapshot {
  events: FlowEvent[];
  liveSession: PersistedSessionSummary;
  orderBook: OrderBookState | null;
  levelReferences: Record<string, number | null>;
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

export interface ReferenceMapSnapshot {
  currentPrice: number | null;
  references: RankedReference[];
  liveSession: PersistedSessionSummary;
  levelReferences: Record<string, number | null>;
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

export interface PositioningRegimeSnapshot {
  regime: PositioningRegime;
  liveSession: PersistedSessionSummary;
  assetContextHistoryPoints: number;
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

export interface VolatilityPaceSnapshot {
  pace: VolatilityPace;
  liveSession: PersistedSessionSummary;
  comparison: MarketComparison;
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

export interface SessionAnalogsSnapshot {
  liveVector: SessionFeatureVector;
  analogs: SessionAnalogMatch[];
  liveSession: PersistedSessionSummary;
  comparison: MarketComparison;
  connection: {
    wsConnected: boolean;
    bootstrapOnly: boolean;
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatSessionDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function sortTrades(trades: MarketTrade[]): MarketTrade[] {
  return [...trades].sort((left, right) => left.timestamp - right.timestamp);
}

function dedupeTrades(trades: MarketTrade[]): MarketTrade[] {
  const byKey = new Map<string, MarketTrade>();

  for (const trade of sortTrades(trades)) {
    const key = `${trade.timestamp}:${trade.price}:${trade.size}:${trade.side}`;
    const existing = byKey.get(key);
    if (existing?.source === 'real') {
      continue;
    }
    byKey.set(key, trade);
  }

  return [...byKey.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function getMinuteBucket(timestamp: number): number {
  return Math.floor(timestamp / ONE_MINUTE_MS);
}

function mergeSessionTrades(params: {
  archivedTrades: MarketTrade[];
  syntheticTrades: MarketTrade[];
  liveTrades?: MarketTrade[];
}): MarketTrade[] {
  const realTrades = dedupeTrades([...(params.archivedTrades ?? []), ...(params.liveTrades ?? [])]).map((trade) => ({
    ...trade,
    source: 'real' as const,
  }));
  const realMinuteBuckets = new Set(realTrades.map((trade) => getMinuteBucket(trade.timestamp)));
  const syntheticFallback = (params.syntheticTrades ?? [])
    .filter((trade) => !realMinuteBuckets.has(getMinuteBucket(trade.timestamp)))
    .map((trade) => ({
      ...trade,
      source: 'synthetic' as const,
    }));

  return dedupeTrades([...realTrades, ...syntheticFallback]);
}

function inferSummarySource(trades: MarketTrade[]): PersistedSessionSummary['source'] {
  const realTrades = trades.filter((trade) => trade.source !== 'synthetic').length;
  const syntheticTrades = trades.filter((trade) => trade.source === 'synthetic').length;

  if (realTrades > 0 && syntheticTrades > 0) {
    return 'mixed';
  }

  if (realTrades > 0) {
    return 'archive';
  }

  return 'bootstrap';
}

function computeDataQuality(params: {
  trades: MarketTrade[];
  sessionStart: number;
  now: number;
  freshness: MarketFreshness;
  lastOrderBookAt?: number | null;
  archiveUsed: boolean;
  hasArchiveHistory?: boolean;
  includeLiveFreshnessFlags?: boolean;
}): MarketDataQuality {
  const realTrades = params.trades.filter((trade) => trade.source !== 'synthetic');
  const syntheticTrades = params.trades.filter((trade) => trade.source === 'synthetic');
  const realTradeVolume = realTrades.reduce((sum, trade) => sum + trade.size, 0);
  const syntheticTradeVolume = syntheticTrades.reduce((sum, trade) => sum + trade.size, 0);
  const totalVolume = realTradeVolume + syntheticTradeVolume;
  const totalTradeCount = params.trades.length;
  const sessionMinutes = Math.max(1, Math.ceil((params.now - params.sessionStart) / ONE_MINUTE_MS));
  const realTradeMinutes = new Set(realTrades.map((trade) => getMinuteBucket(trade.timestamp))).size;
  const syntheticTradeMinutes = new Set(syntheticTrades.map((trade) => getMinuteBucket(trade.timestamp))).size;
  const coveredMinutes = new Set(params.trades.map((trade) => getMinuteBucket(trade.timestamp))).size;
  const uncoveredMinutes = Math.max(0, sessionMinutes - coveredMinutes);
  const tradeAgeMs =
    params.freshness.lastTradeAt !== null ? Math.max(0, params.now - params.freshness.lastTradeAt) : null;
  const assetContextAgeMs =
    params.freshness.lastAssetContextAt !== null
      ? Math.max(0, params.now - params.freshness.lastAssetContextAt)
      : null;
  const orderBookAgeMs =
    params.lastOrderBookAt !== undefined && params.lastOrderBookAt !== null
      ? Math.max(0, params.now - params.lastOrderBookAt)
      : null;
  const confidenceFlags: MarketDataQuality['confidenceFlags'] = [];

  if (realTrades.length < 20) {
    confidenceFlags.push('thin_real_flow');
  }
  if (syntheticTrades.length > 0) {
    confidenceFlags.push(realTrades.length === 0 ? 'bootstrap_only' : 'synthetic_fallback');
  }
  if (params.includeLiveFreshnessFlags !== false) {
    if (tradeAgeMs === null || tradeAgeMs > STALE_TRADE_WINDOW_MS) {
      confidenceFlags.push('stale_trades');
    }
    if (orderBookAgeMs === null || orderBookAgeMs > STALE_BOOK_WINDOW_MS) {
      confidenceFlags.push('stale_book');
    }
  }
  if (params.hasArchiveHistory === false) {
    confidenceFlags.push('no_archive_history');
  }

  return {
    tradeCoverage: {
      realTradeCount: realTrades.length,
      syntheticTradeCount: syntheticTrades.length,
      totalTradeCount,
      realTradeVolume,
      syntheticTradeVolume,
      totalVolume,
      realTradeShare: totalTradeCount > 0 ? realTrades.length / totalTradeCount : 0,
      syntheticTradeShare: totalTradeCount > 0 ? syntheticTrades.length / totalTradeCount : 0,
    },
    historyCoverage: {
      sessionMinutes,
      coveredMinutes,
      realTradeMinutes,
      syntheticTradeMinutes,
      uncoveredMinutes,
      realMinuteCoverage: sessionMinutes > 0 ? realTradeMinutes / sessionMinutes : 0,
      syntheticFallbackUsed: syntheticTrades.length > 0,
      archiveUsed: params.archiveUsed,
    },
    freshness: {
      tradeAgeMs,
      assetContextAgeMs,
      orderBookAgeMs,
    },
    confidenceFlags,
  };
}

function buildEmptySummary(sessionStart: number, assetContext: MarketAssetContext | null): PersistedSessionSummary {
  const now = Date.now();
  return {
    sessionDate: formatSessionDate(sessionStart),
    sessionStart,
    sessionEnd: now,
    source: 'bootstrap',
    range: { open: null, high: null, low: null, last: null },
    sessionVwap: null,
    rolling30mVwap: null,
    cumulativeDelta: 0,
    sessionAggression: {
      buyVolume: 0,
      sellVolume: 0,
      buyPct: 0,
      sellPct: 0,
      netDelta: 0,
    },
    trailing5mAggression: {
      buyVolume: 0,
      sellVolume: 0,
      buyPct: 0,
      sellPct: 0,
      netDelta: 0,
    },
    tradeCount: 0,
    totalVolume: 0,
    lastTradeTimestamp: null,
    auctionBehavior: 'balanced',
    interpretiveRead: {
      label: 'balance_to_imbalance_shift',
      phrase: 'Not enough evidence for a session read yet.',
      evidence: ['waiting for measured trade flow'],
    },
    assetContext,
    freshness: {
      lastTradeAt: null,
      lastAssetContextAt: null,
      updatedAt: now,
    },
    dataQuality: computeDataQuality({
      trades: [],
      sessionStart,
      now,
      freshness: {
        lastTradeAt: null,
        lastAssetContextAt: null,
        updatedAt: now,
      },
      lastOrderBookAt: null,
      archiveUsed: false,
      hasArchiveHistory: false,
    }),
  };
}

function buildSummaryFromMetrics(params: {
  metrics: SessionMetrics;
  source: PersistedSessionSummary['source'];
  assetContext: MarketAssetContext | null;
  freshness: MarketFreshness;
  dataQuality: MarketDataQuality;
}): PersistedSessionSummary {
  const sessionDate = formatSessionDate(params.metrics.sessionStart);

  return {
    sessionDate,
    sessionStart: params.metrics.sessionStart,
    sessionEnd: params.metrics.now,
    source: params.source,
    range: params.metrics.range,
    sessionVwap: params.metrics.sessionVwap,
    rolling30mVwap: params.metrics.rolling30mVwap,
    cumulativeDelta: params.metrics.cumulativeDelta,
    sessionAggression: params.metrics.sessionAggression,
    trailing5mAggression: params.metrics.trailing5mAggression,
    tradeCount: params.metrics.tradeCount,
    totalVolume: params.metrics.totalVolume,
    lastTradeTimestamp: params.metrics.lastTradeTimestamp,
    auctionBehavior: classifyAuctionBehavior(params.metrics),
    interpretiveRead: deriveInterpretiveRead(params.metrics),
    assetContext: params.assetContext,
    freshness: params.freshness,
    dataQuality: params.dataQuality,
  };
}

function buildSyntheticTradesFromCandles(candles: HyperliquidCandle[]): MarketTrade[] {
  return candles.map((candle) => {
    const open = toNumber(candle.o) ?? 0;
    const close = toNumber(candle.c) ?? open;
    const volume = Math.max(0, toNumber(candle.v) ?? 0);
    return {
      timestamp: candle.T,
      price: close,
      size: volume,
      side: close >= open ? 'B' : 'A',
      source: 'synthetic',
    };
  });
}

function normalizeTrade(message: HyperliquidTradeMessage): MarketTrade | null {
  const price = toNumber(message.px);
  const size = toNumber(message.sz);
  const timestamp = typeof message.time === 'number' ? message.time : null;
  const side = message.side === 'A' ? 'A' : message.side === 'B' ? 'B' : null;

  if (price === null || size === null || timestamp === null || side === null) {
    return null;
  }

  return { price, size, timestamp, side, source: 'real' };
}

function normalizeAssetContext(raw: unknown): MarketAssetContext | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source =
    'ctx' in (raw as Record<string, unknown>) && typeof (raw as Record<string, unknown>).ctx === 'object'
      ? ((raw as Record<string, unknown>).ctx as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  return {
    ...source,
    markPx: toNumber(source.markPx),
    oraclePx: toNumber(source.oraclePx),
    funding: toNumber(source.funding),
    openInterest: toNumber(source.openInterest),
    dayNtlVlm: toNumber(source.dayNtlVlm),
    premium: toNumber(source.premium),
  };
}

function toAssetContextPoint(
  assetContext: MarketAssetContext,
  timestamp: number,
): MarketAssetContextPoint {
  return {
    timestamp,
    markPx: typeof assetContext.markPx === 'number' ? assetContext.markPx : null,
    oraclePx: typeof assetContext.oraclePx === 'number' ? assetContext.oraclePx : null,
    funding: typeof assetContext.funding === 'number' ? assetContext.funding : null,
    openInterest: typeof assetContext.openInterest === 'number' ? assetContext.openInterest : null,
    dayNtlVlm: typeof assetContext.dayNtlVlm === 'number' ? assetContext.dayNtlVlm : null,
    premium: typeof assetContext.premium === 'number' ? assetContext.premium : null,
  };
}

function normalizeBookLevel(raw: unknown): OrderBookLevel | null {
  if (Array.isArray(raw)) {
    const price = toNumber(raw[0]);
    const size = toNumber(raw[1]);
    const count = toNumber(raw[2]);

    if (price === null || size === null) {
      return null;
    }

    return {
      price,
      size,
      count,
    };
  }

  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const message = raw as HyperliquidBookLevelMessage;
  const price = toNumber(message.px ?? message.price);
  const size = toNumber(message.sz ?? message.size);
  const count = toNumber(message.n ?? message.count);

  if (price === null || size === null) {
    return null;
  }

  return {
    price,
    size,
    count,
  };
}

function normalizeOrderBook(raw: unknown): OrderBookSnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const levels =
    Array.isArray(source.levels) && source.levels.length >= 2
      ? source.levels
      : Array.isArray(source.book) && source.book.length >= 2
        ? source.book
        : null;
  const bidsRaw = Array.isArray(source.bids)
    ? source.bids
    : levels && Array.isArray(levels[0])
      ? (levels[0] as unknown[])
      : null;
  const asksRaw = Array.isArray(source.asks)
    ? source.asks
    : levels && Array.isArray(levels[1])
      ? (levels[1] as unknown[])
      : null;

  if (!bidsRaw || !asksRaw) {
    return null;
  }

  const bids = bidsRaw
    .map(normalizeBookLevel)
    .filter((level): level is OrderBookLevel => level !== null)
    .sort((left, right) => right.price - left.price);
  const asks = asksRaw
    .map(normalizeBookLevel)
    .filter((level): level is OrderBookLevel => level !== null)
    .sort((left, right) => left.price - right.price);
  const timestamp = toNumber(source.time) ?? toNumber(source.ts) ?? Date.now();

  if (bids.length === 0 || asks.length === 0) {
    return null;
  }

  return {
    bids,
    asks,
    timestamp,
  };
}

function classifyRangeComparison(ratio: number | null): 'wider' | 'narrower' | 'similar' | null {
  if (ratio === null) {
    return null;
  }

  if (ratio >= 1.25) {
    return 'wider';
  }

  if (ratio <= 0.8) {
    return 'narrower';
  }

  return 'similar';
}

function classifyPriceComparison(diff: number | null): 'higher' | 'lower' | 'similar' | null {
  if (diff === null) {
    return null;
  }

  if (diff >= 100) {
    return 'higher';
  }

  if (diff <= -100) {
    return 'lower';
  }

  return 'similar';
}

function classifyFlowBias(buyPct: number, sellPct: number): 'buy' | 'sell' | 'balanced' {
  const diff = buyPct - sellPct;

  if (Math.abs(diff) < 4) {
    return 'balanced';
  }

  return diff > 0 ? 'buy' : 'sell';
}

function summarizeRecentFlowPattern(recentSessions: PersistedSessionSummary[]): string | null {
  if (recentSessions.length === 0) {
    return null;
  }

  const oneSidedCount = recentSessions.filter((session) =>
    Math.abs(session.sessionAggression.buyPct - session.sessionAggression.sellPct) >= 30,
  ).length;
  const buyCount = recentSessions.filter(
    (session) => classifyFlowBias(session.sessionAggression.buyPct, session.sessionAggression.sellPct) === 'buy',
  ).length;
  const sellCount = recentSessions.filter(
    (session) => classifyFlowBias(session.sessionAggression.buyPct, session.sessionAggression.sellPct) === 'sell',
  ).length;

  if (oneSidedCount >= Math.ceil(recentSessions.length * 0.6)) {
    return 'recent sessions were mostly one-sided';
  }

  if (buyCount > sellCount) {
    return 'recent sessions mostly leaned to buyers';
  }

  if (sellCount > buyCount) {
    return 'recent sessions mostly leaned to sellers';
  }

  return 'recent sessions were mixed';
}

export function computeComparison(
  liveSession: PersistedSessionSummary,
  recentSessions: PersistedSessionSummary[],
): MarketComparison {
  const recentRanges = recentSessions
    .map((session) =>
      session.range.high !== null && session.range.low !== null ? session.range.high - session.range.low : null,
    )
    .filter((value): value is number => value !== null);

  const recentAverageRange =
    recentRanges.length > 0
      ? recentRanges.reduce((sum, value) => sum + value, 0) / recentRanges.length
      : null;
  const recentSessionVwaps = recentSessions
    .map((session) => session.sessionVwap)
    .filter((value): value is number => value !== null);
  const currentRange =
    liveSession.range.high !== null && liveSession.range.low !== null
      ? liveSession.range.high - liveSession.range.low
      : null;
  const rangeRatioVsRecentAverage =
    currentRange !== null && recentAverageRange && recentAverageRange > 0
      ? currentRange / recentAverageRange
      : null;
  const recentAverageSessionVwap =
    recentSessionVwaps.length > 0
      ? recentSessionVwaps.reduce((sum, value) => sum + value, 0) / recentSessionVwaps.length
      : null;
  const sessionVwapVsRecentAverage =
    liveSession.sessionVwap !== null && recentAverageSessionVwap !== null
      ? liveSession.sessionVwap - recentAverageSessionVwap
      : null;

  return {
    currentRange,
    recentAverageRange,
    rangeRatioVsRecentAverage,
    rangeComparison: classifyRangeComparison(rangeRatioVsRecentAverage),
    recentAverageSessionVwap,
    sessionVwapVsRecentAverage,
    sessionVwapComparison: classifyPriceComparison(sessionVwapVsRecentAverage),
    currentFlowBias: classifyFlowBias(
      liveSession.sessionAggression.buyPct,
      liveSession.sessionAggression.sellPct,
    ),
    recentFlowPattern: summarizeRecentFlowPattern(recentSessions),
  };
}

export function buildPlainComparisonSummary(comparison: MarketComparison): PlainComparisonSummary {
  const price =
    comparison.sessionVwapComparison === 'lower'
      ? 'Price is trading lower than the recent average.'
      : comparison.sessionVwapComparison === 'higher'
        ? 'Price is trading higher than the recent average.'
        : 'Price is trading near the recent average.';
  const range =
    comparison.rangeComparison === 'wider'
      ? 'The session range is wider than the recent average.'
      : comparison.rangeComparison === 'narrower'
        ? 'The session range is narrower than the recent average.'
        : 'The session range is close to the recent average.';
  const flow =
    comparison.currentFlowBias === 'sell'
      ? 'Sellers still have a small sell edge today.'
      : comparison.currentFlowBias === 'buy'
        ? 'Buyers still have a small buy edge today.'
        : 'Order flow is broadly balanced today.';

  const takeawayParts: string[] = [];
  if (comparison.sessionVwapComparison === 'lower') {
    takeawayParts.push('lower in price');
  } else if (comparison.sessionVwapComparison === 'higher') {
    takeawayParts.push('higher in price');
  }

  if (comparison.recentFlowPattern?.includes('one-sided') || comparison.currentFlowBias === 'balanced') {
    takeawayParts.push('more balanced');
  }

  const takeaway =
    takeawayParts.length > 0
      ? `The current session is ${takeawayParts.join(' and ')} than the recent sessions.`
      : 'The current session is broadly similar to the recent sessions.';

  return {
    takeaway,
    price,
    range,
    flow,
  };
}

function getLevelReferences(
  liveSession: PersistedSessionSummary,
  recentSessions: PersistedSessionSummary[],
  trades: MarketTrade[],
  now: number,
): Record<string, number | null> {
  const previousSession = recentSessions[recentSessions.length - 1] ?? null;
  const intradayReferences = deriveIntradayReferences({
    trades,
    sessionStart: liveSession.sessionStart,
    now,
  });

  return {
    session_open: liveSession.range.open,
    session_high: liveSession.range.high,
    session_low: liveSession.range.low,
    session_vwap: liveSession.sessionVwap,
    prior_session_high: previousSession?.range.high ?? null,
    prior_session_low: previousSession?.range.low ?? null,
    prior_session_vwap: previousSession?.sessionVwap ?? null,
    ...intradayReferences,
  };
}

export class MarketStateService {
  private static instance: MarketStateService | null = null;

  static getInstance(): MarketStateService {
    if (!MarketStateService.instance) {
      MarketStateService.instance = new MarketStateService();
    }
    return MarketStateService.instance;
  }

  private readonly store = new MarketStore();
  private readonly wsUrl = process.env.HYPERLIQUID_WS_URL ?? DEFAULT_WS_URL;
  private readonly infoUrl = process.env.HYPERLIQUID_INFO_URL ?? DEFAULT_INFO_URL;
  private bootstrapTrades: MarketTrade[] = [];
  private liveTrades: MarketTrade[] = [];
  private currentOrderBook: OrderBookSnapshot | null = null;
  private previousOrderBook: OrderBookSnapshot | null = null;
  private currentAssetContext: MarketAssetContext | null = null;
  private lastTradeAt: number | null = null;
  private lastOrderBookAt: number | null = null;
  private lastAssetContextAt: number | null = null;
  private started = false;
  private starting: Promise<void> | null = null;
  private ws: WebSocket | null = null;
  private reconnectDelayMs = 1_000;
  private wsConnected = false;

  async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }
    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = this.start();
    await this.starting;
    this.starting = null;
  }

  async getMarketContext(): Promise<MarketContextSnapshot> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const recentSessions = this.store.loadCompletedSessions();
    const trades = [...this.bootstrapTrades, ...this.liveTrades];
    return {
      ...liveSession,
      comparison: computeComparison(liveSession, recentSessions),
      levelReferences: getLevelReferences(liveSession, recentSessions, trades, Date.now()),
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getRecentSessions(limit = 7): Promise<{
    sessions: PersistedSessionSummary[];
    comparison: MarketComparison;
    plainComparison: PlainComparisonSummary;
    liveSession: PersistedSessionSummary;
  }> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const sessions = this.store.loadCompletedSessions().slice(-limit);
    const comparison = computeComparison(liveSession, sessions);
    return {
      sessions,
      comparison,
      plainComparison: buildPlainComparisonSummary(comparison),
      liveSession,
    };
  }

  async getSessionProfile(): Promise<SessionProfileSnapshot> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const recentSessions = this.store.loadCompletedSessions();
    const trades = [...this.bootstrapTrades, ...this.liveTrades];
    const levelReferences = getLevelReferences(liveSession, recentSessions, trades, Date.now());

    return {
      profile: deriveSessionProfile({
        metrics: {
          sessionStart: liveSession.sessionStart,
          now: liveSession.sessionEnd,
          sessionVwap: liveSession.sessionVwap,
          rolling30mVwap: liveSession.rolling30mVwap,
          cumulativeDelta: liveSession.cumulativeDelta,
          sessionAggression: liveSession.sessionAggression,
          trailing5mAggression: liveSession.trailing5mAggression,
          range: liveSession.range,
          tradeCount: liveSession.tradeCount,
          totalVolume: liveSession.totalVolume,
          lastTradeTimestamp: liveSession.lastTradeTimestamp,
        },
        trades,
        now: Date.now(),
        freshness: liveSession.freshness,
        recentSessions,
        levelReferences,
      }),
      liveSession,
      levelReferences,
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getOrderBookState(): Promise<OrderBookStateSnapshot> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const recentSessions = this.store.loadCompletedSessions();
    const trades = [...this.bootstrapTrades, ...this.liveTrades];

    return {
      book: this.currentOrderBook
        ? deriveOrderBookState({
            book: this.currentOrderBook,
            previousBook: this.previousOrderBook,
          })
        : null,
      liveSession,
      levelReferences: getLevelReferences(liveSession, recentSessions, trades, Date.now()),
      freshness: {
        lastOrderBookAt: this.lastOrderBookAt,
        updatedAt: Date.now(),
      },
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getFlowEvents(limit = 5): Promise<FlowEventsSnapshot> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const recentSessions = this.store.loadCompletedSessions();
    const trades = [...this.bootstrapTrades, ...this.liveTrades];
    const now = Date.now();
    const levelReferences = getLevelReferences(liveSession, recentSessions, trades, now);
    const orderBook = this.currentOrderBook
      ? deriveOrderBookState({
          book: this.currentOrderBook,
          previousBook: this.previousOrderBook,
        })
      : null;

    return {
      events: detectFlowEvents({
        trades,
        now,
        metrics: {
          sessionStart: liveSession.sessionStart,
          now: liveSession.sessionEnd,
          sessionVwap: liveSession.sessionVwap,
          rolling30mVwap: liveSession.rolling30mVwap,
          cumulativeDelta: liveSession.cumulativeDelta,
          sessionAggression: liveSession.sessionAggression,
          trailing5mAggression: liveSession.trailing5mAggression,
          range: liveSession.range,
          tradeCount: liveSession.tradeCount,
          totalVolume: liveSession.totalVolume,
          lastTradeTimestamp: liveSession.lastTradeTimestamp,
        },
        orderBookState: orderBook,
        levelReferences,
      }).slice(0, limit),
      liveSession,
      orderBook,
      levelReferences,
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getReferenceMap(limit = 8): Promise<ReferenceMapSnapshot> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const recentSessions = this.store.loadCompletedSessions();
    const trades = [...this.bootstrapTrades, ...this.liveTrades];
    const levelReferences = getLevelReferences(liveSession, recentSessions, trades, Date.now());

    return {
      currentPrice: liveSession.range.last,
      references: buildReferenceMap({
        trades,
        now: Date.now(),
        currentPrice: liveSession.range.last,
        references: levelReferences,
        limit,
      }),
      liveSession,
      levelReferences,
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getPositioningRegime(): Promise<PositioningRegimeSnapshot> {
    await this.ensureStarted();
    const now = Date.now();
    const liveSession = await this.buildLiveSessionSnapshot();
    const assetContextHistory = this.loadCurrentSessionAssetContextHistory(now);

    return {
      regime: derivePositioningRegime({
        assetContextHistory,
        now,
        sessionStart: liveSession.sessionStart,
      }),
      liveSession,
      assetContextHistoryPoints: assetContextHistory.length,
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getVolatilityPace(): Promise<VolatilityPaceSnapshot> {
    await this.ensureStarted();
    const now = Date.now();
    const liveSession = await this.buildLiveSessionSnapshot();
    const recentSessions = this.store.loadCompletedSessions();
    const trades = dedupeTrades([...this.bootstrapTrades, ...this.liveTrades]);

    return {
      pace: deriveVolatilityPace({
        liveSession,
        recentSessions,
        trades,
        now,
      }),
      liveSession,
      comparison: computeComparison(liveSession, recentSessions),
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getSessionAnalogs(limit = 3): Promise<SessionAnalogsSnapshot> {
    await this.ensureStarted();
    const now = Date.now();
    const liveSession = await this.buildLiveSessionSnapshot();
    const completedSessions = this.store.loadCompletedSessions();
    const liveTrades = dedupeTrades([...this.bootstrapTrades, ...this.liveTrades]);
    const liveAssetContextHistory = this.loadCurrentSessionAssetContextHistory(now);
    const liveVector = extractSessionFeatureVector({
      session: liveSession,
      trades: liveTrades,
      assetContextHistory: liveAssetContextHistory,
      baselineSessions: completedSessions,
      now,
    });

    const historicalVectors = completedSessions.map((session, index, sessions) => {
      const sessionTrades = this.store.loadArchivedTrades(session.sessionDate).map((trade) => ({
        ...trade,
        source: 'real' as const,
      }));
      const assetContextHistory = this.store.loadArchivedAssetContext(session.sessionDate);
      const baselineSessions = sessions.slice(Math.max(0, index - 3), index);

      return extractSessionFeatureVector({
        session,
        trades: sessionTrades,
        assetContextHistory,
        baselineSessions,
        now: session.sessionEnd,
      });
    });

    return {
      liveVector,
      analogs: rankSessionAnalogs({
        liveVector,
        historicalVectors,
        limit,
      }),
      liveSession,
      comparison: computeComparison(liveSession, completedSessions),
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getLevelResponse(params: { level?: number; reference?: string }): Promise<{
    reference: string;
    level: number | null;
    response: LevelResponse;
    liveSession: PersistedSessionSummary;
  }> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const recentSessions = this.store.loadCompletedSessions();
    const trades = [...this.bootstrapTrades, ...this.liveTrades];
    const references = getLevelReferences(liveSession, recentSessions, trades, Date.now());
    const reference = params.reference ?? 'session_vwap';
    const level = params.level ?? references[reference] ?? null;
    if (level === null) {
      return {
        reference,
        level: null,
        response: {
          status: 'untested',
          direction: null,
          crossedAt: null,
          netDeltaAfterCross: 0,
          dwellRatio: 0,
        },
        liveSession,
      };
    }
    return {
      reference,
      level,
      response: analyzeLevelResponse({
        level,
        trades,
        now: Date.now(),
      }),
      liveSession,
    };
  }

  private async start(): Promise<void> {
    await this.bootstrap();
    this.connectWebSocket();
    this.started = true;
  }

  private async bootstrap(): Promise<void> {
    const now = Date.now();
    const sessionStart = getUtcSessionStart(now);
    const storedLive = this.store.loadLiveSession();
    const storedSessionDate = storedLive?.sessionDate;
    const currentSessionDate = formatSessionDate(sessionStart);

    if (storedLive && storedSessionDate && storedSessionDate !== currentSessionDate) {
      this.store.saveCompletedSession(storedLive);
    }

    this.currentAssetContext = await this.fetchCurrentAssetContext().catch(() => storedLive?.assetContext ?? null);
    this.lastAssetContextAt = this.currentAssetContext ? now : storedLive?.freshness.lastAssetContextAt ?? null;
    if (this.currentAssetContext) {
      this.store.appendArchivedAssetContext(currentSessionDate, [
        toAssetContextPoint(this.currentAssetContext, now),
      ]);
    }
    this.currentOrderBook = await this.fetchCurrentOrderBook().catch(() => null);
    this.previousOrderBook = null;
    this.lastOrderBookAt = this.currentOrderBook?.timestamp ?? (this.currentOrderBook ? now : null);
    const archivedTrades = this.store.loadArchivedTrades(currentSessionDate).map((trade) => ({
      ...trade,
      source: 'real' as const,
    }));
    const syntheticTrades = await this.fetchCurrentSessionBootstrapTrades(sessionStart).catch(() => []);
    this.bootstrapTrades = mergeSessionTrades({
      archivedTrades,
      syntheticTrades,
    });
    this.liveTrades = [];

    if (this.store.loadCompletedSessions().length === 0) {
      const recent = await this.fetchRecentSessionBackfill(sessionStart).catch(() => []);
      for (const session of recent) {
        this.store.saveCompletedSession(session);
      }
    }

    await this.persistLiveSnapshot();
  }

  private connectWebSocket(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch {
      this.wsConnected = false;
      return;
    }

    this.ws.addEventListener('open', () => {
      this.wsConnected = true;
      this.reconnectDelayMs = 1_000;
      this.ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: BTC_COIN } }));
      this.ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: BTC_COIN } }));
      this.ws?.send(
        JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin: BTC_COIN } }),
      );
    });

    this.ws.addEventListener('message', (event) => {
      void this.handleWebSocketMessage(event.data);
    });

    this.ws.addEventListener('close', () => {
      this.wsConnected = false;
      this.scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.wsConnected = false;
    });
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    setTimeout(() => this.connectWebSocket(), delay);
  }

  private async handleWebSocketMessage(payload: string | ArrayBufferLike | Blob | ArrayBufferView): Promise<void> {
    if (typeof payload !== 'string') {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }

    const channel = parsed.channel;
    if (channel === 'trades' && Array.isArray(parsed.data)) {
      const tradesBySessionDate = new Map<string, MarketTrade[]>();
      for (const item of parsed.data) {
        const trade = normalizeTrade(item as HyperliquidTradeMessage);
        if (!trade) {
          continue;
        }
        this.rollSessionIfNeeded(trade.timestamp);
        this.liveTrades.push(trade);
        this.lastTradeAt = trade.timestamp;
        const sessionDate = formatSessionDate(trade.timestamp);
        const existing = tradesBySessionDate.get(sessionDate) ?? [];
        existing.push(trade);
        tradesBySessionDate.set(sessionDate, existing);
      }
      for (const [sessionDate, trades] of tradesBySessionDate.entries()) {
        this.store.appendArchivedTrades(sessionDate, trades);
      }
      await this.persistLiveSnapshot();
      return;
    }

    if (channel === 'activeAssetCtx') {
      const normalized = normalizeAssetContext(parsed.data);
      if (normalized) {
        const timestamp = Date.now();
        this.currentAssetContext = normalized;
        this.lastAssetContextAt = timestamp;
        this.store.appendArchivedAssetContext(formatSessionDate(timestamp), [
          toAssetContextPoint(normalized, timestamp),
        ]);
        await this.persistLiveSnapshot();
      }
      return;
    }

    if (channel === 'l2Book') {
      const normalized = normalizeOrderBook(parsed.data);
      if (normalized) {
        this.previousOrderBook = this.currentOrderBook;
        this.currentOrderBook = normalized;
        this.lastOrderBookAt = normalized.timestamp;
      }
    }
  }

  private rollSessionIfNeeded(timestamp: number): void {
    const nextSessionStart = getUtcSessionStart(timestamp);
    const currentSessionStart = this.bootstrapTrades[0]
      ? getUtcSessionStart(this.bootstrapTrades[0].timestamp)
      : getUtcSessionStart(Date.now());

    if (nextSessionStart === currentSessionStart) {
      return;
    }

    const combinedTrades = [...this.bootstrapTrades, ...this.liveTrades];
    if (combinedTrades.length > 0) {
      const sessionTrades = dedupeTrades(combinedTrades);
      const metrics = computeSessionMetrics({
        trades: sessionTrades,
        now: timestamp - 1,
        sessionStart: currentSessionStart,
      });
      const summary = buildSummaryFromMetrics({
        metrics,
        source: inferSummarySource(sessionTrades),
        assetContext: this.currentAssetContext,
        freshness: this.getFreshness(),
        dataQuality: computeDataQuality({
          trades: sessionTrades,
          sessionStart: currentSessionStart,
          now: timestamp - 1,
          freshness: this.getFreshness(),
          lastOrderBookAt: this.lastOrderBookAt,
          archiveUsed: sessionTrades.some((trade) => trade.source !== 'synthetic'),
          hasArchiveHistory: sessionTrades.some((trade) => trade.source !== 'synthetic'),
          includeLiveFreshnessFlags: false,
        }),
      });
      this.store.saveCompletedSession(summary);
    }

    this.bootstrapTrades = [];
    this.liveTrades = [];
    void this.refreshSessionBootstrap(nextSessionStart);
  }

  private async refreshSessionBootstrap(sessionStart: number): Promise<void> {
    const sessionDate = formatSessionDate(sessionStart);
    const archivedTrades = this.store.loadArchivedTrades(sessionDate).map((trade) => ({
      ...trade,
      source: 'real' as const,
    }));
    const syntheticTrades = await this.fetchCurrentSessionBootstrapTrades(sessionStart).catch(() => []);
    this.bootstrapTrades = mergeSessionTrades({
      archivedTrades,
      syntheticTrades,
    });
    await this.persistLiveSnapshot();
  }

  private getFreshness(): MarketFreshness {
    return {
      lastTradeAt: this.lastTradeAt,
      lastAssetContextAt: this.lastAssetContextAt,
      updatedAt: Date.now(),
    };
  }

  private loadCurrentSessionAssetContextHistory(now: number): MarketAssetContextPoint[] {
    const sessionDate = formatSessionDate(getUtcSessionStart(now));
    const points = this.store.loadArchivedAssetContext(sessionDate);
    const combined =
      this.currentAssetContext && this.lastAssetContextAt !== null
        ? [...points, toAssetContextPoint(this.currentAssetContext, this.lastAssetContextAt)]
        : points;
    const byKey = new Map<string, MarketAssetContextPoint>();

    for (const point of combined) {
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

  private async buildLiveSessionSnapshot(): Promise<PersistedSessionSummary> {
    const now = Date.now();
    const sessionStart = getUtcSessionStart(now);
    const sessionDate = formatSessionDate(sessionStart);
    const trades = dedupeTrades([...this.bootstrapTrades, ...this.liveTrades]);
    const archiveTradeCount = this.store.loadArchivedTrades(sessionDate).length;

    if (trades.length === 0) {
      const stored = this.store.loadLiveSession();
      if (stored && stored.sessionDate === formatSessionDate(sessionStart)) {
        return stored;
      }
      return buildEmptySummary(sessionStart, this.currentAssetContext);
    }

    const metrics = computeSessionMetrics({
      trades,
      now,
      sessionStart,
    });
    return buildSummaryFromMetrics({
      metrics,
      source: inferSummarySource(trades),
      assetContext: this.currentAssetContext,
      freshness: this.getFreshness(),
      dataQuality: computeDataQuality({
        trades,
        sessionStart,
        now,
        freshness: this.getFreshness(),
        lastOrderBookAt: this.lastOrderBookAt,
        archiveUsed: archiveTradeCount > 0,
        hasArchiveHistory: archiveTradeCount > 0,
      }),
    });
  }

  private async persistLiveSnapshot(): Promise<void> {
    const snapshot = await this.buildLiveSessionSnapshot();
    this.store.saveLiveSession(snapshot);
  }

  private async callInfoEndpoint<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.infoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid info request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }

  private async fetchCurrentSessionBootstrapTrades(sessionStart: number): Promise<MarketTrade[]> {
    const candles = await this.callInfoEndpoint<HyperliquidCandle[]>({
      type: 'candleSnapshot',
      req: {
        coin: BTC_COIN,
        interval: '1m',
        startTime: sessionStart,
        endTime: Date.now(),
      },
    });
    return buildSyntheticTradesFromCandles(candles);
  }

  private async fetchRecentSessionBackfill(currentSessionStart: number): Promise<PersistedSessionSummary[]> {
    const startTime = currentSessionStart - 8 * 24 * 60 * 60 * 1000;
    const endTime = currentSessionStart - 1;
    const candles = await this.callInfoEndpoint<HyperliquidCandle[]>({
      type: 'candleSnapshot',
      req: {
        coin: BTC_COIN,
        interval: '1d',
        startTime,
        endTime,
      },
    });
    const candleByDate = new Map(
      candles.map((candle) => [formatSessionDate(candle.t), candle] as const),
    );
    const sessionStarts = Array.from({ length: 7 }, (_, index) => currentSessionStart - (7 - index) * 24 * 60 * 60 * 1000);

    return sessionStarts.flatMap((sessionStart) => {
      const sessionDate = formatSessionDate(sessionStart);
      const archivedTrades = this.store.loadArchivedTrades(sessionDate).map((trade) => ({
        ...trade,
        source: 'real' as const,
      }));
      const candle = candleByDate.get(sessionDate);
      const syntheticTrades = candle ? buildSyntheticTradesFromCandles([candle]) : [];
      const sessionTrades =
        archivedTrades.length > 0
          ? dedupeTrades(archivedTrades)
          : dedupeTrades(syntheticTrades);

      if (sessionTrades.length === 0) {
        return [];
      }

      const sessionEnd = candle?.T ?? (sessionStart + 24 * 60 * 60 * 1000 - 1);
      const freshness = {
        lastTradeAt: sessionEnd,
        lastAssetContextAt: null,
        updatedAt: sessionEnd,
      };
      const metrics = computeSessionMetrics({
        trades: sessionTrades,
        now: sessionEnd,
        sessionStart,
      });

      return [
        buildSummaryFromMetrics({
          metrics,
          source: archivedTrades.length > 0 ? 'archive' : 'bootstrap',
          assetContext: null,
          freshness,
          dataQuality: computeDataQuality({
            trades: sessionTrades,
            sessionStart,
            now: sessionEnd,
            freshness,
            lastOrderBookAt: null,
            archiveUsed: archivedTrades.length > 0,
            hasArchiveHistory: archivedTrades.length > 0,
            includeLiveFreshnessFlags: false,
          }),
        }),
      ];
    });
  }

  private async fetchCurrentAssetContext(): Promise<MarketAssetContext | null> {
    const response = await this.callInfoEndpoint<unknown>({
      type: 'metaAndAssetCtxs',
    });

    if (!Array.isArray(response) || response.length < 2) {
      return null;
    }

    const [meta, assetContexts] = response;
    const universe = meta && typeof meta === 'object' && Array.isArray((meta as Record<string, unknown>).universe)
      ? ((meta as Record<string, unknown>).universe as Array<Record<string, unknown>>)
      : [];
    const btcIndex = universe.findIndex((item) => item.name === BTC_COIN);
    if (btcIndex === -1 || !Array.isArray(assetContexts)) {
      return null;
    }

    return normalizeAssetContext(assetContexts[btcIndex]);
  }

  private async fetchCurrentOrderBook(): Promise<OrderBookSnapshot | null> {
    const response = await this.callInfoEndpoint<unknown>({
      type: 'l2Book',
      coin: BTC_COIN,
    });

    return normalizeOrderBook(response);
  }
}
