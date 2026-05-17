/**
 * P2.5: 工具输出规则摘要
 * 对截断的工具输出做确定性提取，不使用 LLM。
 */

export interface ToolOutputSummary {
  status: "failed"
  exitCode: number
  summary: string
  importantLines: string[]
  fileRefs: string[]
  failedTests: string[]
}

const IMPORTANT_RE = /\b(error|warning|failed|fail|panic|exception|traceback|fatal|critical)\b/i
const FILE_REF_RE = /([^\s"']+[./][^\s"':]+):(\d+)(?::(\d+))?/g
const FAILED_TEST_RE = /^(?:✗|×|FAIL|●|---\s*FAIL:?)\s*(.+)/
const MAX_IMPORTANT_LINES = 20

export function summarizeToolOutput(text: string, exitCode: number): ToolOutputSummary | undefined {
  if (exitCode === 0) return undefined

  const lines = text.split("\n")

  const importantSet = new Set<string>()
  for (const line of lines) {
    if (importantSet.size >= MAX_IMPORTANT_LINES) break
    const trimmed = line.trim()
    if (trimmed && IMPORTANT_RE.test(trimmed)) importantSet.add(trimmed)
  }
  const importantLines = Array.from(importantSet)

  const fileRefSet = new Set<string>()
  for (const line of lines) {
    let match: RegExpExecArray | null
    FILE_REF_RE.lastIndex = 0
    while ((match = FILE_REF_RE.exec(line)) !== null) {
      const file = match[1]
      const lineNum = match[2]
      const col = match[3]
      if (file.startsWith("http://") || file.startsWith("https://")) continue
      fileRefSet.add(col ? `${file}:${lineNum}:${col}` : `${file}:${lineNum}`)
    }
  }
  const fileRefs = Array.from(fileRefSet)

  const failedTests: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    const match = FAILED_TEST_RE.exec(trimmed)
    if (match) {
      const name = match[1].trim()
      if (name) failedTests.push(name)
    }
  }

  const errorCount = importantLines.filter((l) => /\berror\b/i.test(l)).length
  const warnCount = importantLines.filter((l) => /\bwarning\b/i.test(l)).length
  const parts: string[] = []
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`)
  if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`)
  if (fileRefs.length > 0) parts.push(`${fileRefs.length} file ref${fileRefs.length > 1 ? "s" : ""}`)
  if (failedTests.length > 0) parts.push(`${failedTests.length} failed test${failedTests.length > 1 ? "s" : ""}`)
  const summary = parts.length > 0 ? parts.join(", ") : `exit code ${exitCode}`

  return { status: "failed", exitCode, summary, importantLines, fileRefs, failedTests }
}
