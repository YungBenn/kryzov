export interface ScopeAssessment {
  status: 'allowed' | 'refused';
  reason?: string;
  response?: string;
}

const NON_BTC_SYMBOLS = [
  'ETH',
  'SOL',
  'XRP',
  'DOGE',
  'AVAX',
  'BNB',
  'AAPL',
  'TSLA',
  'NVDA',
  'SPY',
];

const EXECUTION_PATTERNS = [
  /\bshould i\b/,
  /\bentry\b/,
  /\bstop(?:\s+loss)?\b/,
  /\btarget\b/,
  /\bsignal\b/,
  /\bbuy\b/,
  /\bsell\b/,
  /\bexecute\b/,
  /\border\b/,
];

const POSITION_INTENT_PATTERNS = [
  /\bshould i\s+(?:go\s+)?long\b/,
  /\bshould i\s+(?:go\s+)?short\b/,
  /\bgo\s+long\b/,
  /\bgo\s+short\b/,
  /\btake\s+a\s+long\b/,
  /\btake\s+a\s+short\b/,
  /\blong\s+btc\b/,
  /\bshort\s+btc\b/,
  /\blong\s+here\b/,
  /\bshort\s+here\b/,
];

const RESPONSE_STYLE_PATTERNS = [
  /\bkeep it short\b/,
  /\bshort and plain\b/,
  /\bshort answer\b/,
  /\blonger answer\b/,
  /\blonger explanation\b/,
  /\blong-form explanation\b/,
  /\bshort\s+(?:btc\s+)?session\s+(?:read|summary|update)\b/,
];

const PORTFOLIO_PATTERNS = [/\bportfolio\b/, /\bholdings\b/, /\bsize\b/, /\ballocation\b/, /\baccount\b/];

function buildRefusal(reason: string): ScopeAssessment {
  return {
    status: 'refused',
    reason,
    response: reason,
  };
}

function hasExecutionIntent(query: string): boolean {
  if (RESPONSE_STYLE_PATTERNS.some((pattern) => pattern.test(query))) {
    return false;
  }

  return (
    EXECUTION_PATTERNS.some((pattern) => pattern.test(query)) ||
    POSITION_INTENT_PATTERNS.some((pattern) => pattern.test(query))
  );
}

export function assessKryzovScope(query: string): ScopeAssessment {
  const upperQuery = query.toUpperCase();
  const lowerQuery = query.toLowerCase();

  if (NON_BTC_SYMBOLS.some((symbol) => new RegExp(`\\b${symbol}\\b`).test(upperQuery))) {
    return buildRefusal(
      'Kryzov is scoped to BTC/USD on Hyperliquid derivatives only, so non-BTC/USD assets are outside scope.',
    );
  }

  if (PORTFOLIO_PATTERNS.some((pattern) => pattern.test(lowerQuery))) {
    return buildRefusal(
      'Kryzov does not handle portfolio or account management, and it does not advise on portfolio sizing.',
    );
  }

  if (hasExecutionIntent(lowerQuery)) {
    return buildRefusal(
      'Kryzov does not provide execution advice, trading signals, or buy/sell recommendations.',
    );
  }

  if (/\bspot\b/.test(lowerQuery) || /\boptions?\b/.test(lowerQuery)) {
    return buildRefusal(
      'Kryzov is limited to Hyperliquid BTC/USD perpetuals and does not cover spot or options.',
    );
  }

  return { status: 'allowed' };
}
