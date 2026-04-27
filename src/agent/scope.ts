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
  /\blong\b/,
  /\bshort\b/,
  /\bentry\b/,
  /\bstop(?:\s+loss)?\b/,
  /\btarget\b/,
  /\bsignal\b/,
  /\bbuy\b/,
  /\bsell\b/,
  /\bexecute\b/,
  /\border\b/,
];

const PORTFOLIO_PATTERNS = [/\bportfolio\b/, /\bholdings\b/, /\bsize\b/, /\ballocation\b/, /\baccount\b/];

function buildRefusal(reason: string): ScopeAssessment {
  return {
    status: 'refused',
    reason,
    response: reason,
  };
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

  if (EXECUTION_PATTERNS.some((pattern) => pattern.test(lowerQuery))) {
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
