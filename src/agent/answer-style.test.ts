import { describe, expect, test } from 'bun:test';
import { isComparisonQuery, resolveAnswerMode, shouldRewriteAnswer } from './answer-style.js';

describe('isComparisonQuery', () => {
  test('detects comparison and divergence prompts', () => {
    expect(isComparisonQuery('compare the current session to the last 5 sessions and explain the divergence')).toBe(true);
    expect(isComparisonQuery('what is the difference versus the last session?')).toBe(true);
    expect(isComparisonQuery('how is the market right now?')).toBe(false);
  });
});

describe('resolveAnswerMode', () => {
  test('defaults to simple mode for normal market questions', () => {
    expect(resolveAnswerMode('compare the current session to the last 5 sessions and explain the divergence')).toBe('simple');
  });

  test('switches to evidence mode only for explicit evidence requests', () => {
    expect(resolveAnswerMode('compare the current session to the last 5 sessions and show the measured facts')).toBe('evidence');
    expect(resolveAnswerMode('give me the numbers and evidence behind this move')).toBe('evidence');
  });
});

describe('shouldRewriteAnswer', () => {
  test('rewrites technical header-heavy answers in simple mode', () => {
    const answer = `Measured facts
- Range is 3x the recent average.
- VWAP is lower and cumulative delta is negative.

Interpretive read
This reads as responsive defense with balanced aggression.`;

    expect(shouldRewriteAnswer(answer, 'simple')).toBe(true);
  });

  test('does not rewrite a longer plain-language answer just for being longer', () => {
    const answer = 'BTC is weaker than the last few sessions. Price has spent most of the session holding below where it traded recently, and each bounce has looked limited rather than strong. Selling has had a small edge over buying, which is why the tone feels cautious instead of confident. That does not mean the market has broken down in a dramatic way, but it does mean this session has less upward energy than the recent ones. The simplest read is that traders are reacting defensively rather than pushing price higher with conviction.';

    expect(shouldRewriteAnswer(answer, 'simple')).toBe(false);
  });

  test('keeps two short comparison paragraphs for terminal readability', () => {
    const answer = `BTC is trading lower than the recent sessions, and flow is more balanced today.

So far this reads less one-sided and more responsive than the earlier sessions.`;

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
      }),
    ).toBe(false);
  });

  test('keeps one clear comparison paragraph when it is easy to understand', () => {
    const answer = 'The current session is lower and more balanced than the recent sessions. Selling has had a small edge, so far this looks calmer and less one-sided than the earlier days.';

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
      }),
    ).toBe(false);
  });

  test('rewrites dense single-block comparison answers in simple mode', () => {
    const answer = 'BTC is quieter than the recent sessions, price is lower and selling has had a small edge today, while the range is wider and the flow is less one-sided than the earlier sessions, which makes the whole session look more balanced than the prior one-way days.';

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
      }),
    ).toBe(true);
  });

  test('keeps short bullets when they improve multi-point clarity', () => {
    const answer = `The session looks calmer than the recent ones:
- price is lower
- flow is more balanced
- buyers are not driving the same one-sided push`;

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
      }),
    ).toBe(false);
  });

  test('rewrites contradictory comparison wording against normalized signals', () => {
    const answer = 'The current session has a smaller range than recent days and still shows a mild buyer edge.';

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
        comparison: {
          rangeComparison: 'wider',
          currentFlowBias: 'sell',
          sessionVwapComparison: 'lower',
        },
      }),
    ).toBe(true);
  });

  test('rewrites generic explainer phrasing in simple mode', () => {
    const answer = 'In simple terms, the market is reacting rather than moving strongly in one direction.';

    expect(shouldRewriteAnswer(answer, 'simple')).toBe(true);
  });

  test('rewrites report-style numeric openings in comparison answers', () => {
    const answer = 'Today\'s BTC/USD session is about 1,450 points below the 5-day average, its range is 3.15x wider, and buying and selling are almost balanced.';

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
      }),
    ).toBe(true);
  });

  test('rewrites academic summary language in comparison answers', () => {
    const answer = 'These conditions indicate a shift from prior one-sided sessions and a move toward equilibrium.';

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
      }),
    ).toBe(true);
  });

  test('keeps compact researcher style answers unchanged', () => {
    const answer = `BTC is trading lower than the last five sessions, and today's flow is much more balanced.

So far this reads more responsive than initiative, with less one-sided pressure than the earlier sessions.`;

    expect(
      shouldRewriteAnswer(answer, 'simple', {
        query: 'compare the current session to the last 5 sessions and explain the divergence',
      }),
    ).toBe(false);
  });

  test('does not force a rewrite for evidence mode formatting alone', () => {
    const answer = `Measured facts
- Range is 3x the recent average.
- Session average price is lower.`;

    expect(shouldRewriteAnswer(answer, 'evidence')).toBe(false);
  });
});
