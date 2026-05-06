import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MarketStateService } from '../../market/service.js';
import { formatToolResult } from '../types.js';

export const levelResponseTool = new DynamicStructuredTool({
  name: 'level_response',
  description:
    'Analyze whether BTC/USD on Hyperliquid is accepting or rejecting a session landmark or explicit price level.',
  schema: z.object({
    level: z.number().optional().describe('Explicit price level to evaluate.'),
    reference: z
      .enum([
        'session_open',
        'session_high',
        'session_low',
        'session_vwap',
        'prior_session_high',
        'prior_session_low',
        'prior_session_vwap',
        'opening_range_high',
        'opening_range_low',
        'initial_balance_high',
        'initial_balance_low',
      ])
      .optional()
      .describe('Named session landmark to evaluate when level is omitted.'),
  }),
  func: async ({ level, reference }) => {
    const result = await MarketStateService.getInstance().getLevelResponse({ level, reference });
    return formatToolResult(result);
  },
});
