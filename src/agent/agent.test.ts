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

async function loadAgent() {
  mock.module('../model/llm.js', () => ({
    ...actualLlm,
    callLlm: callLlmMock,
  }));

  mock.module('../tools/registry.js', () => ({
    getTools: () => [
      {
        name: 'market_context',
        async invoke() {
          return JSON.stringify({ data: { last: 76541, sessionVwap: 76870 } });
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

  test('returns the first post-tool textual answer without a rewrite pass', async () => {
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
        response: 'Measured facts first.\n\nInterpretive read second.',
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
    expect(done?.answer).toBe('Measured facts first.\n\nInterpretive read second.');
    expect(done?.toolCalls).toEqual([
      {
        tool: 'market_context',
        args: {},
        result: JSON.stringify({ data: { last: 76541, sessionVwap: 76870 } }),
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
        response: 'Measured facts first.\n\nInterpretive read second.',
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
        response: 'Measured facts first.\n\nInterpretive read second.',
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
