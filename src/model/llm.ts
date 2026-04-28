import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StructuredToolInterface } from '@langchain/core/tools';
import { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';
import { DEFAULT_SYSTEM_PROMPT } from '@/agent/prompts';
import type { TokenUsage } from '@/agent/types';
import { logger } from '@/utils';
import { resolveProvider, getProviderById } from '@/providers';
import {
  createKryzovChatOllama,
  getOllamaThinkCapability,
  validateOllamaThinkForModel,
} from './ollama-compat.js';
import type {
  KryzovChatOllamaInput,
  OllamaConfiguredThinkSetting,
  OllamaThinkSetting,
} from './ollama-compat.js';

export const DEFAULT_PROVIDER = 'openai';
export const DEFAULT_MODEL = 'gpt-5.2';

/**
 * Gets the fast model variant for the given provider.
 * Falls back to the provided model if no fast variant is configured (e.g., Ollama).
 */
export function getFastModel(modelProvider: string, fallbackModel: string): string {
  return getProviderById(modelProvider)?.fastModel ?? fallbackModel;
}

// Generic retry helper with exponential backoff
async function withRetry<T>(fn: () => Promise<T>, provider: string, maxAttempts = 3): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`[${provider} API] error (attempt ${attempt + 1}/${maxAttempts}): ${message}`);

      if (attempt === maxAttempts - 1) {
        throw new Error(`[${provider} API] ${message}`);
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error('Unreachable');
}

// Model provider configuration
interface ModelOpts {
  streaming: boolean;
  ollamaThink?: OllamaThinkSetting;
}

type ModelFactory = (name: string, opts: ModelOpts) => BaseChatModel;

function getApiKey(envVar: string): string {
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`[LLM] ${envVar} not found in environment variables`);
  }
  return apiKey;
}

function getConfiguredOllamaThinkSetting(): OllamaConfiguredThinkSetting {
  const raw = process.env.KRYZOV_OLLAMA_THINK?.trim().toLowerCase();

  switch (raw) {
    case 'auto':
      return 'auto';
    case 'true':
      return true;
    case 'low':
    case 'medium':
    case 'high':
      return raw;
    case 'false':
    case undefined:
    case '':
      return false;
    default:
      return false;
  }
}

function getEffectiveOllamaThinkSetting(override?: OllamaThinkSetting): OllamaThinkSetting {
  if (override !== undefined) {
    return override;
  }

  const configured = getConfiguredOllamaThinkSetting();
  if (configured === 'auto') {
    return false;
  }

  return configured;
}

function resolveOllamaThinkSetting(
  modelName: string,
  override?: OllamaThinkSetting,
): OllamaThinkSetting {
  const effectiveThink = getEffectiveOllamaThinkSetting(override);
  validateOllamaThinkForModel(modelName, effectiveThink);
  return effectiveThink;
}

// Factories keyed by provider id — prefix routing is handled by resolveProvider()
const MODEL_FACTORIES: Record<string, ModelFactory> = {
  anthropic: (name, opts) =>
    new ChatAnthropic({
      model: name,
      ...opts,
      apiKey: getApiKey('ANTHROPIC_API_KEY'),
    }),
  google: (name, opts) =>
    new ChatGoogleGenerativeAI({
      model: name,
      ...opts,
      apiKey: getApiKey('GOOGLE_API_KEY'),
    }),
  xai: (name, opts) =>
    new ChatOpenAI({
      model: name,
      ...opts,
      apiKey: getApiKey('XAI_API_KEY'),
      configuration: {
        baseURL: 'https://api.x.ai/v1',
      },
    }),
  openrouter: (name, opts) =>
    new ChatOpenAI({
      model: name.replace(/^openrouter:/, ''),
      ...opts,
      apiKey: getApiKey('OPENROUTER_API_KEY'),
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
      },
    }),
  moonshot: (name, opts) =>
    new ChatOpenAI({
      model: name,
      ...opts,
      apiKey: getApiKey('MOONSHOT_API_KEY'),
      configuration: {
        baseURL: 'https://api.moonshot.cn/v1',
      },
    }),
  deepseek: (name, opts) =>
    new ChatOpenAI({
      model: name,
      ...opts,
      apiKey: getApiKey('DEEPSEEK_API_KEY'),
      configuration: {
        baseURL: 'https://api.deepseek.com',
      },
    }),
  ollama: (name, opts) => {
    const fields: KryzovChatOllamaInput = {
      model: name.replace(/^ollama:/, ''),
      ...opts,
      think: resolveOllamaThinkSetting(name, opts.ollamaThink),
      ...(process.env.OLLAMA_BASE_URL ? { baseUrl: process.env.OLLAMA_BASE_URL } : {}),
    };
    return createKryzovChatOllama(fields);
  },
};

const DEFAULT_FACTORY: ModelFactory = (name, opts) =>
  new ChatOpenAI({
    model: name,
    ...opts,
    apiKey: getApiKey('OPENAI_API_KEY'),
  });

export function getChatModel(
  modelName: string = DEFAULT_MODEL,
  streaming: boolean = false,
  options: Pick<ModelOpts, 'ollamaThink'> = {},
): BaseChatModel {
  const opts: ModelOpts = { streaming, ...options };
  const provider = resolveProvider(modelName);
  const factory = MODEL_FACTORIES[provider.id] ?? DEFAULT_FACTORY;
  return factory(modelName, opts);
}

interface CallLlmOptions {
  model?: string;
  systemPrompt?: string;
  outputSchema?: z.ZodType<unknown>;
  tools?: StructuredToolInterface[];
  signal?: AbortSignal;
  ollamaThink?: OllamaThinkSetting;
}

export interface LlmResult {
  response: AIMessage | string;
  usage?: TokenUsage;
}

export function resolveAutoOllamaThink(query: string): OllamaThinkSetting {
  const normalized = query.toLowerCase();

  const complexPatterns = [
    /\bdivergence\b/,
    /\bcompare\b.*\b(last|previous|recent|\d+\s+sessions?)\b/,
    /\b(explain|why)\b.*\b(divergence|difference|vs|versus)\b/,
    /\bcompare and interpret\b/,
    /\bsynthesi[sz]e\b/,
    /\bwalk me through\b/,
  ];

  if (complexPatterns.some((pattern) => pattern.test(normalized))) {
    return 'medium';
  }

  const moderatePatterns = [
    /\baccepting\b/,
    /\brejecting\b/,
    /\bacceptance\b/,
    /\brejection\b/,
    /\blevel response\b/,
    /\bwhat does this mean\b/,
    /\binterpret\b/,
    /\bread this\b/,
    /\brecent sessions?\b/,
    /\bcompare\b/,
    /\bversus\b/,
    /\bvs\b/,
  ];

  if (moderatePatterns.some((pattern) => pattern.test(normalized))) {
    return 'low';
  }

  return false;
}

export function resolveAgentOllamaThink(modelName: string, query: string): OllamaThinkSetting | undefined {
  if (resolveProvider(modelName).id !== 'ollama') {
    return undefined;
  }

  if (getConfiguredOllamaThinkSetting() !== 'auto') {
    return undefined;
  }

  const resolved = resolveAutoOllamaThink(query);
  if (resolved === false && getOllamaThinkCapability(modelName) === 'level') {
    return 'low';
  }

  return resolved;
}

function extractUsage(result: unknown): TokenUsage | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const msg = result as Record<string, unknown>;

  const usageMetadata = msg.usage_metadata;
  if (usageMetadata && typeof usageMetadata === 'object') {
    const u = usageMetadata as Record<string, unknown>;
    const input = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
    const output = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
    const total = typeof u.total_tokens === 'number' ? u.total_tokens : input + output;
    return { inputTokens: input, outputTokens: output, totalTokens: total };
  }

  const responseMetadata = msg.response_metadata;
  if (responseMetadata && typeof responseMetadata === 'object') {
    const rm = responseMetadata as Record<string, unknown>;
    if (rm.usage && typeof rm.usage === 'object') {
      const u = rm.usage as Record<string, unknown>;
      const input = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0;
      const output = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0;
      const total = typeof u.total_tokens === 'number' ? u.total_tokens : input + output;
      return { inputTokens: input, outputTokens: output, totalTokens: total };
    }
  }

  return undefined;
}

/**
 * Build messages with Anthropic cache_control on the system prompt.
 * Marks the system prompt as ephemeral so Anthropic caches the prefix,
 * reducing input token costs by ~90% on subsequent calls.
 */
function buildAnthropicMessages(systemPrompt: string, userPrompt: string) {
  return [
    new SystemMessage({
      content: [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
    }),
    new HumanMessage(userPrompt),
  ];
}

export async function callLlm(prompt: string, options: CallLlmOptions = {}): Promise<LlmResult> {
  const { model = DEFAULT_MODEL, systemPrompt, outputSchema, tools, signal, ollamaThink } = options;
  const finalSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const provider = resolveProvider(model);

  if (provider.id === 'ollama' && ollamaThink !== undefined) {
    validateOllamaThinkForModel(model, ollamaThink);
  }

  const llm = getChatModel(model, false, { ollamaThink });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runnable: Runnable<any, any> = llm;

  if (outputSchema) {
    runnable = llm.withStructuredOutput(outputSchema, { strict: false });
  } else if (tools && tools.length > 0 && llm.bindTools) {
    runnable = llm.bindTools(tools);
  }

  const invokeOpts = signal ? { signal } : undefined;
  let result;

  if (provider.id === 'anthropic') {
    // Anthropic: use explicit messages with cache_control for prompt caching (~90% savings)
    const messages = buildAnthropicMessages(finalSystemPrompt, prompt);
    result = await withRetry(() => runnable.invoke(messages, invokeOpts), provider.displayName);
  } else {
    // Other providers: use ChatPromptTemplate (OpenAI/Gemini have automatic caching)
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', finalSystemPrompt],
      ['user', '{prompt}'],
    ]);
    const chain = promptTemplate.pipe(runnable);
    result = await withRetry(() => chain.invoke({ prompt }, invokeOpts), provider.displayName);
  }
  const usage = extractUsage(result);

  // If no outputSchema and no tools, extract content from AIMessage
  // When tools are provided, return the full AIMessage to preserve tool_calls
  if (!outputSchema && !tools && result && typeof result === 'object' && 'content' in result) {
    return { response: (result as { content: string }).content, usage };
  }
  return { response: result as AIMessage, usage };
}
