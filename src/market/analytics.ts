export interface MarketTrade {
  timestamp: number;
  price: number;
  size: number;
  side: 'B' | 'A';
}

export interface AggressionMetrics {
  buyVolume: number;
  sellVolume: number;
  buyPct: number;
  sellPct: number;
  netDelta: number;
}

export interface SessionRange {
  open: number | null;
  high: number | null;
  low: number | null;
  last: number | null;
}

export interface SessionMetrics {
  sessionStart: number;
  now: number;
  sessionVwap: number | null;
  rolling30mVwap: number | null;
  cumulativeDelta: number;
  sessionAggression: AggressionMetrics;
  trailing5mAggression: AggressionMetrics;
  range: SessionRange;
  tradeCount: number;
  totalVolume: number;
  lastTradeTimestamp: number | null;
}

export type AuctionBehavior = 'initiative' | 'responsive' | 'balanced';

export interface InterpretiveRead {
  label:
    | 'initiative_continuation'
    | 'responsive_defense'
    | 'failed_auction'
    | 'balance_to_imbalance_shift';
  phrase: string;
  evidence: string[];
}

export interface LevelResponse {
  status: 'accepted' | 'rejected' | 'untested' | 'indeterminate';
  direction: 'up' | 'down' | null;
  crossedAt: number | null;
  netDeltaAfterCross: number;
  dwellRatio: number;
}

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function getUtcSessionStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function sortTrades(trades: MarketTrade[]): MarketTrade[] {
  return [...trades].sort((a, b) => a.timestamp - b.timestamp);
}

function computeVwap(trades: MarketTrade[]): number | null {
  const notional = trades.reduce((sum, trade) => sum + trade.price * trade.size, 0);
  const volume = trades.reduce((sum, trade) => sum + trade.size, 0);
  return volume > 0 ? notional / volume : null;
}

function computeAggressionMetrics(trades: MarketTrade[]): AggressionMetrics {
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
  const buyPct = total > 0 ? (buyVolume / total) * 100 : 0;
  const sellPct = total > 0 ? (sellVolume / total) * 100 : 0;

  return {
    buyVolume,
    sellVolume,
    buyPct,
    sellPct,
    netDelta: buyVolume - sellVolume,
  };
}

function computeRange(trades: MarketTrade[]): SessionRange {
  if (trades.length === 0) {
    return { open: null, high: null, low: null, last: null };
  }

  const prices = trades.map((trade) => trade.price);
  return {
    open: trades[0]?.price ?? null,
    high: Math.max(...prices),
    low: Math.min(...prices),
    last: trades[trades.length - 1]?.price ?? null,
  };
}

export function computeSessionMetrics(params: {
  trades: MarketTrade[];
  now: number;
  sessionStart: number;
}): SessionMetrics {
  const sessionTrades = sortTrades(
    params.trades.filter((trade) => trade.timestamp >= params.sessionStart && trade.timestamp <= params.now),
  );
  const recentTrades = sessionTrades.filter((trade) => trade.timestamp >= params.now - THIRTY_MINUTES_MS);
  const trailing5mTrades = sessionTrades.filter((trade) => trade.timestamp >= params.now - FIVE_MINUTES_MS);

  return {
    sessionStart: params.sessionStart,
    now: params.now,
    sessionVwap: computeVwap(sessionTrades),
    rolling30mVwap: computeVwap(recentTrades),
    cumulativeDelta: computeAggressionMetrics(sessionTrades).netDelta,
    sessionAggression: computeAggressionMetrics(sessionTrades),
    trailing5mAggression: computeAggressionMetrics(trailing5mTrades),
    range: computeRange(sessionTrades),
    tradeCount: sessionTrades.length,
    totalVolume: sessionTrades.reduce((sum, trade) => sum + trade.size, 0),
    lastTradeTimestamp: sessionTrades[sessionTrades.length - 1]?.timestamp ?? null,
  };
}

function getRangePosition(range: SessionRange): number | null {
  if (
    range.high === null ||
    range.low === null ||
    range.last === null ||
    range.high === range.low
  ) {
    return null;
  }

  return (range.last - range.low) / (range.high - range.low);
}

export function classifyAuctionBehavior(metrics: SessionMetrics): AuctionBehavior {
  const rangePosition = getRangePosition(metrics.range);
  if (rangePosition === null) {
    return 'balanced';
  }

  if (rangePosition >= 0.75 && metrics.cumulativeDelta > 0 && metrics.trailing5mAggression.buyPct >= 55) {
    return 'initiative';
  }

  if (rangePosition <= 0.25 && metrics.cumulativeDelta < 0 && metrics.trailing5mAggression.sellPct >= 55) {
    return 'initiative';
  }

  if (
    (rangePosition <= 0.25 || rangePosition >= 0.75) &&
    Math.abs(metrics.cumulativeDelta) <= Math.max(1, metrics.totalVolume * 0.1)
  ) {
    return 'responsive';
  }

  if (rangePosition > 0.25 && rangePosition < 0.75) {
    return 'responsive';
  }

  return 'balanced';
}

export function analyzeLevelResponse(params: {
  level: number;
  trades: MarketTrade[];
  now: number;
}): LevelResponse {
  const trades = sortTrades(params.trades.filter((trade) => trade.timestamp <= params.now));
  if (trades.length < 2) {
    return {
      status: 'untested',
      direction: null,
      crossedAt: null,
      netDeltaAfterCross: 0,
      dwellRatio: 0,
    };
  }

  let crossIndex = -1;
  let direction: 'up' | 'down' | null = null;

  for (let index = 1; index < trades.length; index++) {
    const previous = trades[index - 1];
    const current = trades[index];
    if (previous && current && previous.price < params.level && current.price >= params.level) {
      crossIndex = index;
      direction = 'up';
      break;
    }
    if (previous && current && previous.price > params.level && current.price <= params.level) {
      crossIndex = index;
      direction = 'down';
      break;
    }
  }

  if (crossIndex === -1 || direction === null) {
    return {
      status: 'untested',
      direction: null,
      crossedAt: null,
      netDeltaAfterCross: 0,
      dwellRatio: 0,
    };
  }

  const postCrossTrades = trades.slice(crossIndex);
  const netDeltaAfterCross = computeAggressionMetrics(postCrossTrades).netDelta;
  const tradesHoldingLevel = postCrossTrades.filter((trade) =>
    direction === 'up' ? trade.price >= params.level : trade.price <= params.level,
  );
  const dwellRatio = postCrossTrades.length > 0 ? tradesHoldingLevel.length / postCrossTrades.length : 0;
  const lastPrice = postCrossTrades[postCrossTrades.length - 1]?.price ?? null;

  if (direction === 'up') {
    if (lastPrice !== null && lastPrice < params.level) {
      return {
        status: 'rejected',
        direction,
        crossedAt: postCrossTrades[0]?.timestamp ?? null,
        netDeltaAfterCross,
        dwellRatio,
      };
    }
    if (lastPrice !== null && lastPrice >= params.level && dwellRatio >= 0.5 && netDeltaAfterCross > 0) {
      return {
        status: 'accepted',
        direction,
        crossedAt: postCrossTrades[0]?.timestamp ?? null,
        netDeltaAfterCross,
        dwellRatio,
      };
    }
  }

  if (direction === 'down') {
    if (lastPrice !== null && lastPrice > params.level) {
      return {
        status: 'rejected',
        direction,
        crossedAt: postCrossTrades[0]?.timestamp ?? null,
        netDeltaAfterCross,
        dwellRatio,
      };
    }
    if (lastPrice !== null && lastPrice <= params.level && dwellRatio >= 0.5 && netDeltaAfterCross < 0) {
      return {
        status: 'accepted',
        direction,
        crossedAt: postCrossTrades[0]?.timestamp ?? null,
        netDeltaAfterCross,
        dwellRatio,
      };
    }
  }

  return {
    status: 'indeterminate',
    direction,
    crossedAt: postCrossTrades[0]?.timestamp ?? null,
    netDeltaAfterCross,
    dwellRatio,
  };
}

export function deriveInterpretiveRead(metrics: SessionMetrics): InterpretiveRead {
  const behavior = classifyAuctionBehavior(metrics);
  const evidence = [
    `session delta ${metrics.cumulativeDelta.toFixed(2)}`,
    `session VWAP ${metrics.sessionVwap?.toFixed(2) ?? 'n/a'}`,
    `5m buy aggression ${metrics.trailing5mAggression.buyPct.toFixed(1)}%`,
  ];

  if (behavior === 'initiative' && metrics.cumulativeDelta > 0) {
    return {
      label: 'initiative_continuation',
      phrase: 'This reads as initiative continuation so far.',
      evidence,
    };
  }

  if (behavior === 'responsive') {
    return {
      label: 'responsive_defense',
      phrase: 'This looks more responsive than initiative right now.',
      evidence,
    };
  }

  if (metrics.range.high !== null && metrics.range.low !== null && metrics.range.last !== null) {
    const rangePosition = getRangePosition(metrics.range) ?? 0.5;
    if (rangePosition > 0.8 || rangePosition < 0.2) {
      return {
        label: 'balance_to_imbalance_shift',
        phrase: 'This reads as a balance-to-imbalance shift, but it still needs follow-through.',
        evidence,
      };
    }
  }

  return {
    label: 'failed_auction',
    phrase: 'Not enough evidence for continuation; this reads more like a failed auction attempt.',
    evidence,
  };
}
