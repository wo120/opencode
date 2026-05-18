import { describe, expect, test } from "bun:test"
import { buildCacheMetrics, type SessionStats } from "../../src/cli/cmd/stats"

function stats(tokens: SessionStats["totalTokens"], totalCost = 0.25) {
  return buildCacheMetrics({ totalCost, totalTokens: tokens })
}

describe("stats cache metrics", () => {
  test("reports DeepSeek prompt-cache hit and miss ratio", () => {
    const result = stats({
      input: 37,
      output: 8,
      reasoning: 23,
      cache: { read: 11392, write: 0, hit: 11392, miss: 37 },
    })

    expect(result.hit).toBe(11392)
    expect(result.miss).toBe(37)
    expect(result.hitRatio).toBeCloseTo(0.9968, 4)
    expect(result.nonCachedInput).toBe(37)
    expect(result.totalAccountedTokens).toBe(11460)
    expect(result.cost).toBe(0.25)
  })

  test("uses zero ratio when hit and miss are absent", () => {
    const result = stats({
      input: 100,
      output: 20,
      reasoning: 5,
      cache: { read: 0, write: 0, hit: 0, miss: 0 },
    })

    expect(result.hitRatio).toBe(0)
    expect(result.totalAccountedTokens).toBe(125)
  })
})
