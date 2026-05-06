import { analyzeLevelResponse, type LevelResponse, type MarketTrade, type SessionMetrics } from './analytics.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THREE_MINUTES_MS = 3 * 60 * 1000;
const TWENTY_MINUTES_MS = 20 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface OrderBookLevel {
  price: number;
  size: number;
  count: number | null;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface DepthBandSummary {
  bps: number;
  bidSize: number;
  askSize: number;
  imbalance: number;
}

export interface LiquidityWall {
  side: 'bid' | 'ask';
  price: number;
  size: number;
  count: number | null;
  distanceBps: number;
}

export interface SweepEstimate {
  bps: number;
  buySizeToLift: number;
  sellSizeToHit: number;
}

export interface OrderBookDynamics {
  bidDepthChangePct: number | null;
  askDepthChangePct: number | null;
  dominantChange: 'stacking_bids' | 'stacking_asks' | 'pulling_bids' | 'pulling_asks' | 'stable';
}

export interface OrderBookState {
  timestamp: number;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadBps: number | null;
  topOfBookImbalance: number;
  depthBands: DepthBandSummary[];
  pressure: 'bid_support' | 'ask_pressure' | 'balanced';
  bidWall: LiquidityWall | null;
  askWall: LiquidityWall | null;
  sweepEstimates: SweepEstimate[];
  dynamics: OrderBookDynamics;
}

export interface IntradayLevelReferences {
  opening_range_high: number | null;
  opening_range_low: number | null;
  initial_balance_high: number | null;
  initial_balance_low: number | null;
}

export interface RankedReference {
  name: string;
  label: string;
  kind: 'session' | 'prior_session' | 'opening' | 'initial_balance';
  price: number;
  distance: number | null;
  distanceBps: number | null;
  location: 'above' | 'below' | 'at';
  response: LevelResponse['status'];
  responseDirection: LevelResponse['direction'];
  lastTouchAt: number | null;
  score: number;
  reasons: string[];
}

export interface FlowEvent {
  type:
    | 'buy_sweep'
    | 'sell_sweep'
    | 'failed_breakout'
    | 'failed_breakdown'
    | 'absorption_high'
    | 'absorption_low'
    | 'vwap_reclaim'
    | 'vwap_loss';
  label: string;
  direction: 'up' | 'down' | 'two_way';
  confidence: 'low' | 'medium' | 'high';
  timestamp: number | null;
  price: number | null;
  reference: string | null;
  evidence: string[];
}

function sortTrades(trades: MarketTrade[]): MarketTrade[] {
  return [...trades].sort((left, right) => left.timestamp - right.timestamp);
}

function getWindowTrades(trades: MarketTrade[], startTime: number, endTime: number): MarketTrade[] {
  return sortTrades(trades.filter((trade) => trade.timestamp >= startTime && trade.timestamp <= endTime));
}

function getTradeRange(trades: MarketTrade[]): { high: number | null; low: number | null; first: number | null; last: number | null } {
  if (trades.length === 0) {
    return { high: null, low: null, first: null, last: null };
  }

  const prices = trades.map((trade) => trade.price);
  return {
    high: Math.max(...prices),
    low: Math.min(...prices),
    first: trades[0]?.price ?? null,
    last: trades[trades.length - 1]?.price ?? null,
  };
}

function computeAggression(trades: MarketTrade[]): {
  buyVolume: number;
  sellVolume: number;
  buyPct: number;
  sellPct: number;
  netDelta: number;
} {
  let buyVolume = 0;
  let sellVolume = 0;

  for (const trade of trades) {
    if (trade.side === 'B') {
      buyVolume += trade.size;
    } else {
      sellVolume += trade.size;
    }
  }

  const total = buyVolume + sellVolume;

  return {
    buyVolume,
    sellVolume,
    buyPct: total > 0 ? (buyVolume / total) * 100 : 0,
    sellPct: total > 0 ? (sellVolume / total) * 100 : 0,
    netDelta: buyVolume - sellVolume,
  };
}

function toBps(distance: number, referencePrice: number | null): number | null {
  if (referencePrice === null || referencePrice <= 0) {
    return null;
  }

  return (distance / referencePrice) * 10_000;
}

function getLevelTolerance(price: number): number {
  return Math.max(price * 0.00025, 10);
}

function labelReference(name: string): string {
  return name.replaceAll('_', ' ');
}

function classifyReferenceKind(name: string): RankedReference['kind'] {
  if (name.startsWith('prior_')) {
    return 'prior_session';
  }

  if (name.startsWith('opening_')) {
    return 'opening';
  }

  if (name.startsWith('initial_balance_')) {
    return 'initial_balance';
  }

  return 'session';
}

function getReferenceWeight(name: string): number {
  if (name === 'session_high' || name === 'session_low') {
    return 34;
  }

  if (name === 'prior_session_high' || name === 'prior_session_low') {
    return 30;
  }

  if (name === 'session_open' || name === 'session_vwap' || name === 'prior_session_vwap') {
    return 24;
  }

  if (name.startsWith('initial_balance_')) {
    return 20;
  }

  return 16;
}

function findLastTouchAt(trades: MarketTrade[], level: number): number | null {
  const tolerance = getLevelTolerance(level);

  for (let index = trades.length - 1; index >= 0; index--) {
    const trade = trades[index];
    if (trade && Math.abs(trade.price - level) <= tolerance) {
      return trade.timestamp;
    }
  }

  return null;
}

function sortBookLevels(levels: OrderBookLevel[], side: 'bid' | 'ask'): OrderBookLevel[] {
  return [...levels]
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.size >= 0)
    .sort((left, right) => side === 'bid' ? right.price - left.price : left.price - right.price);
}

function computeBookDepth(levels: OrderBookLevel[], side: 'bid' | 'ask', midPrice: number, bps: number): number {
  const boundary =
    side === 'bid'
      ? midPrice * (1 - bps / 10_000)
      : midPrice * (1 + bps / 10_000);

  return levels
    .filter((level) => side === 'bid' ? level.price >= boundary : level.price <= boundary)
    .reduce((sum, level) => sum + level.size, 0);
}

function findLiquidityWall(levels: OrderBookLevel[], side: 'bid' | 'ask', midPrice: number): LiquidityWall | null {
  let winner: LiquidityWall | null = null;
  let bestScore = -Infinity;

  for (const level of levels) {
    const distance = Math.abs(level.price - midPrice);
    const distanceBps = toBps(distance, midPrice);
    if (distanceBps === null || distanceBps > 30) {
      continue;
    }

    const score = level.size / (1 + distanceBps / 5);
    if (score > bestScore) {
      bestScore = score;
      winner = {
        side,
        price: level.price,
        size: level.size,
        count: level.count,
        distanceBps,
      };
    }
  }

  return winner;
}

function computeSweepSize(levels: OrderBookLevel[], side: 'bid' | 'ask', midPrice: number, bps: number): number {
  const target =
    side === 'ask'
      ? midPrice * (1 + bps / 10_000)
      : midPrice * (1 - bps / 10_000);

  return levels
    .filter((level) => side === 'ask' ? level.price <= target : level.price >= target)
    .reduce((sum, level) => sum + level.size, 0);
}

function classifyBookPressure(topImbalance: number, nearImbalance: number): OrderBookState['pressure'] {
  if (topImbalance >= 0.12 || nearImbalance >= 0.12) {
    return 'bid_support';
  }

  if (topImbalance <= -0.12 || nearImbalance <= -0.12) {
    return 'ask_pressure';
  }

  return 'balanced';
}

function computeDynamics(current: OrderBookSnapshot, previous?: OrderBookSnapshot | null): OrderBookDynamics {
  if (!previous) {
    return {
      bidDepthChangePct: null,
      askDepthChangePct: null,
      dominantChange: 'stable',
    };
  }

  const currentMid = getMidPrice(current);
  const previousMid = getMidPrice(previous);

  if (currentMid === null || previousMid === null) {
    return {
      bidDepthChangePct: null,
      askDepthChangePct: null,
      dominantChange: 'stable',
    };
  }

  const currentBidDepth = computeBookDepth(current.bids, 'bid', currentMid, 10);
  const previousBidDepth = computeBookDepth(previous.bids, 'bid', previousMid, 10);
  const currentAskDepth = computeBookDepth(current.asks, 'ask', currentMid, 10);
  const previousAskDepth = computeBookDepth(previous.asks, 'ask', previousMid, 10);

  const bidDepthChangePct =
    previousBidDepth > 0 ? ((currentBidDepth - previousBidDepth) / previousBidDepth) * 100 : null;
  const askDepthChangePct =
    previousAskDepth > 0 ? ((currentAskDepth - previousAskDepth) / previousAskDepth) * 100 : null;

  let dominantChange: OrderBookDynamics['dominantChange'] = 'stable';

  if ((bidDepthChangePct ?? 0) >= 12 && (askDepthChangePct ?? 0) <= 5) {
    dominantChange = 'stacking_bids';
  } else if ((askDepthChangePct ?? 0) >= 12 && (bidDepthChangePct ?? 0) <= 5) {
    dominantChange = 'stacking_asks';
  } else if ((bidDepthChangePct ?? 0) <= -12) {
    dominantChange = 'pulling_bids';
  } else if ((askDepthChangePct ?? 0) <= -12) {
    dominantChange = 'pulling_asks';
  }

  return {
    bidDepthChangePct,
    askDepthChangePct,
    dominantChange,
  };
}

function getMidPrice(book: OrderBookSnapshot): number | null {
  const bestBid = book.bids[0]?.price ?? null;
  const bestAsk = book.asks[0]?.price ?? null;

  if (bestBid === null || bestAsk === null) {
    return null;
  }

  return (bestBid + bestAsk) / 2;
}

export function deriveOrderBookState(params: {
  book: OrderBookSnapshot;
  previousBook?: OrderBookSnapshot | null;
}): OrderBookState | null {
  const bids = sortBookLevels(params.book.bids, 'bid');
  const asks = sortBookLevels(params.book.asks, 'ask');
  const book: OrderBookSnapshot = {
    bids,
    asks,
    timestamp: params.book.timestamp,
  };
  const midPrice = getMidPrice(book);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;

  if (midPrice === null || bestBid === null || bestAsk === null) {
    return null;
  }

  const spread = bestAsk - bestBid;
  const spreadBps = toBps(spread, midPrice);
  const topBidSize = bids[0]?.size ?? 0;
  const topAskSize = asks[0]?.size ?? 0;
  const topOfBookImbalance =
    topBidSize + topAskSize > 0 ? (topBidSize - topAskSize) / (topBidSize + topAskSize) : 0;
  const depthBands = [5, 10, 25].map((bps) => {
    const bidSize = computeBookDepth(bids, 'bid', midPrice, bps);
    const askSize = computeBookDepth(asks, 'ask', midPrice, bps);
    const imbalance = bidSize + askSize > 0 ? (bidSize - askSize) / (bidSize + askSize) : 0;

    return {
      bps,
      bidSize,
      askSize,
      imbalance,
    };
  });
  const nearImbalance = depthBands.find((band) => band.bps === 10)?.imbalance ?? 0;

  return {
    timestamp: book.timestamp,
    bestBid,
    bestAsk,
    midPrice,
    spread,
    spreadBps,
    topOfBookImbalance,
    depthBands,
    pressure: classifyBookPressure(topOfBookImbalance, nearImbalance),
    bidWall: findLiquidityWall(bids, 'bid', midPrice),
    askWall: findLiquidityWall(asks, 'ask', midPrice),
    sweepEstimates: [5, 10, 25].map((bps) => ({
      bps,
      buySizeToLift: computeSweepSize(asks, 'ask', midPrice, bps),
      sellSizeToHit: computeSweepSize(bids, 'bid', midPrice, bps),
    })),
    dynamics: computeDynamics(book, params.previousBook),
  };
}

export function deriveIntradayReferences(params: {
  trades: MarketTrade[];
  sessionStart: number;
  now: number;
}): IntradayLevelReferences {
  const openingTrades = getWindowTrades(
    params.trades,
    params.sessionStart,
    Math.min(params.now, params.sessionStart + FIVE_MINUTES_MS),
  );
  const initialBalanceTrades = getWindowTrades(
    params.trades,
    params.sessionStart,
    Math.min(params.now, params.sessionStart + HOUR_MS),
  );
  const openingRange = getTradeRange(openingTrades);
  const initialBalanceRange = getTradeRange(initialBalanceTrades);

  return {
    opening_range_high: openingRange.high,
    opening_range_low: openingRange.low,
    initial_balance_high: initialBalanceRange.high,
    initial_balance_low: initialBalanceRange.low,
  };
}

export function buildReferenceMap(params: {
  trades: MarketTrade[];
  now: number;
  currentPrice: number | null;
  references: Record<string, number | null>;
  limit?: number;
}): RankedReference[] {
  const sortedTrades = sortTrades(params.trades);

  return Object.entries(params.references)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .map(([name, price]) => {
      const distance = params.currentPrice !== null ? Math.abs(price - params.currentPrice) : null;
      const distanceBps = distance !== null ? toBps(distance, params.currentPrice) : null;
      const response = analyzeLevelResponse({
        level: price,
        trades: sortedTrades,
        now: params.now,
      });
      const lastTouchAt = findLastTouchAt(sortedTrades, price);
      const kind = classifyReferenceKind(name);
      const proximityScore =
        distanceBps !== null ? Math.max(0, 48 - Math.min(distanceBps, 48)) : 0;
      const recencyScore =
        lastTouchAt === null
          ? 0
          : params.now - lastTouchAt <= 15 * 60 * 1000
            ? 18
            : params.now - lastTouchAt <= 60 * 60 * 1000
              ? 8
              : 0;
      const responseScore =
        response.status === 'accepted' || response.status === 'rejected'
          ? 12
          : response.status === 'indeterminate'
            ? 4
            : 0;
      const score = Number((getReferenceWeight(name) + proximityScore + recencyScore + responseScore).toFixed(2));
      const location =
        distanceBps !== null && distanceBps <= 4
          ? 'at'
          : params.currentPrice !== null && price > params.currentPrice
            ? 'above'
            : 'below';
      const reasons = [
        `${labelReference(name)} carries ${kind.replace('_', ' ')} context`,
      ];

      if (distanceBps !== null) {
        reasons.push(`${distanceBps.toFixed(1)} bps from current price`);
      }

      if (lastTouchAt !== null) {
        reasons.push('recently traded');
      }

      if (response.status === 'accepted' || response.status === 'rejected') {
        reasons.push(`last response was ${response.status}`);
      }

      return {
        name,
        label: labelReference(name),
        kind,
        price,
        distance,
        distanceBps,
        location,
        response: response.status,
        responseDirection: response.direction,
        lastTouchAt,
        score,
        reasons: reasons.slice(0, 3),
      } satisfies RankedReference;
    })
    .sort((left, right) => right.score - left.score || (left.distanceBps ?? Infinity) - (right.distanceBps ?? Infinity))
    .slice(0, params.limit ?? 8);
}

function confidenceRank(confidence: FlowEvent['confidence']): number {
  if (confidence === 'high') {
    return 3;
  }

  if (confidence === 'medium') {
    return 2;
  }

  return 1;
}

function buildSweepEvent(params: {
  trades: MarketTrade[];
  direction: 'up' | 'down';
  orderBookState: OrderBookState | null;
}): FlowEvent | null {
  const recentTrades = sortTrades(params.trades);
  if (recentTrades.length < 4) {
    return null;
  }

  const range = getTradeRange(recentTrades);
  const aggression = computeAggression(recentTrades);
  const firstPrice = range.first;
  const lastPrice = range.last;

  if (firstPrice === null || lastPrice === null) {
    return null;
  }

  const moveBps = toBps(Math.abs(lastPrice - firstPrice), firstPrice) ?? 0;

  if (
    params.direction === 'up' &&
    !(lastPrice > firstPrice && moveBps >= 8 && aggression.buyPct >= 68 && aggression.netDelta > 0)
  ) {
    return null;
  }

  if (
    params.direction === 'down' &&
    !(lastPrice < firstPrice && moveBps >= 8 && aggression.sellPct >= 68 && aggression.netDelta < 0)
  ) {
    return null;
  }

  const bookAligned =
    params.orderBookState === null ||
    (params.direction === 'up'
      ? params.orderBookState.pressure !== 'ask_pressure'
      : params.orderBookState.pressure !== 'bid_support');
  const confidence: FlowEvent['confidence'] =
    moveBps >= 14 && bookAligned ? 'high' : 'medium';

  return {
    type: params.direction === 'up' ? 'buy_sweep' : 'sell_sweep',
    label: params.direction === 'up' ? 'buy sweep is pressing higher' : 'sell sweep is pressing lower',
    direction: params.direction,
    confidence,
    timestamp: recentTrades[recentTrades.length - 1]?.timestamp ?? null,
    price: lastPrice,
    reference: null,
    evidence: [
      `${moveBps.toFixed(1)} bps move over the last 3m`,
      params.direction === 'up'
        ? `${aggression.buyPct.toFixed(1)}% buy aggression`
        : `${aggression.sellPct.toFixed(1)}% sell aggression`,
      params.orderBookState ? `book pressure is ${params.orderBookState.pressure.replace('_', ' ')}` : 'book context unavailable',
    ],
  };
}

function buildRecentResponseEvent(params: {
  type: 'failed_breakout' | 'failed_breakdown' | 'vwap_reclaim' | 'vwap_loss';
  referenceName: string;
  response: LevelResponse;
  level: number;
  now: number;
  orderBookState: OrderBookState | null;
}): FlowEvent | null {
  if (params.response.crossedAt === null || params.now - params.response.crossedAt > TWENTY_MINUTES_MS) {
    return null;
  }

  if (params.type === 'failed_breakout' && !(params.response.status === 'rejected' && params.response.direction === 'up')) {
    return null;
  }

  if (params.type === 'failed_breakdown' && !(params.response.status === 'rejected' && params.response.direction === 'down')) {
    return null;
  }

  if (params.type === 'vwap_reclaim' && !(params.response.status === 'accepted' && params.response.direction === 'up')) {
    return null;
  }

  if (params.type === 'vwap_loss' && !(params.response.status === 'accepted' && params.response.direction === 'down')) {
    return null;
  }

  const confidence: FlowEvent['confidence'] =
    params.response.dwellRatio >= 0.65 || Math.abs(params.response.netDeltaAfterCross) > 3 ? 'high' : 'medium';

  return {
    type: params.type,
    label:
      params.type === 'failed_breakout'
        ? `${labelReference(params.referenceName)} failed on the upside`
        : params.type === 'failed_breakdown'
          ? `${labelReference(params.referenceName)} failed on the downside`
          : params.type === 'vwap_reclaim'
            ? 'price reclaimed session vwap'
            : 'price lost session vwap',
    direction:
      params.type === 'failed_breakout' || params.type === 'vwap_loss'
        ? 'down'
        : 'up',
    confidence,
    timestamp: params.response.crossedAt,
    price: params.level,
    reference: params.referenceName,
    evidence: [
      `dwell ratio ${params.response.dwellRatio.toFixed(2)}`,
      `post-cross delta ${params.response.netDeltaAfterCross.toFixed(2)}`,
      params.orderBookState ? `book pressure is ${params.orderBookState.pressure.replace('_', ' ')}` : 'book context unavailable',
    ],
  };
}

function buildAbsorptionEvent(params: {
  trades: MarketTrade[];
  referenceName: string;
  referencePrice: number;
  side: 'high' | 'low';
  orderBookState: OrderBookState | null;
}): FlowEvent | null {
  const recentTrades = sortTrades(params.trades);
  if (recentTrades.length < 4) {
    return null;
  }

  const aggression = computeAggression(recentTrades);
  const range = getTradeRange(recentTrades);
  const lastPrice = range.last;

  if (lastPrice === null || range.high === null || range.low === null) {
    return null;
  }

  const tolerance = getLevelTolerance(params.referencePrice);

  if (params.side === 'high') {
    const retreated = range.high - lastPrice;
    if (
      !(range.high >= params.referencePrice - tolerance &&
      retreated >= tolerance * 0.35 &&
      aggression.buyPct >= 60 &&
      params.orderBookState?.pressure === 'ask_pressure')
    ) {
      return null;
    }

    return {
      type: 'absorption_high',
      label: `${labelReference(params.referenceName)} is absorbing buyers`,
      direction: 'down',
      confidence: retreated >= tolerance ? 'high' : 'medium',
      timestamp: recentTrades[recentTrades.length - 1]?.timestamp ?? null,
      price: params.referencePrice,
      reference: params.referenceName,
      evidence: [
        `${aggression.buyPct.toFixed(1)}% buy aggression into the level`,
        `${retreated.toFixed(2)} points off the local high`,
        'book pressure stayed on the ask side',
      ],
    };
  }

  const bounced = lastPrice - range.low;
  if (
    !(range.low <= params.referencePrice + tolerance &&
    bounced >= tolerance * 0.35 &&
    aggression.sellPct >= 60 &&
    params.orderBookState?.pressure === 'bid_support')
  ) {
    return null;
  }

  return {
    type: 'absorption_low',
    label: `${labelReference(params.referenceName)} is absorbing sellers`,
    direction: 'up',
    confidence: bounced >= tolerance ? 'high' : 'medium',
    timestamp: recentTrades[recentTrades.length - 1]?.timestamp ?? null,
    price: params.referencePrice,
    reference: params.referenceName,
    evidence: [
      `${aggression.sellPct.toFixed(1)}% sell aggression into the level`,
      `${bounced.toFixed(2)} points off the local low`,
      'book pressure stayed on the bid side',
    ],
  };
}

export function detectFlowEvents(params: {
  trades: MarketTrade[];
  now: number;
  metrics: SessionMetrics;
  orderBookState: OrderBookState | null;
  levelReferences: Record<string, number | null>;
}): FlowEvent[] {
  const sortedTrades = sortTrades(params.trades);
  const recent3m = getWindowTrades(sortedTrades, params.now - THREE_MINUTES_MS, params.now);
  const recent5m = getWindowTrades(sortedTrades, params.now - FIVE_MINUTES_MS, params.now);
  const recent20m = getWindowTrades(sortedTrades, params.now - TWENTY_MINUTES_MS, params.now);
  const events: FlowEvent[] = [];

  const buySweep = buildSweepEvent({
    trades: recent3m,
    direction: 'up',
    orderBookState: params.orderBookState,
  });
  if (buySweep) {
    events.push(buySweep);
  }

  const sellSweep = buildSweepEvent({
    trades: recent3m,
    direction: 'down',
    orderBookState: params.orderBookState,
  });
  if (sellSweep) {
    events.push(sellSweep);
  }

  for (const referenceName of ['session_high', 'prior_session_high', 'opening_range_high', 'initial_balance_high']) {
    const level = params.levelReferences[referenceName];
    if (typeof level !== 'number') {
      continue;
    }

    const response = analyzeLevelResponse({
      level,
      trades: recent20m,
      now: params.now,
    });
    const event = buildRecentResponseEvent({
      type: 'failed_breakout',
      referenceName,
      response,
      level,
      now: params.now,
      orderBookState: params.orderBookState,
    });

    if (event) {
      events.push(event);
      break;
    }
  }

  for (const referenceName of ['session_low', 'prior_session_low', 'opening_range_low', 'initial_balance_low']) {
    const level = params.levelReferences[referenceName];
    if (typeof level !== 'number') {
      continue;
    }

    const response = analyzeLevelResponse({
      level,
      trades: recent20m,
      now: params.now,
    });
    const event = buildRecentResponseEvent({
      type: 'failed_breakdown',
      referenceName,
      response,
      level,
      now: params.now,
      orderBookState: params.orderBookState,
    });

    if (event) {
      events.push(event);
      break;
    }
  }

  const sessionVwap = params.levelReferences.session_vwap;
  if (typeof sessionVwap === 'number') {
    const response = analyzeLevelResponse({
      level: sessionVwap,
      trades: recent20m,
      now: params.now,
    });
    const reclaim = buildRecentResponseEvent({
      type: 'vwap_reclaim',
      referenceName: 'session_vwap',
      response,
      level: sessionVwap,
      now: params.now,
      orderBookState: params.orderBookState,
    });
    const loss = buildRecentResponseEvent({
      type: 'vwap_loss',
      referenceName: 'session_vwap',
      response,
      level: sessionVwap,
      now: params.now,
      orderBookState: params.orderBookState,
    });

    if (reclaim) {
      events.push(reclaim);
    }
    if (loss) {
      events.push(loss);
    }
  }

  for (const referenceName of ['session_high', 'prior_session_high']) {
    const level = params.levelReferences[referenceName];
    if (typeof level !== 'number') {
      continue;
    }

    const absorption = buildAbsorptionEvent({
      trades: recent5m,
      referenceName,
      referencePrice: level,
      side: 'high',
      orderBookState: params.orderBookState,
    });

    if (absorption) {
      events.push(absorption);
      break;
    }
  }

  for (const referenceName of ['session_low', 'prior_session_low']) {
    const level = params.levelReferences[referenceName];
    if (typeof level !== 'number') {
      continue;
    }

    const absorption = buildAbsorptionEvent({
      trades: recent5m,
      referenceName,
      referencePrice: level,
      side: 'low',
      orderBookState: params.orderBookState,
    });

    if (absorption) {
      events.push(absorption);
      break;
    }
  }

  const deduped = new Map<string, FlowEvent>();
  for (const event of events) {
    const key = `${event.type}:${event.reference ?? 'none'}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, event);
      continue;
    }

    if (
      confidenceRank(event.confidence) > confidenceRank(existing.confidence) ||
      (event.timestamp ?? 0) > (existing.timestamp ?? 0)
    ) {
      deduped.set(key, event);
    }
  }

  return [...deduped.values()]
    .sort(
      (left, right) =>
        confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
        (right.timestamp ?? 0) - (left.timestamp ?? 0),
    )
    .slice(0, 6);
}
