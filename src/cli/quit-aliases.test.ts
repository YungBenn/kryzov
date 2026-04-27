import { describe, expect, test } from 'bun:test';
import { isQuitAlias } from './quit-aliases.js';

describe('isQuitAlias', () => {
  test('accepts existing quit aliases and :q', () => {
    expect(isQuitAlias('quit')).toBe(true);
    expect(isQuitAlias('exit')).toBe(true);
    expect(isQuitAlias(':q')).toBe(true);
  });

  test('accepts :q with surrounding whitespace', () => {
    expect(isQuitAlias('  :q  ')).toBe(true);
  });

  test('does not treat unrelated inputs as quit aliases', () => {
    expect(isQuitAlias('/quit')).toBe(false);
    expect(isQuitAlias(':quit')).toBe(false);
    expect(isQuitAlias('q')).toBe(false);
    expect(isQuitAlias('how is btc?')).toBe(false);
  });
});
