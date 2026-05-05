import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const sessionProfileTool = new DynamicStructuredTool({
  name: 'session_profile',
  description:
    'Get the computed BTC/USD Hyperliquid session structure including current state, directional bias, transition signal, confidence, and brief measured evidence.',
  schema: z.object({}),
  func: async () => {
    const snapshot = await MarketStateService.getInstance().getSessionProfile();
    return formatToolResult(snapshot);
  },
});
