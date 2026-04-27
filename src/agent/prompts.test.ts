import { describe, expect, test } from 'bun:test';
import { buildSystemPrompt } from './prompts.js';

describe('buildSystemPrompt', () => {
  test('uses Kryzov identity and excludes Dexter finance instructions', () => {
    const prompt = buildSystemPrompt('gpt-5.2');

    expect(prompt).toContain('You are Kryzov');
    expect(prompt).toContain('BTC/USD');
    expect(prompt).toContain('Hyperliquid');
    expect(prompt).not.toContain('financial_search');
    expect(prompt).not.toContain('read_filings');
    expect(prompt).not.toContain('You are Dexter');
  });
});
