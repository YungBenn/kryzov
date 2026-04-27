import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const marketContextTool = new DynamicStructuredTool({
  name: 'market_context',
  description:
    'Get the current BTC/USD Hyperliquid market context including session state, VWAPs, cumulative delta, aggression split, active asset context, and bounded interpretive read.',
  schema: z.object({}),
  func: async () => {
    const snapshot = await MarketStateService.getInstance().getMarketContext();
    return formatToolResult(snapshot);
  },
});
