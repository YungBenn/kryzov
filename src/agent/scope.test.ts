import { describe, expect, test } from 'bun:test';
import { assessKryzovScope } from './scope.js';

describe('assessKryzovScope', () => {
  test('allows BTC and Hyperliquid market context requests', () => {
    expect(assessKryzovScope('What is BTC doing on Hyperliquid right now?').status).toBe('allowed');
  });

  test('refuses directional signal requests', () => {
    const result = assessKryzovScope('Should I long BTC here? Give me an entry, stop, and target.');
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
