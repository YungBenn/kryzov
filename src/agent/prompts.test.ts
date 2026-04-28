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
    expect(prompt).not.toContain('financial_search');
    expect(prompt).not.toContain('read_filings');
    expect(prompt).not.toContain('You are Dexter');
  });
});

describe('buildIterationPrompt', () => {
  test('keeps the measured-facts-first contract in the post-tool answer prompt', () => {
    const prompt = buildIterationPrompt(
      'What is the auction doing here?',
      'market_context: price is above VWAP',
      'Used market_context successfully.',
    );

    expect(prompt).toContain('Measured tool context');
    expect(prompt).toContain('Write measured facts first');
    expect(prompt).toContain('then a short interpretive read');
    expect(prompt).toContain('Add an evidence paragraph only if needed');
    expect(prompt).toContain('If you already have enough measured evidence, answer without additional tool calls');
    expect(prompt).toContain('Do not improvise unsupported concepts');
    expect(prompt).toContain('narrow weak claims instead of sounding more certain');
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
  test('preserves the measured-facts-first final answer contract', () => {
    const prompt = buildFinalAnswerPrompt('What is the read?', 'market_context: balanced session');

    expect(prompt).toContain('Write measured facts first');
    expect(prompt).toContain('then a short interpretive read');
    expect(prompt).toContain('Add an evidence paragraph only if needed');
    expect(prompt).toContain('Do not turn the answer into a signal, prediction, or execution plan');
  });
});

describe('buildSystemPrompt', () => {
  test('uses compact tool descriptions for Kryzov runtime tools', () => {
    const prompt = buildSystemPrompt('gpt-5.2');

    expect(prompt).toContain('market_context: current BTC/USD Hyperliquid session state');
    expect(prompt).toContain('recent_sessions: recent completed BTC/USD Hyperliquid sessions for comparison');
    expect(prompt).toContain('level_response: measured acceptance/rejection analysis for explicit levels or session landmarks');
    expect(prompt).not.toContain('## When to Use');
    expect(prompt).not.toContain('## When NOT to Use');
    expect(prompt).not.toContain('## Usage Notes');
  });
});
