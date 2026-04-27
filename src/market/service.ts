import {
  analyzeLevelResponse,
  classifyAuctionBehavior,
  computeSessionMetrics,
  deriveInterpretiveRead,
  getUtcSessionStart,
  type LevelResponse,
  type MarketTrade,
  type SessionMetrics,
} from './analytics.js';
import {
  MarketStore,
  type MarketAssetContext,
  type MarketFreshness,
  type PersistedSessionSummary,
} from './store.js';

const BTC_COIN = 'BTC';
const DEFAULT_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_INFO_URL = 'https://api.hyperliquid.xyz/info';

interface HyperliquidTradeMessage {
  px?: string | number;
  sz?: string | number;
  side?: string;
  time?: number;
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
  rangeVsRecentAverage: number | null;
  sessionVwapDistance: number | null;
}

export interface MarketContextSnapshot extends PersistedSessionSummary {
  comparison: MarketComparison;
  levelReferences: Record<string, number | null>;
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
  };
}

function buildSummaryFromMetrics(params: {
  metrics: SessionMetrics;
  source: 'stream' | 'bootstrap';
  assetContext: MarketAssetContext | null;
  freshness: MarketFreshness;
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

  return { price, size, timestamp, side };
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

function computeComparison(
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
  const currentRange =
    liveSession.range.high !== null && liveSession.range.low !== null
      ? liveSession.range.high - liveSession.range.low
      : null;
  const rangeVsRecentAverage =
    currentRange !== null && recentAverageRange && recentAverageRange > 0
      ? currentRange / recentAverageRange
      : null;
  const sessionVwapDistance =
    liveSession.range.last !== null && liveSession.sessionVwap !== null
      ? liveSession.range.last - liveSession.sessionVwap
      : null;

  return {
    currentRange,
    recentAverageRange,
    rangeVsRecentAverage,
    sessionVwapDistance,
  };
}

function getLevelReferences(
  liveSession: PersistedSessionSummary,
  recentSessions: PersistedSessionSummary[],
): Record<string, number | null> {
  const previousSession = recentSessions[recentSessions.length - 1] ?? null;
  return {
    session_open: liveSession.range.open,
    session_high: liveSession.range.high,
    session_low: liveSession.range.low,
    session_vwap: liveSession.sessionVwap,
    prior_session_high: previousSession?.range.high ?? null,
    prior_session_low: previousSession?.range.low ?? null,
    prior_session_vwap: previousSession?.sessionVwap ?? null,
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
  private currentAssetContext: MarketAssetContext | null = null;
  private lastTradeAt: number | null = null;
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
    return {
      ...liveSession,
      comparison: computeComparison(liveSession, recentSessions),
      levelReferences: getLevelReferences(liveSession, recentSessions),
      connection: {
        wsConnected: this.wsConnected,
        bootstrapOnly: this.liveTrades.length === 0,
      },
    };
  }

  async getRecentSessions(limit = 7): Promise<{
    sessions: PersistedSessionSummary[];
    comparison: MarketComparison;
    liveSession: PersistedSessionSummary;
  }> {
    await this.ensureStarted();
    const liveSession = await this.buildLiveSessionSnapshot();
    const sessions = this.store.loadCompletedSessions().slice(-limit);
    return {
      sessions,
      comparison: computeComparison(liveSession, sessions),
      liveSession,
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
    const references = getLevelReferences(liveSession, recentSessions);
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

    const trades = [...this.bootstrapTrades, ...this.liveTrades];
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

    this.bootstrapTrades = await this.fetchCurrentSessionBootstrapTrades(sessionStart).catch(() => []);
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
      for (const item of parsed.data) {
        const trade = normalizeTrade(item as HyperliquidTradeMessage);
        if (!trade) {
          continue;
        }
        this.rollSessionIfNeeded(trade.timestamp);
        this.liveTrades.push(trade);
        this.lastTradeAt = trade.timestamp;
      }
      await this.persistLiveSnapshot();
      return;
    }

    if (channel === 'activeAssetCtx') {
      const normalized = normalizeAssetContext(parsed.data);
      if (normalized) {
        this.currentAssetContext = normalized;
        this.lastAssetContextAt = Date.now();
        await this.persistLiveSnapshot();
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
      const metrics = computeSessionMetrics({
        trades: combinedTrades,
        now: timestamp - 1,
        sessionStart: currentSessionStart,
      });
      const summary = buildSummaryFromMetrics({
        metrics,
        source: this.liveTrades.length > 0 ? 'stream' : 'bootstrap',
        assetContext: this.currentAssetContext,
        freshness: this.getFreshness(),
      });
      this.store.saveCompletedSession(summary);
    }

    this.bootstrapTrades = [];
    this.liveTrades = [];
    void this.refreshSessionBootstrap(nextSessionStart);
  }

  private async refreshSessionBootstrap(sessionStart: number): Promise<void> {
    this.bootstrapTrades = await this.fetchCurrentSessionBootstrapTrades(sessionStart).catch(() => []);
    await this.persistLiveSnapshot();
  }

  private getFreshness(): MarketFreshness {
    return {
      lastTradeAt: this.lastTradeAt,
      lastAssetContextAt: this.lastAssetContextAt,
      updatedAt: Date.now(),
    };
  }

  private async buildLiveSessionSnapshot(): Promise<PersistedSessionSummary> {
    const sessionStart = getUtcSessionStart(Date.now());
    const trades = [...this.bootstrapTrades, ...this.liveTrades];

    if (trades.length === 0) {
      const stored = this.store.loadLiveSession();
      if (stored && stored.sessionDate === formatSessionDate(sessionStart)) {
        return stored;
      }
      return buildEmptySummary(sessionStart, this.currentAssetContext);
    }

    const metrics = computeSessionMetrics({
      trades,
      now: Date.now(),
      sessionStart,
    });
    return buildSummaryFromMetrics({
      metrics,
      source: this.liveTrades.length > 0 ? 'stream' : 'bootstrap',
      assetContext: this.currentAssetContext,
      freshness: this.getFreshness(),
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

    return candles.slice(-7).map((candle) => {
      const candleStart = candle.t;
      const candleEnd = candle.T;
      const syntheticTrades = buildSyntheticTradesFromCandles([candle]);
      const metrics = computeSessionMetrics({
        trades: syntheticTrades,
        now: candleEnd,
        sessionStart: candleStart,
      });
      return buildSummaryFromMetrics({
        metrics,
        source: 'bootstrap',
        assetContext: null,
        freshness: {
          lastTradeAt: candleEnd,
          lastAssetContextAt: null,
          updatedAt: Date.now(),
        },
      });
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
}
