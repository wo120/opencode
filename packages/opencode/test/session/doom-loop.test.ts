import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { shouldAskDoomLoop } from "../../src/session/doom-loop"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const tool = (
  toolName: string,
  input: Record<string, unknown>,
  status: MessageV2.ToolState["status"] = "completed",
): MessageV2.ToolPart => ({
  id: PartID.make("prt_test"),
  messageID: MessageID.make("msg_test"),
  sessionID: SessionID.make("ses_test"),
  type: "tool",
  callID: "call_test",
  tool: toolName,
  state:
    status === "completed"
      ? { status, input, output: "ok", title: "ok", metadata: {}, time: { start: 1, end: 2 } }
      : status === "running"
        ? { status, input, time: { start: 1 } }
        : status === "error"
          ? { status, input, error: "failed", time: { start: 1, end: 2 } }
          : { status, input, raw: JSON.stringify(input) },
})

describe("shouldAskDoomLoop", () => {
  test("asks after three identical completed tool calls", () => {
    expect(
      shouldAskDoomLoop({
        parts: [
          tool("bash", { command: "pwd" }),
          tool("bash", { command: "pwd" }),
          tool("bash", { command: "pwd" }),
        ],
        toolName: "bash",
        toolInput: { command: "pwd" },
      }),
    ).toBe(true)
  })

  test("does not ask for normal read-after-edit verification", () => {
    expect(
      shouldAskDoomLoop({
        parts: [
          tool("read", { filePath: "src/a.ts" }),
          tool("edit", { filePath: "src/a.ts" }),
          tool("read", { filePath: "src/a.ts" }),
        ],
        toolName: "read",
        toolInput: { filePath: "src/a.ts" },
      }),
    ).toBe(false)
  })

  test("does not ask while a repeated tool call is still pending", () => {
    expect(
      shouldAskDoomLoop({
        parts: [
          tool("bash", { command: "pwd" }),
          tool("bash", { command: "pwd" }),
          tool("bash", { command: "pwd" }, "pending"),
        ],
        toolName: "bash",
        toolInput: { command: "pwd" },
      }),
    ).toBe(false)
  })
})
