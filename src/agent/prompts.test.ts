import { describe, expect, test } from 'bun:test';
import { buildFinalAnswerPrompt, buildIterationPrompt, buildSystemPrompt } from './prompts.js';

describe('buildSystemPrompt', () => {
  test('uses Kryzov identity and excludes Dexter finance instructions', () => {
    const prompt = buildSystemPrompt('gpt-5.2');

    expect(prompt).toContain('You are Kryzov');
    expect(prompt).toContain('BTC/USD');
    expect(prompt).toContain('Hyperliquid');
    expect(prompt).toContain('Russian AI research agent');
    expect(prompt).toContain('Measured facts come first');
    expect(prompt).toContain('Interpretation comes second');
    expect(prompt).toContain('initiative continuation');
    expect(prompt).toContain('Do not predict candles or promise directional outcomes');
    expect(prompt).toContain('Keep responses short, serious, and readable under live conditions');
    expect(prompt).toContain('adaptive terminal-first style');
    expect(prompt).toContain('one short paragraph, two short paragraphs, or up to three short blocks');
    expect(prompt).toContain('plain phrasing first');
    expect(prompt).toContain('serious terminal-native market researcher');
    expect(prompt).not.toContain('financial_search');
    expect(prompt).not.toContain('read_filings');
    expect(prompt).not.toContain('You are Dexter');
  });
});

describe('buildIterationPrompt', () => {
  test('uses adaptive terminal-friendly blocks for simple comparison prompts', () => {
    const prompt = buildIterationPrompt(
      'Compare the current session to the last 5 sessions and explain the divergence',
      'recent_sessions: comparison context',
      'Used recent_sessions successfully.',
    );

    expect(prompt).toContain('Use one short paragraph, two short paragraphs, or up to three short blocks when the explanation genuinely needs it');
    expect(prompt).toContain('Start with the clearest main answer');
    expect(prompt).toContain('Keep measured facts first in substance');
    expect(prompt).toContain('Prefer relative facts like lower, wider, more balanced, or less one-sided');
    expect(prompt).toContain('Use blank lines when they improve terminal scanability');
    expect(prompt).toContain('Avoid report-style openings like about 1,450 points below or 3.15x wider');
    expect(prompt).toContain('Use exact numbers only when they materially improve clarity');
  });

  test('uses the simple-by-default contract in the post-tool answer prompt', () => {
    const prompt = buildIterationPrompt(
      'Compare the current session to the last 5 sessions and explain the divergence',
      'market_context: price is above VWAP',
      'Used market_context successfully.',
    );

    expect(prompt).toContain('Measured tool context');
    expect(prompt).toContain('Explain only as much as needed');
    expect(prompt).toContain('Use one short paragraph, two short paragraphs, or up to three short blocks');
    expect(prompt).toContain('Use plain phrasing first and Kryzov-native labels second only when useful');
    expect(prompt).toContain('Do not sound like a generic explainer');
    expect(prompt).toContain('Bullets are optional only when they clearly improve multi-point clarity');
    expect(prompt).toContain('If you already have enough measured evidence, answer without additional tool calls');
    expect(prompt).toContain('Do not improvise unsupported concepts');
    expect(prompt).toContain('narrow weak claims instead of sounding more certain');
  });

  test('uses evidence mode only for explicit evidence requests', () => {
    const prompt = buildIterationPrompt(
      'Compare the current session to the last 5 sessions and show the measured facts',
      'market_context: price is above VWAP',
      'Used market_context successfully.',
    );

    expect(prompt).toContain('Lead with the measured facts the user asked for');
    expect(prompt).toContain('Include the key numbers');
    expect(prompt).not.toContain('Do not sound like a generic explainer');
  });

  test('omits tool-usage status when none is provided', () => {
    const prompt = buildIterationPrompt(
      'What is the auction doing here?',
      'market_context: price is above VWAP',
      null,
    );

    expect(prompt).not.toContain('## Tool Usage This Query');
  });
});

describe('buildFinalAnswerPrompt', () => {
  test('uses adaptive terminal-readable comparison rules in final answer prompts', () => {
    const prompt = buildFinalAnswerPrompt(
      'Compare the current session to the last 5 sessions and explain the divergence',
      'recent_sessions: comparison context',
    );

    expect(prompt).toContain('Use one short paragraph, two short paragraphs, or up to three short blocks when the explanation genuinely needs it');
    expect(prompt).toContain('Start with the clearest main answer');
    expect(prompt).toContain('Keep measured facts first in substance');
    expect(prompt).toContain('Do not add an evidence footer');
  });

  test('preserves the simple-by-default final answer contract', () => {
    const prompt = buildFinalAnswerPrompt('What is the read?', 'market_context: balanced session');

    expect(prompt).toContain('Explain only as much as needed');
    expect(prompt).toContain('Use one short paragraph, two short paragraphs, or up to three short blocks');
    expect(prompt).toContain('Do not sound like a generic explainer');
    expect(prompt).toContain('Use plain phrasing first and Kryzov-native labels second only when useful');
    expect(prompt).toContain('Do not turn the answer into a signal, prediction, or execution plan');
  });
});

describe('buildSystemPrompt', () => {
  test('uses compact tool descriptions for Kryzov runtime tools', () => {
    const prompt = buildSystemPrompt('gpt-5.2');

    expect(prompt).toContain('market_context: current BTC/USD Hyperliquid session state');
    expect(prompt).toContain('session_profile: computed BTC/USD Hyperliquid session structure and transition state');
    expect(prompt).toContain('positioning_regime: current BTC/USD Hyperliquid participation, open interest, funding, and premium regime');
    expect(prompt).toContain('volatility_pace: current BTC/USD Hyperliquid range, volume, trade-rate, and volatility pace');
    expect(prompt).toContain('session_analogs: closest recent BTC/USD Hyperliquid sessions by structure, pace, aggression, and positioning');
    expect(prompt).toContain('order_book_state: current BTC/USD Hyperliquid liquidity, imbalance, and book pressure');
    expect(prompt).toContain('flow_events: recent deterministic BTC/USD Hyperliquid sweeps, failures, and VWAP events');
    expect(prompt).toContain('reference_map: ranked BTC/USD Hyperliquid session and intraday references in play');
    expect(prompt).toContain('recent_sessions: recent completed BTC/USD Hyperliquid sessions for comparison');
    expect(prompt).toContain('level_response: measured acceptance/rejection analysis for explicit levels or session landmarks');
    expect(prompt).toContain('Use market_context plus session_profile for broad live session reads');
    expect(prompt).toContain('Use positioning_regime when the user asks whether the move has real participation, whether open interest is building, or whether the move looks like covering or unwind');
    expect(prompt).toContain('Use volatility_pace when the user asks whether BTC is actually expanding, compressing, stalling, or moving faster than normal');
    expect(prompt).toContain('Use session_analogs when the user asks what today most resembles so far or wants the closest recent sessions by measured behavior');
    expect(prompt).toContain('Add order_book_state when the user asks why price is stalling, moving, or where near-price liquidity is leaning');
    expect(prompt).toContain('Use flow_events when the user asks what just happened, whether a move failed, or whether there was a sweep or reclaim/loss event');
    expect(prompt).toContain('Use reference_map when the user asks what levels matter right now or wants ranked references before a narrower level check');
    expect(prompt).toContain('For narrow acceptance or rejection questions, use level_response directly');
    expect(prompt).not.toContain('## When to Use');
    expect(prompt).not.toContain('## When NOT to Use');
    expect(prompt).not.toContain('## Usage Notes');
  });
});
