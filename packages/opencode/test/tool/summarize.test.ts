import { describe, expect, test } from "bun:test"
import { summarizeToolOutput } from "../../src/tool/summarize"

describe("summarizeToolOutput", () => {
  test("exit 0 returns undefined", () => {
    expect(summarizeToolOutput("hello world", 0)).toBeUndefined()
  })

  test("exit 1 returns failed summary", () => {
    const r = summarizeToolOutput("some output", 1)
    expect(r).toBeDefined()
    expect(r!.exitCode).toBe(1)
    expect(r!.status).toBe("failed")
  })

  test("extracts error lines", () => {
    const r = summarizeToolOutput("building...\nerror: cannot find module 'foo'\ndone", 1)
    expect(r!.importantLines).toContain("error: cannot find module 'foo'")
  })

  test("extracts warning lines", () => {
    const r = summarizeToolOutput("warning: unused variable 'x'\nok", 1)
    expect(r!.importantLines).toContain("warning: unused variable 'x'")
  })

  test("extracts FAILED lines", () => {
    const r = summarizeToolOutput("FAILED: test_login\nFAILED: test_signup\npassed: 10", 1)
    expect(r!.importantLines).toContain("FAILED: test_login")
    expect(r!.importantLines).toContain("FAILED: test_signup")
  })

  test("extracts panic lines", () => {
    const r = summarizeToolOutput("panic: runtime error: index out of range\ngoroutine 1", 1)
    expect(r!.importantLines).toContain("panic: runtime error: index out of range")
  })

  test("extracts file:line refs", () => {
    const r = summarizeToolOutput("src/main.ts:42: error TS2345\nother line", 1)
    expect(r!.fileRefs).toContain("src/main.ts:42")
  })

  test("extracts file:line:col refs", () => {
    const r = summarizeToolOutput("packages/foo/bar.ts:10:5: error: unexpected token", 1)
    expect(r!.fileRefs).toContain("packages/foo/bar.ts:10:5")
  })

  test("extracts failed test names", () => {
    const r = summarizeToolOutput("FAIL src/foo.test.ts\n● suite > should work\n✗ fails", 1)
    expect(r!.failedTests.length).toBeGreaterThan(0)
  })

  test("summary contains error count", () => {
    const r = summarizeToolOutput("error: build failed\nwarning: deprecated\nsrc/foo.ts:10: error", 1)
    expect(r!.summary).toContain("error")
  })

  test("importantLines deduped", () => {
    const r = summarizeToolOutput("error: same\nerror: same\nerror: same", 1)
    expect(r!.importantLines.filter((l) => l === "error: same").length).toBe(1)
  })

  test("importantLines max 20", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `error: line ${i}`).join("\n")
    const r = summarizeToolOutput(lines, 1)
    expect(r!.importantLines.length).toBeLessThanOrEqual(20)
  })

  test("fileRefs deduped", () => {
    const r = summarizeToolOutput("src/foo.ts:10: error\nsrc/foo.ts:10: another", 1)
    expect(r!.fileRefs.filter((f) => f === "src/foo.ts:10").length).toBe(1)
  })
})
