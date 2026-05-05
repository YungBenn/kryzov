import { AIMessage } from '@langchain/core/messages';
import { StructuredToolInterface } from '@langchain/core/tools';
import { callLlm, resolveAgentOllamaThink } from '../model/llm.js';
import { getTools } from '../tools/registry.js';
import { buildSystemPrompt, buildIterationPrompt, buildFinalAnswerPrompt, buildRewriteAnswerPrompt } from '../agent/prompts.js';
import { extractTextContent, hasToolCalls } from '../utils/ai-message.js';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import { estimateTokens, CONTEXT_THRESHOLD, KEEP_TOOL_USES } from '../utils/tokens.js';
import type { AgentConfig, AgentEvent, ContextClearedEvent, TokenUsage } from '../agent/types.js';
import { createRunContext, type RunContext } from './run-context.js';
import { buildFinalAnswerContext } from './final-answer-context.js';
import { AgentToolExecutor } from './tool-executor.js';
import { assessKryzovScope } from './scope.js';
import type { ToolCallRecord, ToolContext } from './scratchpad.js';
import type { OllamaThinkSetting } from '../model/ollama-compat.js';
import {
  resolveAnswerMode,
  shouldRewriteAnswer,
  type AnswerMode,
  type ComparisonRewriteContext,
} from './answer-style.js';


const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * The core agent class that handles the agent loop and tool execution.
 */
export class Agent {
  private readonly model: string;
  private readonly maxIterations: number;
  private readonly tools: StructuredToolInterface[];
  private readonly toolMap: Map<string, StructuredToolInterface>;
  private readonly toolExecutor: AgentToolExecutor;
  private readonly systemPrompt: string;
  private readonly signal?: AbortSignal;

  private constructor(
    config: AgentConfig,
    tools: StructuredToolInterface[],
    systemPrompt: string
  ) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.tools = tools;
    this.toolMap = new Map(tools.map(t => [t.name, t]));
    this.toolExecutor = new AgentToolExecutor(this.toolMap, config.signal, config.requestToolApproval, config.sessionApprovedTools);
    this.systemPrompt = systemPrompt;
    this.signal = config.signal;
  }

  /**
   * Create a new Agent instance with tools.
   */
  static create(config: AgentConfig = {}): Agent {
    const model = config.model ?? DEFAULT_MODEL;
    const tools = getTools(model);
    const systemPrompt = buildSystemPrompt(model);
    return new Agent(config, tools, systemPrompt);
  }

  /**
   * Run the agent and yield events for real-time UI updates.
   * Anthropic-style context management: full tool results during iteration,
   * with threshold-based clearing of oldest results when context exceeds limit.
   */
  async *run(query: string, inMemoryHistory?: InMemoryChatHistory): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

    if (this.tools.length === 0) {
      yield { type: 'done', answer: 'No tools available. Please check your API key configuration.', toolCalls: [], iterations: 0, totalTime: Date.now() - startTime };
      return;
    }

    const scopeAssessment = assessKryzovScope(query);
    if (scopeAssessment.status === 'refused') {
      yield {
        type: 'done',
        answer: scopeAssessment.response ?? scopeAssessment.reason ?? 'That request is outside Kryzov scope.',
        toolCalls: [],
        iterations: 0,
        totalTime: Date.now() - startTime,
      };
      return;
    }

    const ctx = createRunContext(query);
    const ollamaThink = resolveAgentOllamaThink(this.model, query);
    const answerMode = resolveAnswerMode(query);

    // Build initial prompt with conversation history context
    let currentPrompt = this.buildInitialPrompt(query, inMemoryHistory);

    // Main agent loop
    while (ctx.iteration < this.maxIterations) {
      ctx.iteration++;

      const { response, usage } = await this.callModel(currentPrompt, true, ollamaThink);
      ctx.tokenCounter.add(usage);
      const responseText = typeof response === 'string' ? response : extractTextContent(response);

      // Emit thinking if there are also tool calls (skip whitespace-only responses)
      if (responseText?.trim() && typeof response !== 'string' && hasToolCalls(response)) {
        const trimmedText = responseText.trim();
        ctx.scratchpad.addThinking(trimmedText);
        yield { type: 'thinking', message: trimmedText };
      }

      // No tool calls = ready to generate final answer
      if (typeof response === 'string' || !hasToolCalls(response)) {
        // If no tools were called at all, just use the direct response
        // This handles greetings, clarifying questions, etc.
        if (!ctx.scratchpad.hasToolResults() && responseText) {
          const finalAnswer = await this.maybeRewriteAnswer(responseText, ctx, answerMode, ollamaThink);
          yield* this.emitFinalAnswer(finalAnswer, ctx, []);
          return;
        }

        if (responseText?.trim()) {
          const finalAnswer = await this.maybeRewriteAnswer(responseText.trim(), ctx, answerMode, ollamaThink);
          yield* this.emitFinalAnswer(finalAnswer, ctx, ctx.scratchpad.getToolCallRecords());
          return;
        }

        // Generate final answer with full context from scratchpad
        yield* this.generateFinalAnswer(ctx, answerMode, undefined, ollamaThink);
        return;
      }

      // Execute tools and add results to scratchpad (response is AIMessage here)
      for await (const event of this.toolExecutor.executeAll(response, ctx)) {
        yield event;
        if (event.type === 'tool_denied') {
          const totalTime = Date.now() - ctx.startTime;
          yield {
            type: 'done',
            answer: '',
            toolCalls: ctx.scratchpad.getToolCallRecords(),
            iterations: ctx.iteration,
            totalTime,
            tokenUsage: ctx.tokenCounter.getUsage(),
            tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
          };
          return;
        }
      }
      yield* this.manageContextThreshold(ctx);

      // Build iteration prompt with full tool results (Anthropic-style)
      currentPrompt = buildIterationPrompt(
        query, 
        ctx.scratchpad.getToolResults(),
        ctx.scratchpad.formatToolUsageForPrompt()
      );
    }

    // Max iterations reached - still generate proper final answer
    yield* this.generateFinalAnswer(ctx, answerMode, {
      fallbackMessage: `Reached maximum iterations (${this.maxIterations}).`,
    }, ollamaThink);
  }

  /**
   * Call the LLM with the current prompt.
   * @param prompt - The prompt to send to the LLM
   * @param useTools - Whether to bind tools (default: true). When false, returns string directly.
   */
  private async callModel(
    prompt: string,
    useTools: boolean = true,
    ollamaThink?: OllamaThinkSetting,
  ): Promise<{ response: AIMessage | string; usage?: TokenUsage }> {
    const result = await callLlm(prompt, {
      model: this.model,
      systemPrompt: this.systemPrompt,
      tools: useTools ? this.tools : undefined,
      signal: this.signal,
      ollamaThink,
    });
    return { response: result.response, usage: result.usage };
  }

  /**
   * Generate final answer with full scratchpad context.
   */
  private async *emitFinalAnswer(
    answer: string,
    ctx: RunContext,
    toolCalls: ToolCallRecord[],
  ): AsyncGenerator<AgentEvent, void> {
    yield { type: 'answer_start' };
    const totalTime = Date.now() - ctx.startTime;
    yield {
      type: 'done',
      answer,
      toolCalls,
      iterations: ctx.iteration,
      totalTime,
      tokenUsage: ctx.tokenCounter.getUsage(),
      tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
    };
  }

  /**
   * Generate final answer with full scratchpad context.
   */
  private async *generateFinalAnswer(
    ctx: RunContext,
    answerMode: AnswerMode,
    options?: { fallbackMessage?: string },
    ollamaThink?: OllamaThinkSetting,
  ): AsyncGenerator<AgentEvent, void> {
    const fullContext = buildFinalAnswerContext(ctx.scratchpad);
    const finalPrompt = buildFinalAnswerPrompt(ctx.query, fullContext);

    yield { type: 'answer_start' };
    const { response, usage } = await this.callModel(finalPrompt, false, ollamaThink);
    ctx.tokenCounter.add(usage);
    const answer = typeof response === 'string'
      ? response
      : extractTextContent(response);
    const finalAnswer = await this.maybeRewriteAnswer(answer, ctx, answerMode, ollamaThink);
    yield* this.emitFinalAnswer(
      options?.fallbackMessage ? finalAnswer || options.fallbackMessage : finalAnswer,
      ctx,
      ctx.scratchpad.getToolCallRecords(),
    );
  }

  private async maybeRewriteAnswer(
    answer: string,
    ctx: RunContext,
    answerMode: AnswerMode,
    ollamaThink?: OllamaThinkSetting,
  ): Promise<string> {
    const normalized = answer.trim();
    const comparisonContext = this.getComparisonRewriteContext(ctx.scratchpad.getFullContexts());
    if (
      !normalized ||
      !shouldRewriteAnswer(normalized, answerMode, {
        query: ctx.query,
        comparison: comparisonContext,
      })
    ) {
      return normalized;
    }

    const rewritePrompt = buildRewriteAnswerPrompt(
      ctx.query,
      normalized,
      answerMode,
      this.formatComparisonRewriteContext(comparisonContext),
    );
    const { response, usage } = await this.callModel(rewritePrompt, false, ollamaThink);
    ctx.tokenCounter.add(usage);
    const rewritten = typeof response === 'string' ? response.trim() : extractTextContent(response)?.trim();
    return rewritten || normalized;
  }

  private getComparisonRewriteContext(contexts: ToolContext[]): ComparisonRewriteContext | null {
    for (let index = contexts.length - 1; index >= 0; index--) {
      const ctx = contexts[index];
      if (!ctx || (ctx.toolName !== 'recent_sessions' && ctx.toolName !== 'market_context')) {
        continue;
      }

      try {
        const parsed = JSON.parse(ctx.result) as { data?: Record<string, unknown> };
        const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : null;
        if (!data) {
          continue;
        }

        const comparison = data.comparison as Record<string, unknown> | undefined;
        const plainComparison = data.plainComparison as Record<string, unknown> | undefined;
        if (!comparison || typeof comparison !== 'object') {
          continue;
        }

        return {
          rangeComparison:
            comparison.rangeComparison === 'wider' ||
            comparison.rangeComparison === 'narrower' ||
            comparison.rangeComparison === 'similar'
              ? comparison.rangeComparison
              : null,
          sessionVwapComparison:
            comparison.sessionVwapComparison === 'higher' ||
            comparison.sessionVwapComparison === 'lower' ||
            comparison.sessionVwapComparison === 'similar'
              ? comparison.sessionVwapComparison
              : null,
          currentFlowBias:
            comparison.currentFlowBias === 'buy' ||
            comparison.currentFlowBias === 'sell' ||
            comparison.currentFlowBias === 'balanced'
              ? comparison.currentFlowBias
              : null,
          plainComparison: plainComparison
            ? {
                takeaway: typeof plainComparison.takeaway === 'string' ? plainComparison.takeaway : null,
                price: typeof plainComparison.price === 'string' ? plainComparison.price : null,
                range: typeof plainComparison.range === 'string' ? plainComparison.range : null,
                flow: typeof plainComparison.flow === 'string' ? plainComparison.flow : null,
              }
            : null,
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  private formatComparisonRewriteContext(comparison: ComparisonRewriteContext | null): string | null {
    if (!comparison) {
      return null;
    }

    const lines: string[] = [];

    if (comparison.rangeComparison) {
      lines.push(`- Range vs recent average: ${comparison.rangeComparison}`);
    }
    if (comparison.sessionVwapComparison) {
      lines.push(`- Session average price vs recent average: ${comparison.sessionVwapComparison}`);
    }
    if (comparison.currentFlowBias) {
      lines.push(`- Current flow bias: ${comparison.currentFlowBias}`);
    }
    if (comparison.plainComparison?.takeaway) {
      lines.push(`- Plain takeaway: ${comparison.plainComparison.takeaway}`);
    }
    if (comparison.plainComparison?.price) {
      lines.push(`- Price summary: ${comparison.plainComparison.price}`);
    }
    if (comparison.plainComparison?.range) {
      lines.push(`- Range summary: ${comparison.plainComparison.range}`);
    }
    if (comparison.plainComparison?.flow) {
      lines.push(`- Flow summary: ${comparison.plainComparison.flow}`);
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  /**
   * Clear oldest tool results if context size exceeds threshold.
   */
  private *manageContextThreshold(ctx: RunContext): Generator<ContextClearedEvent, void> {
    const fullToolResults = ctx.scratchpad.getToolResults();
    const estimatedContextTokens = estimateTokens(this.systemPrompt + ctx.query + fullToolResults);

    if (estimatedContextTokens > CONTEXT_THRESHOLD) {
      const clearedCount = ctx.scratchpad.clearOldestToolResults(KEEP_TOOL_USES);
      if (clearedCount > 0) {
        yield { type: 'context_cleared', clearedCount, keptCount: KEEP_TOOL_USES };
      }
    }
  }

  /**
   * Build initial prompt with conversation history context if available
   */
  private buildInitialPrompt(
    query: string,
    inMemoryChatHistory?: InMemoryChatHistory
  ): string {
    if (!inMemoryChatHistory?.hasMessages()) {
      return query;
    }

    const userMessages = inMemoryChatHistory.getUserMessages();
    if (userMessages.length === 0) {
      return query;
    }

    const historyContext = userMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n');
    return `Current query to answer: ${query}\n\nPrevious user queries for context:\n${historyContext}`;
  }

}
