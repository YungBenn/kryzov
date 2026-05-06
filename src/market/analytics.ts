export interface MarketTrade {
  timestamp: number;
  price: number;
  size: number;
  side: 'B' | 'A';
  source?: 'real' | 'synthetic';
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

export type SessionBias = 'buy' | 'sell' | 'balanced';
export type SessionState =
  | 'balanced'
  | 'expanding_up'
  | 'expanding_down'
  | 'accepted_up'
  | 'accepted_down'
  | 'failed_up'
  | 'failed_down'
  | 'regained_balance';
export type SessionConfidence = 'low' | 'medium' | 'high';
export type SessionRangeLocation = 'low' | 'middle' | 'high';
export type SessionVwapRelation = 'above' | 'below' | 'near';

export interface SessionTransition {
  from: SessionState;
  to: SessionState;
  reason: string;
}

export interface SessionProfile {
  state: SessionState;
  bias: SessionBias;
  confidence: SessionConfidence;
  rangeLocation: SessionRangeLocation;
  vwapRelation: SessionVwapRelation;
  transition: SessionTransition | null;
  evidence: string[];
  caveat: string | null;
}

interface SessionProfileParams {
  metrics: SessionMetrics;
  trades?: MarketTrade[];
  now: number;
  freshness: {
    lastTradeAt: number | null;
    lastAssetContextAt: number | null;
    updatedAt: number;
  };
  recentSessions?: Array<{
    range: SessionRange;
  }>;
  levelReferences?: Record<string, number | null>;
}

export interface ThirtyMinuteBracket {
  index: number;
  start: number;
  end: number;
  range: SessionRange;
  vwap: number | null;
  aggression: AggressionMetrics;
  tradeCount: number;
  totalVolume: number;
  lastTradeTimestamp: number | null;
}

interface ThirtyMinuteProfileContext {
  currentBracket: ThirtyMinuteBracket;
  priorCompositeRange: SessionRange;
  nonEmptyBracketCount: number;
  currentBias: SessionBias;
  priorBreakoutDirection: 'up' | 'down' | null;
  brokeUp: boolean;
  brokeDown: boolean;
  acceptedUp: boolean;
  acceptedDown: boolean;
  failedUp: boolean;
  failedDown: boolean;
  regainedBalance: boolean;
}

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const STALE_TRADE_WINDOW_MS = 15 * 60 * 1000;

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

function combineRanges(ranges: SessionRange[]): SessionRange {
  const open = ranges.find((range) => range.open !== null)?.open ?? null;
  const last = [...ranges].reverse().find((range) => range.last !== null)?.last ?? null;
  const highs = ranges.map((range) => range.high).filter((value): value is number => value !== null);
  const lows = ranges.map((range) => range.low).filter((value): value is number => value !== null);

  return {
    open,
    high: highs.length > 0 ? Math.max(...highs) : null,
    low: lows.length > 0 ? Math.min(...lows) : null,
    last,
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

export function buildThirtyMinuteBrackets(params: {
  trades: MarketTrade[];
  now: number;
  sessionStart: number;
}): ThirtyMinuteBracket[] {
  const sessionTrades = sortTrades(
    params.trades.filter((trade) => trade.timestamp >= params.sessionStart && trade.timestamp <= params.now),
  );
  const currentBracketIndex = Math.max(0, Math.floor((params.now - params.sessionStart) / THIRTY_MINUTES_MS));

  return Array.from({ length: currentBracketIndex + 1 }, (_, index) => {
    const start = params.sessionStart + index * THIRTY_MINUTES_MS;
    const bracketTrades = sessionTrades.filter(
      (trade) => trade.timestamp >= start && trade.timestamp < start + THIRTY_MINUTES_MS,
    );

    return {
      index,
      start,
      end: Math.min(start + THIRTY_MINUTES_MS - 1, params.now),
      range: computeRange(bracketTrades),
      vwap: computeVwap(bracketTrades),
      aggression: computeAggressionMetrics(bracketTrades),
      tradeCount: bracketTrades.length,
      totalVolume: bracketTrades.reduce((sum, trade) => sum + trade.size, 0),
      lastTradeTimestamp: bracketTrades[bracketTrades.length - 1]?.timestamp ?? null,
    };
  });
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

function getRangeSize(range: SessionRange): number | null {
  if (range.high === null || range.low === null) {
    return null;
  }

  return range.high - range.low;
}

function classifySessionBias(metrics: AggressionMetrics): SessionBias {
  const diff = metrics.buyPct - metrics.sellPct;
  if (Math.abs(diff) < 6) {
    return 'balanced';
  }

  return diff > 0 ? 'buy' : 'sell';
}

function normalizeBiasForState(state: SessionState, fallback: SessionBias): SessionBias {
  if (state === 'accepted_up' || state === 'expanding_up') {
    return 'buy';
  }

  if (state === 'accepted_down' || state === 'expanding_down') {
    return 'sell';
  }

  if (state === 'failed_up') {
    return 'sell';
  }

  if (state === 'failed_down') {
    return 'buy';
  }

  if (state === 'regained_balance') {
    return 'balanced';
  }

  return fallback;
}

function classifyRangeLocation(rangePosition: number | null): SessionRangeLocation {
  if (rangePosition === null) {
    return 'middle';
  }

  if (rangePosition <= 0.33) {
    return 'low';
  }

  if (rangePosition >= 0.67) {
    return 'high';
  }

  return 'middle';
}

function classifyVwapRelation(metrics: SessionMetrics): SessionVwapRelation {
  if (metrics.range.last === null || metrics.sessionVwap === null) {
    return 'near';
  }

  const rangeSize = getRangeSize(metrics.range) ?? 0;
  const diff = metrics.range.last - metrics.sessionVwap;
  const tolerance = Math.max(rangeSize * 0.15, metrics.sessionVwap * 0.0005);

  if (diff > tolerance) {
    return 'above';
  }

  if (diff < -tolerance) {
    return 'below';
  }

  return 'near';
}

function getRecentAverageRange(params: SessionProfileParams): number | null {
  const values = (params.recentSessions ?? [])
    .map((session) => getRangeSize(session.range))
    .filter((value): value is number => value !== null && value > 0);

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildEvidence(params: {
  state: SessionState;
  bias: SessionBias;
  rangeLocation: SessionRangeLocation;
  vwapRelation: SessionVwapRelation;
  recentAverageRange: number | null;
  currentRange: number | null;
  metrics: SessionMetrics;
  periodContext: ThirtyMinuteProfileContext | null;
}): string[] {
  const evidence: string[] = [];
  const currentBracket = params.periodContext?.currentBracket;
  const priorRange = params.periodContext?.priorCompositeRange ?? null;

  if (params.rangeLocation === 'high') {
    evidence.push('price is pressing the upper part of the session range');
  } else if (params.rangeLocation === 'low') {
    evidence.push('price is pressing the lower part of the session range');
  } else {
    evidence.push('price is rotating closer to the middle of the session range');
  }

  if (params.vwapRelation === 'above') {
    evidence.push('price is holding above the session average');
  } else if (params.vwapRelation === 'below') {
    evidence.push('price is holding below the session average');
  } else {
    evidence.push('price is staying close to the session average');
  }

  if (currentBracket && params.bias === 'buy') {
    evidence.push('the latest 30m period still favors buyers');
  } else if (currentBracket && params.bias === 'sell') {
    evidence.push('the latest 30m period still favors sellers');
  } else if (currentBracket) {
    evidence.push('the latest 30m period is fairly balanced');
  } else if (params.bias === 'buy') {
    evidence.push('recent flow still favors buyers');
  } else if (params.bias === 'sell') {
    evidence.push('recent flow still favors sellers');
  } else {
    evidence.push('recent flow is fairly balanced');
  }

  if (
    params.currentRange !== null &&
    params.recentAverageRange !== null &&
    params.recentAverageRange > 0 &&
    params.currentRange >= params.recentAverageRange * 1.2
  ) {
    evidence.push('the range is already wider than the recent session average');
  }

  if (currentBracket && priorRange !== null && priorRange.high !== null && params.state === 'accepted_up') {
    evidence.push('the latest 30m period is holding above the earlier session high');
  } else if (currentBracket && priorRange !== null && priorRange.low !== null && params.state === 'accepted_down') {
    evidence.push('the latest 30m period is holding below the earlier session low');
  } else if (currentBracket && priorRange !== null && priorRange.high !== null && params.state === 'failed_up') {
    evidence.push('the latest 30m period probed above the earlier high and fell back in');
  } else if (currentBracket && priorRange !== null && priorRange.low !== null && params.state === 'failed_down') {
    evidence.push('the latest 30m period probed below the earlier low and came back in');
  } else if (currentBracket && params.state === 'regained_balance') {
    evidence.push('the latest 30m period has rotated back toward the session middle');
  } else if (params.state === 'accepted_up') {
    evidence.push('the upside push is still holding near session highs');
  } else if (params.state === 'accepted_down') {
    evidence.push('the downside push is still holding near session lows');
  } else if (params.state === 'failed_up') {
    evidence.push('the upside push has failed back into the session range');
  } else if (params.state === 'failed_down') {
    evidence.push('the downside push has failed back into the session range');
  } else if (params.state === 'regained_balance') {
    evidence.push('the move has come back toward balance after stretching earlier');
  }

  return evidence.slice(0, 4);
}

function buildTransition(state: SessionState): SessionTransition | null {
  if (state === 'accepted_up') {
    return {
      from: 'expanding_up',
      to: 'accepted_up',
      reason: 'the upside push is holding near the high of the session range',
    };
  }

  if (state === 'accepted_down') {
    return {
      from: 'expanding_down',
      to: 'accepted_down',
      reason: 'the downside push is holding near the low of the session range',
    };
  }

  if (state === 'failed_up') {
    return {
      from: 'expanding_up',
      to: 'failed_up',
      reason: 'the upside move lost follow-through and fell back into range',
    };
  }

  if (state === 'failed_down') {
    return {
      from: 'expanding_down',
      to: 'failed_down',
      reason: 'the downside move lost follow-through and came back into range',
    };
  }

  if (state === 'regained_balance') {
    return {
      from: 'failed_up',
      to: 'regained_balance',
      reason: 'price has moved back toward the middle of the session range',
    };
  }

  return null;
}

function buildThirtyMinuteProfileContext(params: {
  brackets: ThirtyMinuteBracket[];
  metrics: SessionMetrics;
}): ThirtyMinuteProfileContext | null {
  const nonEmptyBrackets = params.brackets.filter((bracket) => bracket.tradeCount > 0);
  const currentBracket = nonEmptyBrackets[nonEmptyBrackets.length - 1];

  if (!currentBracket) {
    return null;
  }

  const priorBrackets = nonEmptyBrackets.filter((bracket) => bracket.index < currentBracket.index);
  const priorCompositeRange = combineRanges(priorBrackets.map((bracket) => bracket.range));
  const currentBias = classifySessionBias(currentBracket.aggression);
  const priorHigh = priorCompositeRange.high;
  const priorLow = priorCompositeRange.low;
  const currentHigh = currentBracket.range.high;
  const currentLow = currentBracket.range.low;
  const currentLast = currentBracket.range.last;
  const currentVwap = currentBracket.vwap ?? currentLast;
  const toleranceBase = getRangeSize(priorCompositeRange) ?? getRangeSize(params.metrics.range) ?? 0;
  const tolerance = Math.max(toleranceBase * 0.05, (params.metrics.sessionVwap ?? currentLast ?? 0) * 0.0004);
  const brokeUp = priorHigh !== null && currentHigh !== null && currentHigh > priorHigh;
  const brokeDown = priorLow !== null && currentLow !== null && currentLow < priorLow;
  const acceptedUp =
    brokeUp &&
    priorHigh !== null &&
    currentLast !== null &&
    currentVwap !== null &&
    currentLast >= priorHigh - tolerance &&
    currentVwap >= priorHigh - tolerance &&
    currentBias === 'buy';
  const acceptedDown =
    brokeDown &&
    priorLow !== null &&
    currentLast !== null &&
    currentVwap !== null &&
    currentLast <= priorLow + tolerance &&
    currentVwap <= priorLow + tolerance &&
    currentBias === 'sell';
  const failedUp =
    brokeUp &&
    priorHigh !== null &&
    currentLast !== null &&
    currentLast < priorHigh - tolerance &&
    currentBias !== 'buy';
  const failedDown =
    brokeDown &&
    priorLow !== null &&
    currentLast !== null &&
    currentLast > priorLow + tolerance &&
    currentBias !== 'sell';
  let priorBreakoutDirection: 'up' | 'down' | null = null;

  for (let index = 1; index < nonEmptyBrackets.length; index++) {
    const bracket = nonEmptyBrackets[index];
    const earlierRange = combineRanges(nonEmptyBrackets.slice(0, index).map((entry) => entry.range));
    if (earlierRange.high !== null && bracket?.range.high !== null && bracket.range.high > earlierRange.high) {
      priorBreakoutDirection = 'up';
    }
    if (earlierRange.low !== null && bracket?.range.low !== null && bracket.range.low < earlierRange.low) {
      priorBreakoutDirection = 'down';
    }
  }

  const regainedBalance =
    nonEmptyBrackets.length >= 3 &&
    priorBreakoutDirection !== null &&
    !brokeUp &&
    !brokeDown &&
    currentBias === 'balanced' &&
    params.metrics.sessionVwap !== null &&
    currentLast !== null &&
    Math.abs(currentLast - params.metrics.sessionVwap) <= Math.max(toleranceBase * 0.2, params.metrics.sessionVwap * 0.0007);

  return {
    currentBracket,
    priorCompositeRange,
    nonEmptyBracketCount: nonEmptyBrackets.length,
    currentBias,
    priorBreakoutDirection,
    brokeUp,
    brokeDown,
    acceptedUp,
    acceptedDown,
    failedUp,
    failedDown,
    regainedBalance,
  };
}

function classifyAggregateSessionState(params: {
  metrics: SessionMetrics;
  bias: SessionBias;
  rangePosition: number | null;
  rangeLocation: SessionRangeLocation;
  vwapRelation: SessionVwapRelation;
}): SessionState {
  const { metrics, bias, rangePosition, rangeLocation, vwapRelation } = params;
  const currentRange = getRangeSize(metrics.range) ?? 0;
  const strongBuy = metrics.cumulativeDelta > 0 && metrics.trailing5mAggression.buyPct >= 65 && bias === 'buy';
  const strongSell = metrics.cumulativeDelta < 0 && metrics.trailing5mAggression.sellPct >= 65 && bias === 'sell';
  const buyControl = metrics.cumulativeDelta > 0 && metrics.trailing5mAggression.buyPct >= 55 && bias === 'buy';
  const sellControl = metrics.cumulativeDelta < 0 && metrics.trailing5mAggression.sellPct >= 55 && bias === 'sell';
  const failedUp =
    rangePosition !== null &&
    rangePosition <= 0.2 &&
    vwapRelation !== 'above' &&
    currentRange > 0;
  const failedDown =
    rangePosition !== null &&
    rangePosition >= 0.8 &&
    vwapRelation !== 'below' &&
    currentRange > 0;
  const regainedBalance =
    rangeLocation === 'middle' &&
    vwapRelation === 'near' &&
    classifySessionBias(metrics.trailing5mAggression) === 'balanced' &&
    Math.abs(metrics.sessionAggression.buyPct - metrics.sessionAggression.sellPct) >= 10;

  if (strongBuy && rangePosition !== null && rangePosition >= 0.8 && vwapRelation === 'above') {
    return 'accepted_up';
  }

  if (strongSell && rangePosition !== null && rangePosition <= 0.2 && vwapRelation === 'below') {
    return 'accepted_down';
  }

  if (failedUp) {
    return 'failed_up';
  }

  if (failedDown) {
    return 'failed_down';
  }

  if (regainedBalance) {
    return 'regained_balance';
  }

  if (buyControl && rangePosition !== null && rangePosition >= 0.67 && vwapRelation === 'above') {
    return 'expanding_up';
  }

  if (sellControl && rangePosition !== null && rangePosition <= 0.33 && vwapRelation === 'below') {
    return 'expanding_down';
  }

  return 'balanced';
}

function classifySessionStateFromBrackets(params: {
  periodContext: ThirtyMinuteProfileContext;
  rangePosition: number | null;
  vwapRelation: SessionVwapRelation;
}): SessionState {
  const { periodContext, rangePosition, vwapRelation } = params;

  if (periodContext.acceptedUp) {
    return 'accepted_up';
  }

  if (periodContext.acceptedDown) {
    return 'accepted_down';
  }

  if (periodContext.failedUp) {
    return 'failed_up';
  }

  if (periodContext.failedDown) {
    return 'failed_down';
  }

  if (periodContext.regainedBalance) {
    return 'regained_balance';
  }

  if (
    periodContext.brokeUp &&
    periodContext.currentBias === 'buy' &&
    rangePosition !== null &&
    rangePosition >= 0.67 &&
    vwapRelation !== 'below'
  ) {
    return 'expanding_up';
  }

  if (
    periodContext.brokeDown &&
    periodContext.currentBias === 'sell' &&
    rangePosition !== null &&
    rangePosition <= 0.33 &&
    vwapRelation !== 'above'
  ) {
    return 'expanding_down';
  }

  return 'balanced';
}

function classifyConfidence(
  params: SessionProfileParams,
  state: SessionState,
  periodContext: ThirtyMinuteProfileContext | null,
): SessionConfidence {
  const stale =
    params.freshness.lastTradeAt === null ||
    params.now - params.freshness.lastTradeAt > STALE_TRADE_WINDOW_MS;
  const thin = params.metrics.tradeCount < 3 || params.metrics.totalVolume <= 0;
  const thinStructure = periodContext !== null && periodContext.nonEmptyBracketCount < 2;

  if (stale || thin || thinStructure) {
    return 'low';
  }

  if (
    state === 'accepted_up' ||
    state === 'accepted_down' ||
    state === 'failed_up' ||
    state === 'failed_down'
  ) {
    return 'high';
  }

  return 'medium';
}

function buildCaveat(params: SessionProfileParams, periodContext: ThirtyMinuteProfileContext | null): string | null {
  if (params.freshness.lastTradeAt === null) {
    return 'Live trade flow is still thin.';
  }

  if (params.now - params.freshness.lastTradeAt > STALE_TRADE_WINDOW_MS) {
    return 'The live session read is getting stale.';
  }

  if (params.metrics.tradeCount < 3) {
    return 'There is not much session evidence yet.';
  }

  if (periodContext !== null && periodContext.nonEmptyBracketCount < 2) {
    return 'The session has not printed enough 30m structure yet.';
  }

  return null;
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

export function deriveSessionProfile(params: SessionProfileParams): SessionProfile {
  const rangePosition = getRangePosition(params.metrics.range);
  const rangeLocation = classifyRangeLocation(rangePosition);
  const vwapRelation = classifyVwapRelation(params.metrics);
  const brackets = buildThirtyMinuteBrackets({
    trades: params.trades ?? [],
    now: params.now,
    sessionStart: params.metrics.sessionStart,
  });
  const periodContext = buildThirtyMinuteProfileContext({
    brackets,
    metrics: params.metrics,
  });
  const rawBias = periodContext?.currentBias ?? classifySessionBias(params.metrics.sessionAggression);
  const state = periodContext
    ? classifySessionStateFromBrackets({
        periodContext,
        rangePosition,
        vwapRelation,
      })
    : classifyAggregateSessionState({
        metrics: params.metrics,
        bias: rawBias,
        rangePosition,
        rangeLocation,
        vwapRelation,
      });
  const bias = normalizeBiasForState(state, rawBias);
  const confidence = classifyConfidence(params, state, periodContext);
  const recentAverageRange = getRecentAverageRange(params);
  const currentRange = getRangeSize(params.metrics.range);

  return {
    state,
    bias,
    confidence,
    rangeLocation,
    vwapRelation,
    transition: buildTransition(state),
    evidence: buildEvidence({
      state,
      bias,
      rangeLocation,
      vwapRelation,
      recentAverageRange,
      currentRange,
      metrics: params.metrics,
      periodContext,
    }),
    caveat: buildCaveat(params, periodContext),
  };
}
