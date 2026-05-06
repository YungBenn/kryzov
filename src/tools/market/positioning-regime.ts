import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const positioningRegimeTool = new DynamicStructuredTool({
  name: 'positioning_regime',
  description:
    'Get the current BTC/USD Hyperliquid positioning regime using asset-context history such as price, open interest, funding, and premium path.',
  schema: z.object({}),
  func: async () => {
    const result = await MarketStateService.getInstance().getPositioningRegime();
    return formatToolResult(result);
  },
});
