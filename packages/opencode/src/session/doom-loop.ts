import type { MessageV2 } from "./message-v2"

export const DOOM_LOOP_THRESHOLD = 3

export function shouldAskDoomLoop(input: {
  parts: MessageV2.Part[]
  toolName: string
  toolInput: unknown
  threshold?: number
}) {
  const threshold = input.threshold ?? DOOM_LOOP_THRESHOLD
  const recent = input.parts.slice(-threshold)
  if (recent.length !== threshold) return false
  return recent.every(
    (part) =>
      part.type === "tool" &&
      part.tool === input.toolName &&
      part.state.status !== "pending" &&
      JSON.stringify(part.state.input) === JSON.stringify(input.toolInput),
  )
}
