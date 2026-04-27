# Repository Guidelines

- Repo: https://github.com/YungBenn/kryzov
- Kryzov is a CLI-based BTC/USD market research agent for Hyperliquid derivatives, built with TypeScript, a terminal UI, LangChain-based model/tool integrations, and LangSmith-backed evaluation/tracing support.

## Project Structure

- Source code: `src/`
  - Agent core: `src/agent/` (prompting, scope enforcement, scratchpad, final-answer flow)
  - CLI runtime: `src/cli.ts`, entry point: `src/index.tsx`
  - Components: `src/components/` (terminal UI)
  - Controllers: `src/controllers/` (agent runner, model selection)
  - Model/LLM: `src/model/llm.ts` (LangChain-backed provider abstraction, model detection, Ollama support)
  - Market runtime: `src/market/` (Hyperliquid bootstrap, streaming state, session persistence)
  - Tools: `src/tools/`
    - Registry: `src/tools/registry.ts`
    - Market tools: `src/tools/market/` (`market_context`, `recent_sessions`, `level_response`)
  - Skills: `src/skills/` (built-in and user/project `SKILL.md` workflows)
  - Gateway: `src/gateway/` (optional messaging integrations such as WhatsApp)
  - Utils: `src/utils/` (env handling, app paths, persistence helpers)
  - Evals: `src/evals/` (LangSmith-backed evaluation runner)
- Project app state: `.kryzov/`
  - `settings.json` for persisted model/provider selection
  - `messages/` for chat history
  - `market/` for live session and recent-session storage
  - `scratchpad/` for per-query debug traces
- Legacy `.dexter/` state is migrated into `.kryzov/` on first run without deleting the old directory.

## Build, Test, and Development Commands

- Runtime: Bun. Use `bun` for install, run, and tests.
- Install deps: `bun install`
- Run interactive CLI: `bun run start` or `bun run src/index.tsx`
- Dev watch mode: `bun run dev`
- Type-check: `bun run typecheck`
- Tests: `bun test`
- Watch tests: `bun run test:watch`
- Gateway login: `bun run gateway:login`
- Gateway run: `bun run gateway`
- Evals: `bun run src/evals/run.ts` or `bun run src/evals/run.ts --sample 10`

## Coding Style & Conventions

- Language: TypeScript (ESM, strict mode).
- Prefer precise types; avoid `any`.
- Keep modules focused and extract helpers instead of duplicating logic.
- Add brief comments only where the logic is non-obvious.
- Do not add logging unless explicitly requested.
- Do not create new docs files unless explicitly requested.

## Runtime Behavior

- Product scope is BTC/USD on Hyperliquid perpetuals only.
- Session boundary is `00:00 UTC`.
- Measured market state is authoritative; the LLM interprets it but should not invent coverage.
- Scope refusals are expected for non-BTC assets, non-Hyperliquid venues, portfolio advice, execution advice, and prediction/signal requests.
- Final answers default to short terminal-friendly prose: measured facts first, then a bounded interpretive read, with evidence only when needed.

## Models & Providers

- Supported providers include OpenAI, Anthropic, Google, xAI, OpenRouter, Ollama, Moonshot, and DeepSeek when configured in `src/model/llm.ts`.
- Provider adapters are implemented through LangChain model packages.
- Default model remains `gpt-5.2` unless the user switches it.
- Users switch providers/models from the CLI via slash commands such as `/model`.
- Ollama uses `OLLAMA_BASE_URL` and should work without an OpenAI key when the selected model is an Ollama model.

## Tools & Skills

- Runtime tool surface is limited to:
  - `market_context`
  - `recent_sessions`
  - `level_response`
- Tool registry source of truth: `src/tools/registry.ts`.
- Runtime tools are exposed through LangChain tool interfaces.
- Built-in skill flow is `src/skills/session-read/SKILL.md`.
- User/project skills can also live under `~/.kryzov/skills/` and `.kryzov/skills/`.
- Legacy finance/search/browser code may still exist on disk, but it is not the primary CLI runtime surface and should not be documented as such.

## Environment Variables

- LLM keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`
- Ollama: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- Hyperliquid: `HYPERLIQUID_WS_URL`, `HYPERLIQUID_INFO_URL`
- Tracing: `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING`
- Never commit `.env` files or real credentials.

## Evaluations

- Evaluation runner lives in `src/evals/run.ts`.
- Primary dataset is `src/evals/dataset/kryzov_agent.csv`.
- LangSmith is used for evaluation runs and optional tracing when configured.
- Evals focus on scope enforcement, answer style, and Kryzov-specific product behavior rather than the legacy finance workflow.

## Version & Release

- Version format: CalVer `YYYY.M.D`. Tag prefix: `v`.
- Release script: `bash scripts/release.sh [version]`.
- Do not push tags, publish releases, or change versioning flow without user confirmation.

## Testing

- Test runner: Bun.
- Tests are colocated as `*.test.ts`.
- Run `bun test` when changing runtime logic.
- For doc-only changes, verify commands, env vars, and file paths against `package.json`, `env.example`, and current `src/` references.

## Security

- Keep secrets in `.env` only.
- Do not commit API keys, session tokens, WhatsApp credentials, or LangSmith credentials.
- Config and user state live under `.kryzov/` and are gitignored.
