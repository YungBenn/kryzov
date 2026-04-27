import { describe, expect, test } from 'bun:test';
import {
  createSlashAutocompleteProvider,
  createSlashCommandRegistry,
  dispatchSlashCommand,
} from './slash-commands.js';

function createHarness() {
  const calls = {
    model: 0,
    quit: 0,
    responses: [] as Array<{ query: string; answer: string }>,
  };

  const context = {
    startModelSelection: () => {
      calls.model += 1;
    },
    showLocalResponse: (query: string, answer: string) => {
      calls.responses.push({ query, answer });
    },
    quit: () => {
      calls.quit += 1;
    },
  };

  const commands = createSlashCommandRegistry(context);
  const provider = createSlashAutocompleteProvider(commands);

  return { calls, context, commands, provider };
}

describe('slash commands', () => {
  test('/model dispatches to the model selection flow', async () => {
    const { calls, commands, context } = createHarness();

    const result = await dispatchSlashCommand({
      query: '/model',
      commands,
      context,
      isBusy: false,
    });

    expect(result).toBe('handled');
    expect(calls.model).toBe(1);
    expect(calls.responses).toHaveLength(0);
  });

  test('/help returns a local help response', async () => {
    const { calls, commands, context } = createHarness();

    const result = await dispatchSlashCommand({
      query: '/help',
      commands,
      context,
      isBusy: false,
    });

    expect(result).toBe('handled');
    expect(calls.model).toBe(0);
    expect(calls.quit).toBe(0);
    expect(calls.responses).toHaveLength(1);
    expect(calls.responses[0]?.answer).toContain('Available commands:');
    expect(calls.responses[0]?.answer).toContain('/model - Change model or provider');
  });

  test('/quit routes to the quit callback', async () => {
    const { calls, commands, context } = createHarness();

    const result = await dispatchSlashCommand({
      query: '/quit',
      commands,
      context,
      isBusy: true,
    });

    expect(result).toBe('handled');
    expect(calls.quit).toBe(1);
  });

  test('unknown commands return a local response', async () => {
    const { calls, commands, context } = createHarness();

    const result = await dispatchSlashCommand({
      query: '/unknown',
      commands,
      context,
      isBusy: false,
    });

    expect(result).toBe('handled');
    expect(calls.responses).toHaveLength(1);
    expect(calls.responses[0]?.answer).toContain("Unknown command '/unknown'.");
  });

  test('busy state blocks non-exempt slash commands', async () => {
    const { calls, commands, context } = createHarness();

    const result = await dispatchSlashCommand({
      query: '/help',
      commands,
      context,
      isBusy: true,
    });

    expect(result).toBe('busy');
    expect(calls.responses).toHaveLength(0);
  });

  test('slash autocomplete suggests all commands for a bare slash', () => {
    const { provider } = createHarness();

    const suggestions = provider.getSuggestions(['/'], 0, 1);

    expect(suggestions?.items.map((item) => item.value)).toEqual([
      'model',
      'help',
      'quit',
    ]);
  });

  test('slash autocomplete filters command names', () => {
    const { provider } = createHarness();

    const suggestions = provider.getSuggestions(['/mo'], 0, 3);

    expect(suggestions?.items.map((item) => item.value)).toEqual(['model']);
  });

  test('selecting a slash suggestion inserts the command into the input', () => {
    const { provider } = createHarness();

    const suggestions = provider.getSuggestions(['/'], 0, 1);
    const model = suggestions?.items.find((item) => item.value === 'model');

    expect(model).toBeDefined();

    const completed = provider.applyCompletion(['/'], 0, 1, model!, '/');
    expect(completed.lines[0]).toBe('/model ');
    expect(completed.cursorCol).toBe('/model '.length);
  });
});
