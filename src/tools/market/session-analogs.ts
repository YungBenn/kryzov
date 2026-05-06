import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const sessionAnalogsTool = new DynamicStructuredTool({
  name: 'session_analogs',
  description:
    'Get the most similar recent BTC/USD Hyperliquid sessions so far using measured session structure, pace, aggression, and positioning features.',
  schema: z.object({
    limit: z.number().int().min(1).max(5).default(3).optional(),
  }),
  func: async ({ limit }) => {
    const result = await MarketStateService.getInstance().getSessionAnalogs(limit ?? 3);
    return formatToolResult(result);
  },
});
