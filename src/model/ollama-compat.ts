import { ChatOllama } from '@langchain/ollama';
import type { ChatOllamaInput } from '@langchain/ollama';

export type OllamaThinkSetting = boolean | 'high' | 'medium' | 'low';
export type OllamaConfiguredThinkSetting = OllamaThinkSetting | 'auto';
export type OllamaThinkCapability = 'boolean' | 'level';
const GPT_OSS_ALLOWED_THINK_LEVELS = ['low', 'medium', 'high'] as const;

export interface KryzovChatOllamaInput extends Omit<ChatOllamaInput, 'think'> {
  think?: OllamaThinkSetting;
}

export function getOllamaModelId(modelName: string): string {
  return modelName.replace(/^ollama:/, '').toLowerCase();
}

export function getOllamaThinkCapability(modelName: string): OllamaThinkCapability {
  return getOllamaModelId(modelName).startsWith('gpt-oss') ? 'level' : 'boolean';
}

export function validateOllamaThinkForModel(
  modelName: string,
  think: OllamaThinkSetting,
): void {
  if (getOllamaThinkCapability(modelName) !== 'level') {
    return;
  }

  if (typeof think === 'boolean') {
    throw new Error(
      `[OLLAMA] Model "${modelName}" requires level-based think values (${GPT_OSS_ALLOWED_THINK_LEVELS.join(
        ', ',
      )}). Boolean think values are not supported for gpt-oss models.`,
    );
  }
}

export function normalizeOllamaThinkForModel(
  modelName: string,
  think: OllamaThinkSetting,
): OllamaThinkSetting {
  const capability = getOllamaThinkCapability(modelName);

  if (capability === 'level') {
    validateOllamaThinkForModel(modelName, think);
    return think;
  }

  if (think === false) {
    return false;
  }

  return true;
}

/**
 * LangChain's ChatOllama types only allow boolean `think`, while the
 * underlying Ollama runtime supports graded reasoning levels.
 * Keep that compatibility boundary isolated here.
 */
export function createKryzovChatOllama(fields: KryzovChatOllamaInput): ChatOllama {
  const { think, ...rest } = fields;
  const effectiveThink = think === undefined
    ? undefined
    : normalizeOllamaThinkForModel(fields.model ?? '', think);
  const model = new ChatOllama({
    ...rest,
    ...(typeof effectiveThink === 'boolean' ? { think: effectiveThink } : {}),
  });

  Reflect.set(model, 'think', effectiveThink);

  return model;
}
