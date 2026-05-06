import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const flowEventsTool = new DynamicStructuredTool({
  name: 'flow_events',
  description:
    'Get recent deterministic BTC/USD Hyperliquid flow events such as sweeps, failed breakouts, failed breakdowns, VWAP reclaims/losses, and absorption reads.',
  schema: z.object({
    limit: z.number().int().min(1).max(8).default(5).optional(),
  }),
  func: async ({ limit }) => {
    const result = await MarketStateService.getInstance().getFlowEvents(limit ?? 5);
    return formatToolResult(result);
  },
});
