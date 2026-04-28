export const THINKING_VERBS = [
  'Analyzing',
  'Assessing',
  'Calculating',
  'Calibrating',
  'Checking',
  'Comparing',
  'Confirming',
  'Evaluating',
  'Examining',
  'Думаю',
  'Hypothesizing',
  'Inspecting',
  'Interpreting',
  'Mapping',
  'Measuring',
  'Наблюдаю',
  'Observing',
  'Parsing',
  'Проверяю',
  'Quantifying',
  'Reading',
  'Reviewing',
  'Scanning',
  'Studying',
  'Synthesizing',
  'Testing',
  'Tracking',
  'Triangulating',
  'Validating',
  'Verifying',
  'Weighing'
] as const;

export function getRandomThinkingVerb(): string {
  return THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
}
