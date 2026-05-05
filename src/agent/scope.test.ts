import { describe, expect, test } from 'bun:test';
import { assessKryzovScope } from './scope.js';

describe('assessKryzovScope', () => {
  test('allows BTC and Hyperliquid market context requests', () => {
    expect(assessKryzovScope('What is BTC doing on Hyperliquid right now?').status).toBe('allowed');
  });

  test('allows short answer-style wording for BTC session reads', () => {
    expect(
      assessKryzovScope(
        'What kind of BTC session is this right now on Hyperliquid? Keep it short and plain.',
      ).status,
    ).toBe('allowed');
    expect(assessKryzovScope('Give me a short BTC session read.').status).toBe('allowed');
    expect(assessKryzovScope('Give me a longer explanation of the current BTC session.').status).toBe(
      'allowed',
    );
  });

  test('refuses directional signal requests', () => {
    const result = assessKryzovScope('Should I long BTC here? Give me an entry, stop, and target.');
    expect(result.status).toBe('refused');
    expect(result.reason).toContain('execution');
  });

  test('refuses contextual long and short trade-intent requests', () => {
    expect(assessKryzovScope('Should I short BTC here?').status).toBe('refused');
    expect(assessKryzovScope('I want to go long BTC on Hyperliquid.').status).toBe('refused');
    expect(assessKryzovScope('Take a short in BTC here.').status).toBe('refused');
  });

  test('still refuses execution requests that happen to include short wording', () => {
    const result = assessKryzovScope('Give me a short entry and stop.');
    expect(result.status).toBe('refused');
    expect(result.reason).toContain('execution');
  });

  test('refuses non-BTC assets', () => {
    const result = assessKryzovScope('What is ETH doing on Hyperliquid today?');
    expect(result.status).toBe('refused');
    expect(result.reason).toContain('BTC/USD');
  });

  test('refuses portfolio and account management requests', () => {
    const result = assessKryzovScope('Review my portfolio and tell me how to size this trade.');
    expect(result.status).toBe('refused');
    expect(result.reason).toContain('portfolio');
  });
});
