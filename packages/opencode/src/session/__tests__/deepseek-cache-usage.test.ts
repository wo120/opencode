import { describe, it, expect } from "bun:test"
import { getUsage } from "../session"
import type { LanguageModelUsage } from "ai"
import type { Provider } from "@/provider/provider"

// Minimal but type-complete Provider.Model fixture for DeepSeek
const mockDeepSeekModel: Provider.Model = {
  id: "deepseek-v4-pro" as Provider.Model["id"],
  providerID: "deepseek" as Provider.Model["providerID"],
  name: "DeepSeek V4 Pro",
  family: undefined,
  api: {
    id: "deepseek-v4-pro",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    reasoning: true,
    input: {},
    output: {},
  },
  cost: {
    input: 0.55,
    output: 2.19,
    cache: {
      read: 0.14,
      write: 0.55,
    },
  },
  limit: { context: 65536, output: 8192 },
  status: { type: "available" },
  options: {},
  headers: {},
  release_date: "2025-01-01",
} as unknown as Provider.Model

// Minimal Anthropic fixture (reuses DeepSeek base, overrides provider fields)
const mockAnthropicModel: Provider.Model = {
  ...mockDeepSeekModel,
  id: "claude-3-5-sonnet" as Provider.Model["id"],
  providerID: "anthropic" as Provider.Model["providerID"],
  name: "Claude 3.5 Sonnet",
  api: {
    id: "claude-3-5-sonnet",
    npm: "@ai-sdk/anthropic",
  },
} as unknown as Provider.Model

describe("DeepSeek Cache Usage Telemetry", () => {
  it("应该提取 DeepSeek 的 prompt_cache_hit_tokens 和 prompt_cache_miss_tokens", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      raw: {
        prompt_cache_hit_tokens: 800,
        prompt_cache_miss_tokens: 200,
      },
    } as unknown as LanguageModelUsage

    const result = getUsage({ model: mockDeepSeekModel, usage })

    expect(result.tokens.cache.hit).toBe(800)
    expect(result.tokens.cache.miss).toBe(200)
    expect(result.tokens.cache.ratio).toBeCloseTo(0.8, 2) // 800 / (800+200) = 0.8
  })

  it("应该计算正确的缓存命中率", () => {
    const usage = {
      inputTokens: 5000,
      outputTokens: 500,
      totalTokens: 5500,
      raw: {
        prompt_cache_hit_tokens: 4500,
        prompt_cache_miss_tokens: 500,
      },
    } as unknown as LanguageModelUsage

    const result = getUsage({ model: mockDeepSeekModel, usage })

    expect(result.tokens.cache.hit).toBe(4500)
    expect(result.tokens.cache.miss).toBe(500)
    expect(result.tokens.cache.ratio).toBeCloseTo(0.9, 2) // 4500 / 5000 = 0.9
  })

  it("当没有缓存数据时，hit/miss/ratio 应该为 undefined", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      inputTokenDetails: undefined,
      outputTokenDetails: undefined,
    } as unknown as LanguageModelUsage

    const result = getUsage({ model: mockDeepSeekModel, usage })

    expect(result.tokens.cache.hit).toBeUndefined()
    expect(result.tokens.cache.miss).toBeUndefined()
    expect(result.tokens.cache.ratio).toBeUndefined()
  })

  it("Anthropic 缓存字段：read/write 正确，hit/miss 不设置（语义不同）", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: 700,
        cacheWriteTokens: 300,
      },
    } as unknown as LanguageModelUsage

    const result = getUsage({ model: mockAnthropicModel, usage })

    // read/write 是标准字段，应该正确填充
    expect(result.tokens.cache.read).toBe(700)
    expect(result.tokens.cache.write).toBe(300)
    // hit/miss 是 DeepSeek 专属语义，Anthropic 不设置
    // （cacheWriteTokens 是 cache creation，不等于 cache miss）
    expect(result.tokens.cache.hit).toBeUndefined()
    expect(result.tokens.cache.miss).toBeUndefined()
    expect(result.tokens.cache.ratio).toBeUndefined()
  })

  it("DeepSeek 字段存在时，adjustedInput 应减去 hit tokens 而非标准 cacheRead", () => {
    // inputTokens=1000, hit=800, miss=200
    // standard cacheReadTokens=100 (should be ignored for adjustment)
    const usage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      inputTokenDetails: {
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      },
      raw: {
        prompt_cache_hit_tokens: 800,
        prompt_cache_miss_tokens: 200,
      },
    } as unknown as LanguageModelUsage

    const result = getUsage({ model: mockDeepSeekModel, usage })

    // adjustedInput = inputTokens(1000) - effectiveCacheRead(800) - cacheWrite(50) = 150
    expect(result.tokens.input).toBe(150)
    expect(result.tokens.cache.hit).toBe(800)
    expect(result.tokens.cache.miss).toBe(200)
    expect(result.tokens.cache.ratio).toBeCloseTo(0.8, 2)
  })

  it("应该正确处理 reasoning tokens", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      outputTokenDetails: { reasoningTokens: 300 },
      raw: {
        prompt_cache_hit_tokens: 800,
        prompt_cache_miss_tokens: 200,
      },
    } as unknown as LanguageModelUsage

    const result = getUsage({ model: mockDeepSeekModel, usage })

    expect(result.tokens.reasoning).toBe(300)
    expect(result.tokens.output).toBe(200) // 500 - 300 = 200
    expect(result.tokens.cache.hit).toBe(800)
    expect(result.tokens.cache.miss).toBe(200)
  })

  it("应该正确计算成本（DeepSeek hit tokens 按 cache.read 价格计费）", () => {
    // inputTokens=1000, hit=800, miss=200, output=200
    // adjustedInput = 1000 - 800(hit) - 0(write) = 200
    // cost = input(200)*0.55 + output(200)*2.19 + cacheRead(800)*0.14
    //      = 0.00011 + 0.000438 + 0.000112 = 0.00066
    const usage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      raw: {
        prompt_cache_hit_tokens: 800,
        prompt_cache_miss_tokens: 200,
      },
    } as unknown as LanguageModelUsage

    const result = getUsage({ model: mockDeepSeekModel, usage })

    expect(result.cost).toBeGreaterThan(0)
    // input:  200 * $0.55/M  = $0.000110
    // output: 200 * $2.19/M  = $0.000438
    // cache.read (hit): 800 * $0.14/M = $0.000112
    // total ≈ $0.000660
    expect(result.cost).toBeCloseTo(0.00066, 5)
  })
})
