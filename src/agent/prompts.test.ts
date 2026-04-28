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
  test('keeps follow-up reasoning inside Kryzov scope and discourages unnecessary tool use', () => {
    const prompt = buildIterationPrompt(
      'What is the auction doing here?',
      'market_context: price is above VWAP',
      'Used market_context successfully.',
    );

    expect(prompt).toContain('Measured tool context');
    expect(prompt).toContain('If you already have enough measured evidence, answer without additional tool calls');
    expect(prompt).toContain('Do not improvise unsupported concepts');
    expect(prompt).toContain('Narrow weak claims instead of sounding more certain');
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
