---
name: session-read
description: Produces a measured BTC/USD Hyperliquid session read with facts first, interpretation second, and evidence only when needed.
---

# Kryzov Session Read

Use this skill only for BTC/USD on Hyperliquid derivatives.

## Workflow

1. Call `market_context` to gather the live session state.
2. Call `recent_sessions` if the user asks for recent-history comparison or if the live read needs context.
3. Call `level_response` only when the user asks about acceptance or rejection around a level.

## Output Rules

- Lead with measured facts.
- Follow with a short interpretive read using soft phrasing.
- Do not give execution advice, predictions, or portfolio guidance.
- If the evidence is thin, say so directly.
