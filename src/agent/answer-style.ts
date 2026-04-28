export type AnswerMode = 'simple' | 'evidence';
export type RangeComparison = 'wider' | 'narrower' | 'similar';
export type PriceComparison = 'higher' | 'lower' | 'similar';
export type FlowBias = 'buy' | 'sell' | 'balanced';

export interface ComparisonRewriteContext {
  rangeComparison?: RangeComparison | null;
  sessionVwapComparison?: PriceComparison | null;
  currentFlowBias?: FlowBias | null;
  plainComparison?: {
    takeaway?: string | null;
    price?: string | null;
    range?: string | null;
    flow?: string | null;
  } | null;
}

const EVIDENCE_REQUEST_PATTERNS = [
  /\bmeasured facts?\b/i,
  /\bshow (?:me )?(?:the )?facts?\b/i,
  /\bshow (?:me )?(?:the )?evidence\b/i,
  /\bwith (?:the )?evidence\b/i,
  /\bgive me (?:the )?(?:numbers|metrics|data)\b/i,
  /\bexact numbers?\b/i,
  /\braw data\b/i,
  /\bback it up\b/i,
  /\bquantif(?:y|ied)\b/i,
];

const COMPARISON_QUERY_PATTERNS = [
  /\bcompare\b/i,
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\bdivergence\b/i,
  /\bdifference\b/i,
  /\brelative to\b/i,
];

const SIMPLE_MODE_JARGON_PATTERNS = [
  /\bmeasured facts?\b/i,
  /\binterpretive read\b/i,
  /\bVWAP\b/,
  /\bcumulative delta\b/i,
  /\baggression\b/i,
  /\bauction behavior\b/i,
  /\borderflow\b/i,
];

const RAW_LABEL_PATTERNS = [
  /\bfailed auction\b/i,
  /\bresponsive[- ]defense\b/i,
  /\binitiative continuation\b/i,
  /\bbalance-to-imbalance shift\b/i,
];

const EVIDENCE_FOOTER_PATTERN = /\bEvidence is based on the available session data\b/i;
const GENERIC_EXPLAINER_PATTERNS = [
  /\bIn simple terms\b/i,
  /\bbasically\b/i,
  /\bthe market is reacting rather than moving strongly in one direction\b/i,
  /\bthis means the market\b/i,
];
const ACADEMIC_SUMMARY_PATTERNS = [
  /\bthese conditions indicate\b/i,
  /\bmove toward equilibrium\b/i,
  /\bshift from prior\b/i,
  /\bindicate a shift\b/i,
];
const REPORT_STYLE_OPENING_PATTERNS = [
  /\babout\s+\$?\d[\d,.]*\s+points?\s+(?:below|above)\b/i,
  /\b\d[\d,.]*x\s+(?:wider|narrower)\b/i,
];
const ROBOTIC_SUMMARY_PATTERNS = [
  /\bsuggests a retreat from\b/i,
  /\bshift from recent aggressive bias\b/i,
  /\bcalmer,\s+balanced state\b/i,
];

export function resolveAnswerMode(query: string): AnswerMode {
  return EVIDENCE_REQUEST_PATTERNS.some((pattern) => pattern.test(query)) ? 'evidence' : 'simple';
}

export function isComparisonQuery(query: string): boolean {
  return COMPARISON_QUERY_PATTERNS.some((pattern) => pattern.test(query));
}

function countNumericMentions(text: string): number {
  return text.match(/\b\d[\d,.\-x%]*\b/g)?.length ?? 0;
}

function getSentenceCount(text: string): number {
  return text
    .split(/[.?!]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function getBulletLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line));
}

function hasComparisonContradiction(
  answer: string,
  comparison?: ComparisonRewriteContext | null,
): boolean {
  if (!comparison) {
    return false;
  }

  const saysSmaller = /\b(smaller|tighter)\b/i.test(answer);
  const saysLarger = /\b(wider|larger|broader)\b/i.test(answer);
  const saysBuyerEdge = /\b(buyer edge|buyers? (?:lead|led|leading|stronger|in control))\b/i.test(answer);
  const saysSellerEdge = /\b(seller edge|sellers? (?:lead|led|leading|stronger|in control))\b/i.test(answer);
  const saysHigherPrice = /\b(higher in price|higher average price|higher session average price)\b/i.test(answer);
  const saysLowerPrice = /\b(lower in price|lower average price|lower session average price)\b/i.test(answer);

  if (comparison.rangeComparison === 'wider' && saysSmaller) {
    return true;
  }

  if (comparison.rangeComparison === 'narrower' && saysLarger) {
    return true;
  }

  if (comparison.currentFlowBias === 'sell' && saysBuyerEdge) {
    return true;
  }

  if (comparison.currentFlowBias === 'buy' && saysSellerEdge) {
    return true;
  }

  if (comparison.sessionVwapComparison === 'lower' && saysHigherPrice) {
    return true;
  }

  if (comparison.sessionVwapComparison === 'higher' && saysLowerPrice) {
    return true;
  }

  return false;
}

export function shouldRewriteAnswer(
  answer: string,
  mode: AnswerMode,
  options?: { query?: string; comparison?: ComparisonRewriteContext | null },
): boolean {
  if (mode !== 'simple') {
    return false;
  }

  const normalized = answer.trim();
  if (!normalized) {
    return false;
  }

  const comparisonQuery = isComparisonQuery(options?.query ?? '');
  const hasHeaders = /(^|\n)\s*(Measured facts|Interpretive read)\b/i.test(normalized);
  const bulletLines = getBulletLines(normalized);
  const hasBullets = bulletLines.length > 0;
  const paragraphs = normalized.split(/\n\s*\n/).filter(Boolean);
  const sentenceCount = getSentenceCount(normalized);
  const hasTooManyParagraphs = paragraphs.length > 3;
  const hasDenseJargon =
    SIMPLE_MODE_JARGON_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    RAW_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasEvidenceFooter = EVIDENCE_FOOTER_PATTERN.test(normalized);
  const hasGenericExplainerTone = GENERIC_EXPLAINER_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasAcademicSummaryTone = ACADEMIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasReportStyleOpening = REPORT_STYLE_OPENING_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasRoboticSummaryTone = ROBOTIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasTooManyMetrics = comparisonQuery && countNumericMentions(normalized) > 2;
  const hasContradiction = comparisonQuery && hasComparisonContradiction(normalized, options?.comparison);
  const hasDenseBulletDump =
    hasBullets &&
    (bulletLines.length > 3 ||
      bulletLines.some((line) => line.length > 90) ||
      bulletLines.some((line) => countNumericMentions(line) > 1) ||
      bulletLines.some((line) => SIMPLE_MODE_JARGON_PATTERNS.some((pattern) => pattern.test(line))));
  const hasDenseComparisonBlock =
    comparisonQuery &&
    !hasBullets &&
    ((paragraphs.length === 1 && (sentenceCount > 2 || normalized.length > 220)) ||
      /,\s+[^.?!]+,\s+[^.?!]+,\s+/.test(normalized));

  return (
    hasHeaders ||
    hasDenseBulletDump ||
    hasTooManyParagraphs ||
    hasDenseJargon ||
    hasEvidenceFooter ||
    hasGenericExplainerTone ||
    hasAcademicSummaryTone ||
    hasRoboticSummaryTone ||
    hasReportStyleOpening ||
    hasDenseComparisonBlock ||
    hasTooManyMetrics ||
    hasContradiction
  );
}
