# DeepSeek customization design and implementation

Status: P0-P3 complete for the local opencode fork as of 2026-05-18.

This document is the repo-local design record for the DeepSeek customization work. It defines the intended scope, implementation boundaries, validation evidence, and follow-up rules.

## Scope

The customization is intentionally narrow:

- Make DeepSeek OpenAI-compatible models stable in opencode tool loops.
- Preserve DeepSeek reasoning/tool-call behavior without provider 400 regressions.
- Capture DeepSeek prompt-cache telemetry and cost attribution.
- Route hidden/background agents to the configured `small_model` when appropriate.
- Keep the work as provider/session/test changes, not a general memory system.

Out of scope for this phase:

- Automatic memory disabling.
- GC/compaction systems beyond existing opencode behavior.
- Vector DB / SQLite memory architecture.
- LLM attribution for memory pollution.
- Large cross-language fixture expansion without real-task ROI evidence.

## Design decisions

### 1. DeepSeek provider compatibility

DeepSeek is treated as an OpenAI-compatible provider with a few provider-specific request-shaping rules.

Relevant implementation files:

- `packages/opencode/src/provider/transform.ts`
- `packages/opencode/src/session/llm.ts`

Rules:

- Normalize `reasoningEffort` to DeepSeek's expected `reasoning_effort` field.
- Preserve DeepSeek reasoning content through the transform layer where needed.
- Enable DeepSeek-compatible parallel tool call behavior where supported.
- Keep non-DeepSeek providers free of DeepSeek-only options.

Validation:

```bash
cd packages/opencode
PATH="$HOME/.bun/bin:$PATH" bun test test/provider/transform.test.ts --test-name-pattern 'DeepSeek'
```

Latest result: 6 pass.

### 2. Prompt-cache telemetry from `usage.raw`

DeepSeek prompt-cache fields are read from raw provider usage:

- `usage.raw.prompt_cache_hit_tokens`
- `usage.raw.prompt_cache_miss_tokens`

Relevant implementation file:

- `packages/opencode/src/session/session.ts`

Mapping:

- `tokens.cache.hit` = DeepSeek prompt-cache hit tokens.
- `tokens.cache.miss` = DeepSeek prompt-cache miss tokens.
- `tokens.cache.ratio` = `hit / (hit + miss)`.
- `tokens.cache.read` uses the effective DeepSeek cache-hit count so session aggregation and cost attribution include prompt-cache hits.

Cost rule:

- DeepSeek hit tokens are priced as cache-read tokens.
- Hit tokens are subtracted from regular input-token cost.

Boundary:

- `hit` and `miss` are DeepSeek semantics.
- Standard provider `cacheReadTokens` and `cacheWriteTokens` stay unchanged for other providers.
- Tests must put DeepSeek hit/miss fields under `usage.raw`, not top-level usage fixture fields.

Validation:

```bash
cd packages/opencode
PATH="$HOME/.bun/bin:$PATH" bun test src/session/__tests__/deepseek-cache-usage.test.ts
```

Latest result: 7 pass.

### 3. Hidden agents use `small_model`

Hidden/background work should use the configured cheaper/smaller model without changing the main foreground model.

Relevant implementation/test files:

- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/test/session/prompt.test.ts`

Validated case:

- Title generation uses configured `small_model`.
- Main prompt execution keeps using the main configured model.

Validation:

```bash
cd packages/opencode
PATH="$HOME/.bun/bin:$PATH" bun test test/session/prompt.test.ts --test-name-pattern 'title generation uses configured small_model'
```

Latest result: 1 pass when run standalone.

Note: running this prompt test concurrently with other HTTP-server tests can hit transient `EADDRINUSE`; standalone rerun passed, so treat the concurrent failure as test-environment contention rather than a routing failure.

### 4. Instruction ordering stability

Instruction loading must preserve semantic precedence. The fork restored global-to-project order semantics rather than sorting away precedence.

This reduces prompt-prefix drift between repeated DeepSeek runs and keeps cache observations meaningful.

### 5. Tool output summary preservation

Tool-output truncation should preserve high-value failure information through error summaries so debugging tasks keep the actual failure cause.

The P0-P3 test matrix records real-task evidence for this behavior.

## Local runtime expectation

The local `opencode` command should run the fork directly:

```bash
command -v opencode
opencode --version
```

Expected:

- `command -v opencode` resolves to `~/.bun/bin/opencode`.
- `opencode --version` prints `local`.

The shim starts from `packages/opencode` so Bun picks up the package TypeScript/JSX configuration.

## Verification checklist

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
- Title hidden-agent small_model test: 1 pass standalone.
- Typecheck: pass.

## Completion judgment

P0-P3 are complete for the intended DeepSeek customization scope:

- DeepSeek tool loops work without the known 400 regression.
- DeepSeek cache telemetry is captured from `usage.raw` and aggregated.
- DeepSeek cache-hit cost attribution is covered by tests.
- Hidden title generation honors `small_model`.
- Provider transform behavior is covered by targeted tests.
- Real-task telemetry and matrix notes are kept under `docs/testing/`.

## Follow-up policy

Do not expand this work into broad memory automation, vector storage, or large fixture systems unless 1-2 weeks of real-task telemetry shows clear token reduction without increasing:

- `NEEDS_CONTEXT`
- high-severity review findings
- verification failures
