import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const orderBookStateTool = new DynamicStructuredTool({
  name: 'order_book_state',
  description:
    'Get the current BTC/USD Hyperliquid order book state including spread, imbalance, near-price depth, liquidity walls, sweep estimates, and recent book changes.',
  schema: z.object({}),
  func: async () => {
    const result = await MarketStateService.getInstance().getOrderBookState();
    return formatToolResult(result);
  },
});
