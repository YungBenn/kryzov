import {
  computeSessionMetrics,
  deriveSessionProfile,
  type MarketTrade,
  type SessionProfile,
  type SessionRange,
} from './analytics.js';
import type { MarketAssetContextPoint, PersistedSessionSummary } from './store.js';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface PositioningRegime {
  regime:
    | 'long_buildup'
    | 'short_covering'
    | 'short_buildup'
    | 'long_unwind'
    | 'inventory_build'
    | 'mixed';
  crowding: 'long_crowded' | 'short_crowded' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
  lookbackMinutes: number;
  points: number;
  priceChangePct: number | null;
  openInterestChangePct: number | null;
  premiumChangeBps: number | null;
  funding: number | null;
  evidence: string[];
  caveat: string | null;
}

export interface VolatilityPace {
  regime: 'compressed' | 'normal' | 'expanding' | 'fast';
  confidence: 'low' | 'medium' | 'high';
  sessionProgressPct: number;
  currentRange: number | null;
  rangePaceRatio: number | null;
  tradeRateRatio: number | null;
  volumeRateRatio: number | null;
  realizedVol30mBps: number | null;
  tradeRatePerHour: number | null;
  volumeRatePerHour: number | null;
  evidence: string[];
  caveat: string | null;
}

export interface SessionFeatureVector {
  sessionDate: string;
  sessionProgressPct: number;
  structureState: SessionProfile['state'];
  positioningRegime: PositioningRegime['regime'];
  volatilityRegime: VolatilityPace['regime'];
  currentRange: number | null;
  openingRangeSize: number | null;
  initialBalanceSize: number | null;
  rangePaceRatio: number | null;
  tradeRateRatio: number | null;
  volumeRateRatio: number | null;
  aggressionSkew: number;
  normalizedDelta: number | null;
  realizedVol30mBps: number | null;
}

export interface SessionAnalogMatch {
  sessionDate: string;
  score: number;
  similarity: 'high' | 'medium' | 'low';
  matchedDimensions: string[];
  divergingDimensions: string[];
  featureVector: SessionFeatureVector;
}

function getRangeSize(range: SessionRange): number | null {
  if (range.high === null || range.low === null) {
    return null;
  }

  return range.high - range.low;
}

function getTradesInWindow(trades: MarketTrade[], start: number, end: number): MarketTrade[] {
  return trades.filter((trade) => trade.timestamp >= start && trade.timestamp <= end);
}

function getTradeWindowRangeSize(trades: MarketTrade[]): number | null {
  if (trades.length === 0) {
    return null;
  }

  const prices = trades.map((trade) => trade.price);
  return Math.max(...prices) - Math.min(...prices);
}

function normalizeStateFromSummary(summary: PersistedSessionSummary): SessionProfile['state'] {
  const last = summary.range.last;
  const vwap = summary.sessionVwap;

  if (summary.auctionBehavior === 'initiative' && last !== null && vwap !== null) {
    return last >= vwap ? 'expanding_up' : 'expanding_down';
  }

  if (summary.auctionBehavior === 'responsive') {
    return 'balanced';
  }

  return 'balanced';
}

function getSessionHours(params: {
  sessionStart: number;
  sessionEnd: number;
}): number {
  return Math.max((params.sessionEnd - params.sessionStart) / HOUR_MS, 1 / 60);
}

function getNumericCloseness(left: number | null, right: number | null, tolerance: number): number | null {
  if (left === null || right === null || tolerance <= 0) {
    return null;
  }

  const diff = Math.abs(left - right);
  return Math.max(0, 1 - diff / tolerance);
}

function percentChange(current: number | null | undefined, baseline: number | null | undefined): number | null {
  if (
    current === null ||
    current === undefined ||
    baseline === null ||
    baseline === undefined ||
    baseline === 0
  ) {
    return null;
  }

  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function bpsChange(current: number | null | undefined, baseline: number | null | undefined): number | null {
  if (
    current === null ||
    current === undefined ||
    baseline === null ||
    baseline === undefined
  ) {
    return null;
  }

  return (current - baseline) * 10_000;
}

function sortAssetPoints(points: MarketAssetContextPoint[]): MarketAssetContextPoint[] {
  return [...points].sort((left, right) => left.timestamp - right.timestamp);
}

function getCrowding(params: {
  funding: number | null;
  premiumChangeBps: number | null;
}): PositioningRegime['crowding'] {
  if ((params.funding ?? 0) >= 0.0001 || (params.premiumChangeBps ?? 0) >= 5) {
    return 'long_crowded';
  }

  if ((params.funding ?? 0) <= -0.0001 || (params.premiumChangeBps ?? 0) <= -5) {
    return 'short_crowded';
  }

  return 'neutral';
}

export function derivePositioningRegime(params: {
  assetContextHistory: MarketAssetContextPoint[];
  now: number;
  sessionStart: number;
}): PositioningRegime {
  const points = sortAssetPoints(
    params.assetContextHistory.filter((point) => point.timestamp >= params.sessionStart && point.timestamp <= params.now),
  );
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;
  const lookbackMinutes =
    first && last ? Math.max(1, Math.round((last.timestamp - first.timestamp) / 60_000)) : 0;

  if (!first || !last) {
    return {
      regime: 'mixed',
      crowding: 'neutral',
      confidence: 'low',
      lookbackMinutes,
      points: points.length,
      priceChangePct: null,
      openInterestChangePct: null,
      premiumChangeBps: null,
      funding: null,
      evidence: ['not enough asset-context history yet'],
      caveat: 'Need more asset-context samples for a positioning read.',
    };
  }

  const baselinePrice = first.markPx ?? first.oraclePx ?? null;
  const currentPrice = last.markPx ?? last.oraclePx ?? null;
  const priceChangePct = percentChange(currentPrice, baselinePrice);
  const openInterestChangePct = percentChange(last.openInterest ?? null, first.openInterest ?? null);
  const premiumChangeBps = bpsChange(last.premium ?? null, first.premium ?? null);
  const funding = last.funding ?? null;
  const crowding = getCrowding({ funding, premiumChangeBps });
  let regime: PositioningRegime['regime'] = 'mixed';

  if ((priceChangePct ?? 0) >= 0.2 && (openInterestChangePct ?? 0) >= 1.0) {
    regime = 'long_buildup';
  } else if ((priceChangePct ?? 0) >= 0.2 && (openInterestChangePct ?? 0) <= -1.0) {
    regime = 'short_covering';
  } else if ((priceChangePct ?? 0) <= -0.2 && (openInterestChangePct ?? 0) >= 1.0) {
    regime = 'short_buildup';
  } else if ((priceChangePct ?? 0) <= -0.2 && (openInterestChangePct ?? 0) <= -1.0) {
    regime = 'long_unwind';
  } else if (Math.abs(priceChangePct ?? 0) < 0.2 && Math.abs(openInterestChangePct ?? 0) >= 1.2) {
    regime = 'inventory_build';
  }

  const confidence: PositioningRegime['confidence'] =
    points.length >= 4 &&
    (Math.abs(priceChangePct ?? 0) >= 0.25 || Math.abs(openInterestChangePct ?? 0) >= 1.5)
      ? 'high'
      : points.length >= 3
        ? 'medium'
        : 'low';

  const evidence = [
    priceChangePct !== null ? `price ${priceChangePct >= 0 ? 'up' : 'down'} ${Math.abs(priceChangePct).toFixed(2)}%` : 'price path unavailable',
    openInterestChangePct !== null
      ? `open interest ${openInterestChangePct >= 0 ? 'up' : 'down'} ${Math.abs(openInterestChangePct).toFixed(2)}%`
      : 'open interest path unavailable',
    premiumChangeBps !== null ? `premium moved ${premiumChangeBps.toFixed(1)} bps` : 'premium path unavailable',
  ];

  return {
    regime,
    crowding,
    confidence,
    lookbackMinutes,
    points: points.length,
    priceChangePct,
    openInterestChangePct,
    premiumChangeBps,
    funding,
    evidence,
    caveat: points.length < 3 ? 'Positioning read is still early.' : null,
  };
}

function computeMean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeStdDev(values: number[]): number {
  const mean = computeMean(values);
  const variance = computeMean(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function computeRealizedVol30mBps(trades: MarketTrade[], now: number): number | null {
  const recentTrades = [...trades]
    .filter((trade) => trade.timestamp >= now - THIRTY_MINUTES_MS && trade.timestamp <= now)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (recentTrades.length < 3) {
    return null;
  }

  const returns: number[] = [];
  for (let index = 1; index < recentTrades.length; index++) {
    const previous = recentTrades[index - 1];
    const current = recentTrades[index];
    if (!previous || !current || previous.price <= 0) {
      continue;
    }
    returns.push((current.price - previous.price) / previous.price);
  }

  if (returns.length < 2) {
    return null;
  }

  return computeStdDev(returns) * 10_000;
}

export function deriveVolatilityPace(params: {
  liveSession: PersistedSessionSummary;
  recentSessions: PersistedSessionSummary[];
  trades: MarketTrade[];
  now: number;
}): VolatilityPace {
  const elapsedMs = Math.max(params.now - params.liveSession.sessionStart, 1);
  const sessionProgressPct = Math.min(100, (elapsedMs / (24 * HOUR_MS)) * 100);
  const progressRatio = Math.max(sessionProgressPct / 100, 0.01);
  const currentRange = getRangeSize(params.liveSession.range);
  const recentRanges = params.recentSessions
    .map((session) => getRangeSize(session.range))
    .filter((value): value is number => value !== null && value > 0);
  const recentTradeCounts = params.recentSessions
    .map((session) => session.tradeCount)
    .filter((value) => value > 0);
  const recentVolumes = params.recentSessions
    .map((session) => session.totalVolume)
    .filter((value) => value > 0);
  const averageRecentRange = recentRanges.length > 0 ? computeMean(recentRanges) : null;
  const averageRecentTradeCount = recentTradeCounts.length > 0 ? computeMean(recentTradeCounts) : null;
  const averageRecentVolume = recentVolumes.length > 0 ? computeMean(recentVolumes) : null;
  const rangePaceRatio =
    currentRange !== null && averageRecentRange !== null
      ? currentRange / (averageRecentRange * progressRatio)
      : null;
  const tradeRateRatio =
    averageRecentTradeCount !== null
      ? params.liveSession.tradeCount / (averageRecentTradeCount * progressRatio)
      : null;
  const volumeRateRatio =
    averageRecentVolume !== null
      ? params.liveSession.totalVolume / (averageRecentVolume * progressRatio)
      : null;
  const tradeRatePerHour = params.liveSession.tradeCount / (elapsedMs / HOUR_MS);
  const volumeRatePerHour = params.liveSession.totalVolume / (elapsedMs / HOUR_MS);
  const realizedVol30mBps = computeRealizedVol30mBps(params.trades, params.now);
  const dominantRatio = Math.max(rangePaceRatio ?? 1, tradeRateRatio ?? 1, volumeRateRatio ?? 1);

  let regime: VolatilityPace['regime'] = 'normal';
  if (dominantRatio >= 2) {
    regime = 'fast';
  } else if (dominantRatio >= 1.3) {
    regime = 'expanding';
  } else if (dominantRatio <= 0.7) {
    regime = 'compressed';
  }

  const confidence: VolatilityPace['confidence'] =
    params.recentSessions.length >= 3 && sessionProgressPct >= 10 ? 'high' : params.recentSessions.length >= 1 ? 'medium' : 'low';
  const evidence = [
    rangePaceRatio !== null ? `range pace is ${rangePaceRatio.toFixed(2)}x the recent norm` : 'range pace unavailable',
    tradeRateRatio !== null ? `trade rate is ${tradeRateRatio.toFixed(2)}x normal` : 'trade rate unavailable',
    volumeRateRatio !== null ? `volume pace is ${volumeRateRatio.toFixed(2)}x normal` : 'volume pace unavailable',
  ];

  return {
    regime,
    confidence,
    sessionProgressPct,
    currentRange,
    rangePaceRatio,
    tradeRateRatio,
    volumeRateRatio,
    realizedVol30mBps,
    tradeRatePerHour: Number.isFinite(tradeRatePerHour) ? tradeRatePerHour : null,
    volumeRatePerHour: Number.isFinite(volumeRatePerHour) ? volumeRatePerHour : null,
    evidence,
    caveat: params.recentSessions.length === 0 ? 'No recent-session baseline yet.' : null,
  };
}

export function extractSessionFeatureVector(params: {
  session: PersistedSessionSummary;
  trades: MarketTrade[];
  assetContextHistory: MarketAssetContextPoint[];
  baselineSessions: PersistedSessionSummary[];
  now?: number;
}): SessionFeatureVector {
  const sessionNow = params.now ?? params.session.sessionEnd;
  const sessionTrades = [...params.trades]
    .filter((trade) => trade.timestamp >= params.session.sessionStart && trade.timestamp <= sessionNow)
    .sort((left, right) => left.timestamp - right.timestamp);
  const openingRangeSize = getTradeWindowRangeSize(
    getTradesInWindow(
      sessionTrades,
      params.session.sessionStart,
      Math.min(sessionNow, params.session.sessionStart + 5 * 60 * 1000),
    ),
  );
  const initialBalanceSize = getTradeWindowRangeSize(
    getTradesInWindow(
      sessionTrades,
      params.session.sessionStart,
      Math.min(sessionNow, params.session.sessionStart + HOUR_MS),
    ),
  );
  const volatilityPace = deriveVolatilityPace({
    liveSession: {
      ...params.session,
      sessionEnd: sessionNow,
    },
    recentSessions: params.baselineSessions,
    trades: sessionTrades,
    now: sessionNow,
  });
  const positioningRegime = derivePositioningRegime({
    assetContextHistory: params.assetContextHistory,
    now: sessionNow,
    sessionStart: params.session.sessionStart,
  });
  const derivedState =
    sessionTrades.length > 0
      ? deriveSessionProfile({
          metrics: computeSessionMetrics({
            trades: sessionTrades,
            now: sessionNow,
            sessionStart: params.session.sessionStart,
          }),
          trades: sessionTrades,
          now: sessionNow,
          freshness: params.session.freshness,
          recentSessions: params.baselineSessions,
          levelReferences: {},
        }).state
      : normalizeStateFromSummary(params.session);
  const elapsedHours = getSessionHours({
    sessionStart: params.session.sessionStart,
    sessionEnd: sessionNow,
  });

  return {
    sessionDate: params.session.sessionDate,
    sessionProgressPct: Math.min(100, ((sessionNow - params.session.sessionStart) / (24 * HOUR_MS)) * 100),
    structureState: derivedState,
    positioningRegime: positioningRegime.regime,
    volatilityRegime: volatilityPace.regime,
    currentRange: getRangeSize(params.session.range),
    openingRangeSize,
    initialBalanceSize,
    rangePaceRatio: volatilityPace.rangePaceRatio,
    tradeRateRatio: volatilityPace.tradeRateRatio,
    volumeRateRatio: volatilityPace.volumeRateRatio,
    aggressionSkew: params.session.sessionAggression.buyPct - params.session.sessionAggression.sellPct,
    normalizedDelta: params.session.totalVolume > 0 ? params.session.cumulativeDelta / params.session.totalVolume : null,
    realizedVol30mBps: volatilityPace.realizedVol30mBps,
  };
}

function scoreStateSimilarity(
  liveVector: SessionFeatureVector,
  historicalVector: SessionFeatureVector,
): { score: number; matched: string[]; diverging: string[] } {
  let score = 0;
  const matched: string[] = [];
  const diverging: string[] = [];

  if (liveVector.structureState === historicalVector.structureState) {
    score += 24;
    matched.push('structure');
  } else {
    diverging.push('structure');
  }

  if (liveVector.positioningRegime === historicalVector.positioningRegime) {
    score += 20;
    matched.push('positioning');
  } else {
    diverging.push('positioning');
  }

  if (liveVector.volatilityRegime === historicalVector.volatilityRegime) {
    score += 18;
    matched.push('pace');
  } else {
    diverging.push('pace');
  }

  const rangePaceCloseness = getNumericCloseness(
    liveVector.rangePaceRatio,
    historicalVector.rangePaceRatio,
    1.2,
  );
  if (rangePaceCloseness !== null) {
    score += rangePaceCloseness * 12;
    if (rangePaceCloseness >= 0.7) {
      matched.push('range pace');
    } else {
      diverging.push('range pace');
    }
  }

  const tradeRateCloseness = getNumericCloseness(
    liveVector.tradeRateRatio,
    historicalVector.tradeRateRatio,
    1.2,
  );
  if (tradeRateCloseness !== null) {
    score += tradeRateCloseness * 8;
    if (tradeRateCloseness >= 0.7) {
      matched.push('trade rate');
    } else {
      diverging.push('trade rate');
    }
  }

  const volumeRateCloseness = getNumericCloseness(
    liveVector.volumeRateRatio,
    historicalVector.volumeRateRatio,
    1.2,
  );
  if (volumeRateCloseness !== null) {
    score += volumeRateCloseness * 8;
    if (volumeRateCloseness >= 0.7) {
      matched.push('volume pace');
    } else {
      diverging.push('volume pace');
    }
  }

  const aggressionCloseness = getNumericCloseness(
    liveVector.aggressionSkew,
    historicalVector.aggressionSkew,
    35,
  );
  if (aggressionCloseness !== null) {
    score += aggressionCloseness * 6;
    if (aggressionCloseness >= 0.7) {
      matched.push('aggression skew');
    } else {
      diverging.push('aggression skew');
    }
  }

  const deltaCloseness = getNumericCloseness(
    liveVector.normalizedDelta,
    historicalVector.normalizedDelta,
    0.5,
  );
  if (deltaCloseness !== null) {
    score += deltaCloseness * 4;
    if (deltaCloseness >= 0.7) {
      matched.push('delta shape');
    } else {
      diverging.push('delta shape');
    }
  }

  return {
    score,
    matched: [...new Set(matched)],
    diverging: [...new Set(diverging)].filter((item) => !matched.includes(item)),
  };
}

export function rankSessionAnalogs(params: {
  liveVector: SessionFeatureVector;
  historicalVectors: SessionFeatureVector[];
  limit?: number;
}): SessionAnalogMatch[] {
  return params.historicalVectors
    .map((vector) => {
      const scored = scoreStateSimilarity(params.liveVector, vector);
      const normalizedScore = Math.max(0, Math.min(100, Number(scored.score.toFixed(2))));
      const similarity: SessionAnalogMatch['similarity'] =
        normalizedScore >= 75 ? 'high' : normalizedScore >= 50 ? 'medium' : 'low';

      return {
        sessionDate: vector.sessionDate,
        score: normalizedScore,
        similarity,
        matchedDimensions: scored.matched.slice(0, 5),
        divergingDimensions: scored.diverging.slice(0, 4),
        featureVector: vector,
      } satisfies SessionAnalogMatch;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, params.limit ?? 3);
}
