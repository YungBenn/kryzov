---
name: session-read
description: Produces a clear BTC/USD Hyperliquid session read that stays terminal-friendly, grounded, and only as long as needed.
---

# Kryzov Session Read

Use this skill only for BTC/USD on Hyperliquid derivatives.

## Workflow

1. Call `market_context` to gather the live session state.
2. Call `recent_sessions` if the user asks for recent-history comparison or if the live read needs context.
3. Call `level_response` only when the user asks about acceptance or rejection around a level.

## Output Rules

- Default to Compact Researcher style.
- Start with the clearest main answer and keep measured facts first in substance.
- Explain only as much as needed for the user to understand the read.
- Keep the answer short, serious, and trader-readable under live conditions.
- Use plain phrasing first, then Kryzov-native labels only when they add precision.
- Prefer relative facts such as lower, higher, wider, narrower, more balanced, or more one-sided.
- Use exact numbers only when they materially improve clarity or when the user explicitly asks for evidence or numbers.
- Use one short paragraph, two short paragraphs, or up to three short blocks when the explanation genuinely needs it.
- Use blank lines when they improve terminal scanability.
- Bullets are optional only when they clearly improve multi-point clarity.
- Avoid report-style openings, metric dumps, evidence footers, generic explainer tone, and robotic summary wording.
- Do not give execution advice, predictions, or portfolio guidance.
- If the evidence is thin, say so directly.
