import * as Log from "@opencode-ai/core/util/log"
import type { Category, Decision, Risk, ToolType } from "./auto-review"

const log = Log.create({ service: "permission-auto-review" })

export type Event = {
  sessionID: string
  projectID: string
  cwd: string
  toolType: ToolType
  command?: string
  readPaths: string[]
  writePaths: string[]
  decision: Decision
  risk: Risk
  reason: string
  categories: Category[]
  timestamp: number
}

export function record(event: Event) {
  log.info("decision", event)
}

export const AutoReviewAudit = {
  record,
}
