import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const referenceMapTool = new DynamicStructuredTool({
  name: 'reference_map',
  description:
    'Get ranked BTC/USD Hyperliquid session, prior-session, and intraday references that matter most right now.',
  schema: z.object({
    limit: z.number().int().min(1).max(12).default(8).optional(),
  }),
  func: async ({ limit }) => {
    const result = await MarketStateService.getInstance().getReferenceMap(limit ?? 8);
    return formatToolResult(result);
  },
});
