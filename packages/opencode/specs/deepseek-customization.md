# DeepSeek customization implementation notes

Status: P0-P3 complete for the local fork as of 2026-05-18.

This document records the intentional DeepSeek-specific behavior in the fork so future changes do not re-expand the work into a generic memory/provider system.

## Goals

- Make DeepSeek OpenAI-compatible models work reliably with opencode tool loops.
- Preserve DeepSeek reasoning output without triggering provider request errors.
- Track DeepSeek prompt-cache ROI from real sessions.
- Route hidden/background agents to the configured `small_model` where appropriate.
- Keep the implementation narrow: provider transform, usage telemetry, hidden-agent routing, and targeted tests only.

## Implemented behavior

### P0: DeepSeek multi-turn tool-call compatibility

Relevant files:

- `src/provider/transform.ts`
- `src/session/llm.ts`

DeepSeek models are detected by provider/model id and get DeepSeek-safe request shaping:

- `reasoningEffort` is normalized to DeepSeek's OpenAI-compatible snake_case field `reasoning_effort`.
- DeepSeek reasoning content is preserved in provider options where the transform layer needs it.
- Parallel tool calls are enabled for DeepSeek-compatible models where supported.

Regression coverage:

- `test/provider/transform.test.ts`
  - DeepSeek reasoning content with tool calls.
  - DeepSeek `reasoning_effort` normalization.
  - Non-DeepSeek models are not polluted with DeepSeek-only fields.

### P1a: DeepSeek cache usage telemetry

Relevant file:

- `src/session/session.ts`

DeepSeek returns prompt-cache fields under the provider raw usage payload:

- `usage.raw.prompt_cache_hit_tokens`
- `usage.raw.prompt_cache_miss_tokens`

`getUsage()` maps those values into opencode token telemetry:

- `tokens.cache.hit`: DeepSeek cache-hit tokens.
- `tokens.cache.miss`: DeepSeek cache-miss tokens.
- `tokens.cache.ratio`: `hit / (hit + miss)`.
- `tokens.cache.read`: uses the effective cache-read count so session-level aggregation includes DeepSeek cache hits.

Cost calculation treats DeepSeek hit tokens as cache-read tokens and subtracts them from normal input-token cost.

Important boundary:

- `hit` / `miss` are DeepSeek semantic fields.
- Standard provider `cacheReadTokens` / `cacheWriteTokens` are still preserved for non-DeepSeek providers.
- Tests must place DeepSeek hit/miss under `usage.raw`, not top-level fixture fields.

Regression coverage:

- `src/session/__tests__/deepseek-cache-usage.test.ts`
  - Extracts hit/miss from `usage.raw`.
  - Computes ratio.
  - Adjusts input cost using DeepSeek hit tokens.
  - Keeps Anthropic-style read/write semantics separate.

### P1c: hidden agents use `small_model`

Relevant files:

- `src/provider/provider.ts`
- `test/session/prompt.test.ts`

The fork keeps heavy foreground work on the configured main model while hidden/background work can use `small_model`.

Validated hidden-agent case:

- Title generation uses configured `small_model`.
- Normal prompt execution continues to use the main model.

Regression coverage:

- `test/session/prompt.test.ts`
  - `title generation uses configured small_model`.

### P2.5: tool-output summary preservation

Relevant area:

- Tool output summarization/truncation tests and real P0-P3 task logs.

When shell/tool output is truncated, high-value error information is preserved via error summary content so debugging tasks do not lose the actual failure cause.

Validated evidence is recorded in the P0-P3 testing notes.

### P3: instruction ordering stability

Relevant behavior:

- Instruction loading preserves semantic order instead of sorting away global-to-project precedence.

This prevents prompt-prefix instability between repeated DeepSeek runs.

## Local runtime setup

The local command is expected to run the fork directly:

```bash
command -v opencode
opencode --version
```

Expected result:

- `command -v opencode` resolves to the local shim under `~/.bun/bin/opencode`.
- `opencode --version` prints `local`.

The shim starts from `packages/opencode` so Bun picks up the package TypeScript/JSX configuration.

## Verification commands

Run from `packages/opencode`:

```bash
PATH="$HOME/.bun/bin:$PATH" bun test src/session/__tests__/deepseek-cache-usage.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test test/provider/transform.test.ts --test-name-pattern 'DeepSeek'
PATH="$HOME/.bun/bin:$PATH" bun test test/session/prompt.test.ts --test-name-pattern 'title generation uses configured small_model'
PATH="$HOME/.bun/bin:$PATH" bun typecheck
```

Latest targeted verification on 2026-05-18:

- DeepSeek cache usage telemetry: 7 pass.
- DeepSeek provider transform tests: 6 pass.
- Title hidden-agent small_model test: 1 pass when run standalone.
- Typecheck: pass.

Note: running the prompt hidden-agent test concurrently with other HTTP-server tests can hit a transient `EADDRINUSE` server startup error. Standalone rerun passed; treat the concurrent failure as test-environment contention, not a model-routing assertion failure.

## Current completion judgment

P0-P3 are complete for the intended DeepSeek fork scope:

- DeepSeek tool loops work without the known 400 regression.
- DeepSeek cache telemetry is captured from `usage.raw` and aggregated.
- Hidden title generation honors `small_model`.
- Provider transform behavior is covered by targeted tests.
- Real-task P0-P3 telemetry exists in the local testing notes.

Do not expand this into broad memory automation, vector storage, or cross-language fixture work without fresh real-task ROI evidence.
