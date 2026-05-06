import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const volatilityPaceTool = new DynamicStructuredTool({
  name: 'volatility_pace',
  description:
    'Get the current BTC/USD Hyperliquid volatility and activity pace versus recent sessions, including range pace, trade rate, volume pace, and recent realized volatility.',
  schema: z.object({}),
  func: async () => {
    const result = await MarketStateService.getInstance().getVolatilityPace();
    return formatToolResult(result);
  },
});
