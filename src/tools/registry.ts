import { StructuredToolInterface } from '@langchain/core/tools';
import { levelResponseTool, marketContextTool, recentSessionsTool, sessionProfileTool } from './market/index.js';

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
- Data is driven by local market state built from Hyperliquid bootstrap + stream ingestion`;

const RECENT_SESSIONS_DESCRIPTION = `Bounded recent-session context for BTC/USD on Hyperliquid.

## When to Use

- The user wants recent session context or comparison with recent history
- The user asks how the current session differs from the last few UTC sessions

## Usage Notes

- Returns up to the last 7 completed UTC sessions
- Includes compact comparison context against the live session`;

const SESSION_PROFILE_DESCRIPTION = `Computed session structure for BTC/USD on Hyperliquid.

## When to Use

- The user asks what kind of session this is right now
- The user wants current structure, expansion, failure, or balance-to-imbalance state
- The user wants the current directional bias and latest clear transition

## Usage Notes

- Returns deterministic session state, confidence, and brief evidence
- Keeps structure labels computed in code so the model does not invent them`;

const LEVEL_RESPONSE_DESCRIPTION = `Deterministic acceptance/rejection analysis for BTC/USD on Hyperliquid levels.

## When to Use

- The user asks if price is accepting or rejecting a level
- The user refers to session open/high/low/VWAP or prior-session landmarks

## Usage Notes

- Accepts either an explicit price level or a named session landmark
- Uses measured post-cross trade behavior and delta alignment to classify the response`;

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
