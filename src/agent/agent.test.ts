import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AIMessage } from '@langchain/core/messages';
import * as actualLlm from '../model/llm.js';

const llmResponses: Array<{ response: AIMessage | string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }> = [];
const callLlmMock = mock(async () => {
  const next = llmResponses.shift();
  if (!next) {
    throw new Error('No mocked LLM response available');
  }
  return next;
});

let importCounter = 0;

function getCallOptions(callIndex: number): Record<string, unknown> | undefined {
  const call = callLlmMock.mock.calls[callIndex];
  if (!call) {
    return undefined;
  }

  const options = (call as unknown as unknown[])[1];
  return options && typeof options === 'object'
    ? options as Record<string, unknown>
    : undefined;
}

async function loadAgent(toolResult = {
  data: {
    last: 76541,
    sessionVwap: 76870,
    comparison: {
      currentRange: 1664,
      recentAverageRange: 560,
      rangeRatioVsRecentAverage: 2.97,
      rangeComparison: 'wider',
      recentAverageSessionVwap: 77012,
      sessionVwapVsRecentAverage: -347,
      sessionVwapComparison: 'lower',
      currentFlowBias: 'sell',
      recentFlowPattern: 'recent sessions were mostly one-sided',
    },
  },
}) {
  mock.module('../model/llm.js', () => ({
    ...actualLlm,
    callLlm: callLlmMock,
  }));

  mock.module('../tools/registry.js', () => ({
    getTools: () => [
      {
        name: 'market_context',
        async invoke() {
          return JSON.stringify(toolResult);
        },
      },
    ],
    buildToolDescriptions: () => 'market_context: current BTC/USD Hyperliquid session state',
  }));

  importCounter += 1;
  return import(`./agent.js?agent-test=${importCounter}`);
}

describe('Agent', () => {
  const originalThink = process.env.KRYZOV_OLLAMA_THINK;

  beforeEach(() => {
    llmResponses.length = 0;
    callLlmMock.mockClear();
  });

  afterEach(() => {
    llmResponses.length = 0;
    if (originalThink === undefined) {
      delete process.env.KRYZOV_OLLAMA_THINK;
    } else {
      process.env.KRYZOV_OLLAMA_THINK = originalThink;
    }
    mock.restore();
  });

  test('returns the first post-tool textual answer when it already matches the simple default', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'BTC is trading softer than the recent sessions. Price is holding lower and selling has been a bit stronger, so this looks more defensive than the last few days.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('how is the market right now?')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('BTC is trading softer than the recent sessions. Price is holding lower and selling has been a bit stronger, so this looks more defensive than the last few days.');
    expect(done?.toolCalls).toEqual([
      {
        tool: 'market_context',
        args: {},
        result: JSON.stringify({
          data: {
            last: 76541,
            sessionVwap: 76870,
            comparison: {
              currentRange: 1664,
              recentAverageRange: 560,
              rangeRatioVsRecentAverage: 2.97,
              rangeComparison: 'wider',
              recentAverageSessionVwap: 77012,
              sessionVwapVsRecentAverage: -347,
              sessionVwapComparison: 'lower',
              currentFlowBias: 'sell',
              recentFlowPattern: 'recent sessions were mostly one-sided',
            },
          },
        }),
      },
    ]);
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  test('keeps tool calls empty for true no-tool direct responses', async () => {
    llmResponses.push({
      response: 'No tool call needed.',
    });

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('hello')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('No tool call needed.');
    expect(done?.toolCalls).toEqual([]);
    expect(callLlmMock).toHaveBeenCalledTimes(1);
  });

  test('falls back to final answer generation when the post-tool response is empty', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: '',
      },
      {
        response: 'Fallback final answer.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('how is the market right now?')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('Fallback final answer.');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  test('falls back to final answer generation after max iterations', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-2',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'Reached maximum iterations fallback.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 2 });
    const events = [];

    for await (const event of agent.run('how is the market right now?')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('Reached maximum iterations fallback.');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  test('rewrites long technical answers into the simple default style', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: `Measured facts
- Session VWAP is lower than the recent average.
- Cumulative delta is slightly negative.

Interpretive read
This reads as responsive defense with more balanced aggression than the prior sessions.`,
      },
      {
        response: 'BTC is trading lower than the last few sessions, and today\'s flow is more balanced.\n\nSo far this reads more responsive than initiative, with less one-sided pressure than the earlier sessions.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('compare the current session to the last 5 sessions and explain the divergence')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('BTC is trading lower than the last few sessions, and today\'s flow is more balanced.\n\nSo far this reads more responsive than initiative, with less one-sided pressure than the earlier sessions.');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  test('rewrites contradictory comparison drafts using normalized comparison context', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'The current session has a much smaller range than recent days and still shows a mild buyer edge.\n\nEvidence is based on the available session data.',
      },
      {
        response: 'The current session is lower in price and more balanced than the recent sessions.\n\nSo far this reads more responsive than initiative, with less one-sided pressure even though sellers still have a small edge today.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('compare the current session to the last 5 sessions and explain the divergence')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('The current session is lower in price and more balanced than the recent sessions.\n\nSo far this reads more responsive than initiative, with less one-sided pressure even though sellers still have a small edge today.');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  test('rewrites generic explainer comparison answers into compact researcher style', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'In simple terms, the market is reacting rather than moving strongly in one direction. It is less extreme than the earlier sessions.',
      },
      {
        response: 'The current session is lower and more balanced than the recent sessions. It is no longer as one-sided as the earlier days, so far this reads more responsive than initiative.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('compare the current session to the last 5 sessions and explain the divergence')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('The current session is lower and more balanced than the recent sessions. It is no longer as one-sided as the earlier days, so far this reads more responsive than initiative.');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  test('rewrites dense numeric comparison blocks into adaptive terminal-readable answers', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'Today\'s BTC/USD session is about 1,450 points below the 5-day average, its range is 3.15x wider, and buying and selling are almost balanced. These conditions indicate a shift from prior one-sided sessions and a move toward equilibrium.',
      },
      {
        response: 'The current session is lower and more balanced than the recent sessions.\n\nPrice is not moving with the same one-sided pressure as the earlier days. So far this reads calmer and more responsive than aggressive.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('compare the current session to the last 5 sessions and explain the divergence')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('The current session is lower and more balanced than the recent sessions.\n\nPrice is not moving with the same one-sided pressure as the earlier days. So far this reads calmer and more responsive than aggressive.');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  test('keeps longer clear comparison answers without forcing a template rewrite', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'The current session is lower and more balanced than the recent sessions.\n\nSelling still has a small edge, but the market is not moving with the same one-sided pressure seen earlier. So far this looks calmer and less aggressive overall.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('compare the current session to the last 5 sessions and explain the divergence')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toBe('The current session is lower and more balanced than the recent sessions.\n\nSelling still has a small edge, but the market is not moving with the same one-sided pressure seen earlier. So far this looks calmer and less aggressive overall.');
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  test('keeps explicit evidence answers without forcing the simple rewrite', async () => {
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: `Measured facts
- Range is 3x the recent average.
- Session average price is lower than the prior five-session average.
- Net buying versus selling is slightly negative.`,
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });
    const events = [];

    for await (const event of agent.run('compare the current session to the last 5 sessions and show the measured facts')) {
      events.push(event);
    }

    const done = events.find((event) => event.type === 'done');

    expect(done?.type).toBe('done');
    expect(done?.answer).toContain('Measured facts');
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  test('passes the same resolved ollama think override to every call in an auto-mode run', async () => {
    process.env.KRYZOV_OLLAMA_THINK = 'auto';
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'BTC is trading quietly right now. Price is staying near the session average and nothing here suggests a strong push yet.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'ollama:qwen3.5:9b', maxIterations: 3 });

    for await (const _event of agent.run('how is the market right now?')) {
      // consume
    }

    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(getCallOptions(0)).toMatchObject({ ollamaThink: false });
    expect(getCallOptions(1)).toMatchObject({ ollamaThink: false });
  });

  test('resolves simple GPT-OSS auto-mode runs to low for every call', async () => {
    process.env.KRYZOV_OLLAMA_THINK = 'auto';
    llmResponses.push(
      {
        response: new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'market_context',
              args: {},
            },
          ],
        }),
      },
      {
        response: 'BTC is trading quietly right now. Price is staying near the session average and nothing here suggests a strong push yet.',
      },
    );

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'ollama:gpt-oss:20b', maxIterations: 3 });

    for await (const _event of agent.run('how is the market right now?')) {
      // consume
    }

    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(getCallOptions(0)).toMatchObject({ ollamaThink: 'low' });
    expect(getCallOptions(1)).toMatchObject({ ollamaThink: 'low' });
  });

  test('does not pass an ollama think override for non-ollama models', async () => {
    process.env.KRYZOV_OLLAMA_THINK = 'auto';
    llmResponses.push({
      response: 'No tool call needed.',
    });

    const { Agent } = await loadAgent();
    const agent = Agent.create({ model: 'gpt-5.2', maxIterations: 3 });

    for await (const _event of agent.run('hello')) {
      // consume
    }

    expect(callLlmMock).toHaveBeenCalledTimes(1);
    expect(getCallOptions(0)?.ollamaThink).toBeUndefined();
  });
});
