import { describe, it, expect } from "bun:test"
import { getUsage } from "../session"
import type { LanguageModelUsage, ProviderMetadata } from "ai"
import type { Provider } from "@/provider/provider"

describe("DeepSeek Cache Usage Telemetry", () => {
  const mockDeepSeekModel: Provider.Model = {
    id: "deepseek-v4-pro",
    providerID: "deepseek",
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
  } as Provider.Model

  it("应该提取 DeepSeek 的 prompt_cache_hit_tokens 和 prompt_cache_miss_tokens", () => {
    const usage: LanguageModelUsage & {
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    } = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    }

    const result = getUsage({
      model: mockDeepSeekModel,
      usage,
    })

    expect(result.tokens.cache.hit).toBe(800)
    expect(result.tokens.cache.miss).toBe(200)
    expect(result.tokens.cache.ratio).toBeCloseTo(0.8, 2) // 800 / 1000 = 0.8
  })

  it("应该计算正确的缓存命中率", () => {
    const usage: LanguageModelUsage & {
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    } = {
      inputTokens: 5000,
      outputTokens: 500,
      totalTokens: 5500,
      prompt_cache_hit_tokens: 4500,
      prompt_cache_miss_tokens: 500,
    }

    const result = getUsage({
      model: mockDeepSeekModel,
      usage,
    })

    expect(result.tokens.cache.hit).toBe(4500)
    expect(result.tokens.cache.miss).toBe(500)
    expect(result.tokens.cache.ratio).toBeCloseTo(0.9, 2) // 4500 / 5000 = 0.9
  })

  it("当没有缓存数据时，ratio 应该为 undefined", () => {
    const usage: LanguageModelUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
    }

    const result = getUsage({
      model: mockDeepSeekModel,
      usage,
    })

    expect(result.tokens.cache.hit).toBeUndefined()
    expect(result.tokens.cache.miss).toBeUndefined()
    expect(result.tokens.cache.ratio).toBeUndefined()
  })

  it("应该兼容 Anthropic 的缓存字段", () => {
    const anthropicModel: Provider.Model = {
      ...mockDeepSeekModel,
      id: "claude-3-5-sonnet",
      providerID: "anthropic",
      api: {
        id: "claude-3-5-sonnet",
        npm: "@ai-sdk/anthropic",
      },
    } as Provider.Model

    const usage: LanguageModelUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      inputTokenDetails: {
        cacheReadTokens: 700,
        cacheWriteTokens: 300,
      },
    }

    const result = getUsage({
      model: anthropicModel,
      usage,
    })

    // Anthropic 使用 cacheReadTokens/cacheWriteTokens
    expect(result.tokens.cache.read).toBe(700)
    expect(result.tokens.cache.write).toBe(300)
    expect(result.tokens.cache.hit).toBe(700)
    expect(result.tokens.cache.miss).toBe(300)
    expect(result.tokens.cache.ratio).toBeCloseTo(0.7, 2) // 700 / 1000 = 0.7
  })

  it("DeepSeek 字段应该优先于标准字段", () => {
    const usage: LanguageModelUsage & {
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    } = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      inputTokenDetails: {
        cacheReadTokens: 100, // 这个应该被忽略
        cacheWriteTokens: 50,  // 这个应该被忽略
      },
      prompt_cache_hit_tokens: 800, // DeepSeek 专属字段优先
      prompt_cache_miss_tokens: 200, // DeepSeek 专属字段优先
    }

    const result = getUsage({
      model: mockDeepSeekModel,
      usage,
    })

    expect(result.tokens.cache.hit).toBe(800) // 使用 DeepSeek 字段
    expect(result.tokens.cache.miss).toBe(200) // 使用 DeepSeek 字段
    expect(result.tokens.cache.ratio).toBeCloseTo(0.8, 2)
  })

  it("应该正确处理 reasoning tokens", () => {
    const usage: LanguageModelUsage & {
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    } = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      outputTokenDetails: {
        reasoningTokens: 300,
      },
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    }

    const result = getUsage({
      model: mockDeepSeekModel,
      usage,
    })

    expect(result.tokens.reasoning).toBe(300)
    expect(result.tokens.output).toBe(200) // 500 - 300 = 200
    expect(result.tokens.cache.hit).toBe(800)
    expect(result.tokens.cache.miss).toBe(200)
  })

  it("应该正确计算成本（包含缓存成本）", () => {
    const usage: LanguageModelUsage & {
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    } = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    }

    const result = getUsage({
      model: mockDeepSeekModel,
      usage,
    })

    // 验证成本计算包含了缓存成本
    expect(result.cost).toBeGreaterThan(0)

    // 手动计算预期成本
    // input: 0 tokens (因为都在缓存中)
    // output: 200 tokens * $2.19 / 1M = $0.000438
    // cache.read: 800 tokens * $0.14 / 1M = $0.000112
    // cache.write: 200 tokens * $0.55 / 1M = $0.00011
    // total ≈ $0.00066
    expect(result.cost).toBeCloseTo(0.00066, 5)
  })
})
