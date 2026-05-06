import { StructuredToolInterface } from '@langchain/core/tools';
import {
  flowEventsTool,
  levelResponseTool,
  marketContextTool,
  orderBookStateTool,
  positioningRegimeTool,
  recentSessionsTool,
  referenceMapTool,
  sessionAnalogsTool,
  sessionProfileTool,
  volatilityPaceTool,
} from './market/index.js';

export interface RegisteredTool {
  name: string;
  tool: StructuredToolInterface;
  description: string;
  promptDescription: string;
}

const MARKET_CONTEXT_DESCRIPTION = `Measured BTC/USD session state on Hyperliquid.

## When to Use

- The user asks what the auction is doing right now
- The user wants session state, VWAP, cumulative delta, aggression split, or live asset context
- The user wants a bounded interpretive read grounded in measured evidence

## When NOT to Use

- The user asks for execution advice, buy/sell recommendations, or trade signals
- The user asks about assets outside BTC/USD on Hyperliquid perps

## Usage Notes

- Returns measured facts first and a bounded interpretive read second
- Data is driven by local market state built from Hyperliquid bootstrap + stream ingestion
- Includes data-quality coverage and confidence flags for the current session`;

const RECENT_SESSIONS_DESCRIPTION = `Bounded recent-session context for BTC/USD on Hyperliquid.

## When to Use

- The user wants recent session context or comparison with recent history
- The user asks how the current session differs from the last few UTC sessions

## Usage Notes

- Returns up to the last 7 completed UTC sessions
- Includes compact comparison context against the live session
- Includes per-session source quality so archived real history is distinguishable from bootstrap fallback`;

const SESSION_PROFILE_DESCRIPTION = `Computed session structure for BTC/USD on Hyperliquid.

## When to Use

- The user asks what kind of session this is right now
- The user wants current structure, expansion, failure, or balance-to-imbalance state
- The user wants the current directional bias and latest clear transition

## Usage Notes

- Returns deterministic session state, confidence, and brief evidence
- Keeps structure labels computed in code so the model does not invent them
- Uses the live session snapshot, which now includes data-quality coverage metadata`;

const LEVEL_RESPONSE_DESCRIPTION = `Deterministic acceptance/rejection analysis for BTC/USD on Hyperliquid levels.

## When to Use

- The user asks if price is accepting or rejecting a level
- The user refers to session open/high/low/VWAP or prior-session landmarks

## Usage Notes

- Accepts either an explicit price level or a named session landmark
- Uses measured post-cross trade behavior and delta alignment to classify the response`;

const ORDER_BOOK_STATE_DESCRIPTION = `Measured BTC/USD Hyperliquid order book state.

## When to Use

- The user asks why price is stalling or moving right now
- The user wants spread, imbalance, nearby depth, liquidity walls, or sweep cost
- The user asks whether the book is supporting buyers or leaning on sellers

## Usage Notes

- Returns measured top-of-book, near-price depth, wall, and recent book-change context
- Keeps the read bounded to current visible liquidity rather than predictions`;

const FLOW_EVENTS_DESCRIPTION = `Deterministic recent BTC/USD Hyperliquid flow events.

## When to Use

- The user asks what just happened on the tape
- The user asks whether there was a sweep, failed breakout, failed breakdown, or reclaim/loss of VWAP
- The user wants recent measured event context instead of a broad session summary

## Usage Notes

- Returns recent event candidates ranked by confidence
- Uses measured trade and book behavior only`;

const REFERENCE_MAP_DESCRIPTION = `Ranked BTC/USD Hyperliquid references in play right now.

## When to Use

- The user asks what levels matter right now
- The user wants ranked session, prior-session, opening-range, or initial-balance references
- The user wants a map before checking one specific level in detail

## Usage Notes

- Returns ranked references with proximity, recent touch context, and last measured response
- Use level_response afterward for a narrower single-level follow-up`;

const POSITIONING_REGIME_DESCRIPTION = `Deterministic BTC/USD Hyperliquid positioning regime.

## When to Use

- The user asks whether the move has real participation behind it
- The user wants price together with open interest, funding, and premium path
- The user asks whether the move looks more like buildup, covering, unwind, or inventory build

## Usage Notes

- Uses archived asset-context history for the active UTC session
- Keeps the read bounded to measured positioning state rather than predictions`;

const VOLATILITY_PACE_DESCRIPTION = `Deterministic BTC/USD Hyperliquid volatility and activity pace.

## When to Use

- The user asks whether BTC is actually expanding or just rotating
- The user wants range pace, trade rate, volume pace, or recent realized volatility
- The user asks whether activity is compressed, normal, expanding, or fast

## Usage Notes

- Compares current session pace against recent completed sessions
- Uses archived real trade coverage where available`;

const SESSION_ANALOGS_DESCRIPTION = `Measured recent-session analogs for BTC/USD on Hyperliquid.

## When to Use

- The user asks what today most resembles so far
- The user wants the closest recent sessions by structure, pace, aggression, and positioning
- The user asks what is similar or different versus the best recent analogs

## Usage Notes

- Returns ranked recent analog sessions with matched and diverging dimensions
- Uses local archived trade and asset-context features where available`;

export function getToolRegistry(_model: string): RegisteredTool[] {
  return [
    {
      name: 'market_context',
      tool: marketContextTool,
      description: MARKET_CONTEXT_DESCRIPTION,
      promptDescription: 'market_context: current BTC/USD Hyperliquid session state',
    },
    {
      name: 'session_profile',
      tool: sessionProfileTool,
      description: SESSION_PROFILE_DESCRIPTION,
      promptDescription: 'session_profile: computed BTC/USD Hyperliquid session structure and transition state',
    },
    {
      name: 'positioning_regime',
      tool: positioningRegimeTool,
      description: POSITIONING_REGIME_DESCRIPTION,
      promptDescription: 'positioning_regime: current BTC/USD Hyperliquid participation, open interest, funding, and premium regime',
    },
    {
      name: 'volatility_pace',
      tool: volatilityPaceTool,
      description: VOLATILITY_PACE_DESCRIPTION,
      promptDescription: 'volatility_pace: current BTC/USD Hyperliquid range, volume, trade-rate, and volatility pace',
    },
    {
      name: 'session_analogs',
      tool: sessionAnalogsTool,
      description: SESSION_ANALOGS_DESCRIPTION,
      promptDescription: 'session_analogs: closest recent BTC/USD Hyperliquid sessions by structure, pace, aggression, and positioning',
    },
    {
      name: 'order_book_state',
      tool: orderBookStateTool,
      description: ORDER_BOOK_STATE_DESCRIPTION,
      promptDescription: 'order_book_state: current BTC/USD Hyperliquid liquidity, imbalance, and book pressure',
    },
    {
      name: 'flow_events',
      tool: flowEventsTool,
      description: FLOW_EVENTS_DESCRIPTION,
      promptDescription: 'flow_events: recent deterministic BTC/USD Hyperliquid sweeps, failures, and VWAP events',
    },
    {
      name: 'reference_map',
      tool: referenceMapTool,
      description: REFERENCE_MAP_DESCRIPTION,
      promptDescription: 'reference_map: ranked BTC/USD Hyperliquid session and intraday references in play',
    },
    {
      name: 'recent_sessions',
      tool: recentSessionsTool,
      description: RECENT_SESSIONS_DESCRIPTION,
      promptDescription: 'recent_sessions: recent completed BTC/USD Hyperliquid sessions for comparison',
    },
    {
      name: 'level_response',
      tool: levelResponseTool,
      description: LEVEL_RESPONSE_DESCRIPTION,
      promptDescription: 'level_response: measured acceptance/rejection analysis for explicit levels or session landmarks',
    },
  ];
}

export function getTools(model: string): StructuredToolInterface[] {
  return getToolRegistry(model).map((tool) => tool.tool);
}

export function buildToolDescriptions(model: string): string {
  return getToolRegistry(model)
    .map((tool) => tool.promptDescription)
    .join('\n');
}
