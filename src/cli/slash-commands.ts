import {
  CombinedAutocompleteProvider,
  type SlashCommand as AutocompleteSlashCommand,
} from '@mariozechner/pi-tui';

export interface SlashCommandContext {
  clear: () => void;
  startModelSelection: () => void;
  showLocalResponse: (query: string, answer: string) => void;
  quit: () => void;
}

export interface SlashCommandDefinition extends AutocompleteSlashCommand {
  allowWhileBusy?: boolean;
  execute: (context: SlashCommandContext, rawQuery: string) => void | Promise<void>;
}

export type SlashCommandDispatchResult = 'handled' | 'not-command' | 'busy';

function buildHelpMessage(commands: SlashCommandDefinition[]): string {
  const lines = ['Available commands:'];
  for (const command of commands) {
    lines.push(`/${command.name} - ${command.description ?? ''}`.trimEnd());
  }
  return lines.join('\n');
}

function buildUnknownCommandMessage(
  name: string,
  commands: SlashCommandDefinition[],
): string {
  return `Unknown command '/${name}'.\n\n${buildHelpMessage(commands)}`;
}

function buildArgumentErrorMessage(
  name: string,
  commands: SlashCommandDefinition[],
): string {
  return `Command '/${name}' does not take arguments.\n\n${buildHelpMessage(commands)}`;
}

function parseSlashCommand(query: string): { name: string; args: string } | null {
  const trimmed = query.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  if (!withoutSlash) {
    return null;
  }

  const firstSpace = withoutSlash.indexOf(' ');
  if (firstSpace === -1) {
    return { name: withoutSlash, args: '' };
  }

  return {
    name: withoutSlash.slice(0, firstSpace),
    args: withoutSlash.slice(firstSpace + 1).trim(),
  };
}

export function createSlashCommandRegistry(
  _context: SlashCommandContext,
): SlashCommandDefinition[] {
  const commands: SlashCommandDefinition[] = [
    {
      name: 'clear',
      description: 'Clear session transcript and context',
      execute: (context) => {
        context.clear();
      },
    },
    {
      name: 'model',
      description: 'Change model or provider',
      execute: (context) => {
        context.startModelSelection();
      },
    },
    {
      name: 'help',
      description: 'Show available commands',
      execute: (context, rawQuery) => {
        context.showLocalResponse(rawQuery, buildHelpMessage(commands));
      },
    },
    {
      name: 'quit',
      description: 'Exit Kryzov',
      allowWhileBusy: true,
      execute: (context) => {
        context.quit();
      },
    },
  ];

  return commands;
}

export function createSlashAutocompleteProvider(
  commands: SlashCommandDefinition[],
  basePath: string = process.cwd(),
): CombinedAutocompleteProvider {
  return new CombinedAutocompleteProvider(commands, basePath);
}

export async function dispatchSlashCommand(params: {
  query: string;
  commands: SlashCommandDefinition[];
  context: SlashCommandContext;
  isBusy: boolean;
}): Promise<SlashCommandDispatchResult> {
  const parsed = parseSlashCommand(params.query);
  if (!parsed) {
    return 'not-command';
  }

  const command = params.commands.find((entry) => entry.name === parsed.name);
  if (params.isBusy && !command?.allowWhileBusy) {
    return 'busy';
  }

  if (!command) {
    params.context.showLocalResponse(
      params.query,
      buildUnknownCommandMessage(parsed.name, params.commands),
    );
    return 'handled';
  }

  if (parsed.args) {
    params.context.showLocalResponse(
      params.query,
      buildArgumentErrorMessage(parsed.name, params.commands),
    );
    return 'handled';
  }

  await command.execute(params.context, params.query);
  return 'handled';
}
