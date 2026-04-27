import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const recentSessionsTool = new DynamicStructuredTool({
  name: 'recent_sessions',
  description:
    'Get the last 7 completed BTC/USD Hyperliquid UTC sessions plus compact comparison context against the live session.',
  schema: z.object({
    limit: z.number().int().min(1).max(7).default(7).optional(),
  }),
  func: async ({ limit }) => {
    const result = await MarketStateService.getInstance().getRecentSessions(limit ?? 7);
    return formatToolResult(result);
  },
});
