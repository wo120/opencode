import path from "path"

export type Risk = "low" | "medium" | "high" | "critical"
export type Decision = "allow" | "ask" | "deny"
export type ToolType = "shell" | "read" | "write" | "edit" | "apply_patch" | "webfetch" | "websearch" | "task" | "mcp"

export type Category =
  | "safe_inspection"
  | "file_write"
  | "file_delete"
  | "network"
  | "package_install"
  | "project_script_execution"
  | "git_remote_operation"
  | "credential_access"
  | "shell_obfuscation"
  | "system_modification"
  | "high_risk_project_file"

export type Review = {
  decision: Decision
  risk: Risk
  categories: Category[]
  reasons: string[]
  rememberable: boolean
}

export type CommandContext = {
  command: string
  cwd: string
  readPaths: string[]
  writePaths: string[]
}

export type FileContext = {
  cwd: string
  toolType: Exclude<ToolType, "shell">
  readPaths: string[]
  writePaths: string[]
}

const SAFE_COMMANDS = new Set(["pwd", "ls", "git status", "git diff", "git log", "rg", "grep"])
const PACKAGE_INSTALLS = new Set([
  "npm install",
  "npm add",
  "pnpm install",
  "pnpm add",
  "yarn install",
  "yarn add",
  "bun install",
  "pip install",
  "pipenv install",
  "poetry add",
  "cargo add",
  "go get",
])
const PROJECT_SCRIPTS = new Set([
  "npm test",
  "npm run",
  "pnpm test",
  "pnpm run",
  "yarn test",
  "yarn run",
  "bun test",
  "bun run",
  "make",
  "go test",
  "pytest",
  "cargo test",
])
const GIT_REMOTE = new Set(["git push", "git fetch", "git pull", "git clone", "gh pr", "gh repo"])
const DELETE_COMMANDS = new Set(["rm", "rmdir", "del", "erase", "remove-item"])
const NETWORK_COMMANDS = new Set(["curl", "wget", "fetch", "http", "https"])
const SYSTEM_COMMANDS = new Set(["sudo", "su", "chmod", "chown", "systemctl", "launchctl"])
const SAFE_CAT_COMMANDS = new Set(["cat", "type", "get-content"])

const SENSITIVE_BASENAMES = new Set([
  ".env",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "config",
])
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".crt", ".p12", ".pfx"])
const HIGH_RISK_PROJECT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Makefile",
  "Dockerfile",
  "docker-compose.yml",
  ".gitlab-ci.yml",
  "Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "go.sum",
])

export function reviewCommand(ctx: CommandContext): Review {
  const tokens = tokenize(ctx.command)
  const head = commandHead(tokens)
  const categories = new Set<Category>()
  const reasons: string[] = []

  if (hasShellObfuscation(ctx.command)) {
    categories.add("shell_obfuscation")
    reasons.push("Command uses shell chaining, redirection, substitution, eval, or background execution")
  }

  if (hasNetwork(ctx.command, head)) {
    categories.add("network")
    reasons.push("Command may access the network")
  }

  if (isRemoteCodeExecution(ctx.command)) {
    categories.add("network")
    categories.add("shell_obfuscation")
    reasons.push("Command downloads remote content and executes it")
  }

  if (DELETE_COMMANDS.has(tokens[0]?.toLowerCase() ?? "")) {
    categories.add("file_delete")
    reasons.push("Command deletes files or directories")
  }

  if (SYSTEM_COMMANDS.has(tokens[0]?.toLowerCase() ?? "")) {
    categories.add("system_modification")
    reasons.push("Command changes system or file permissions")
  }

  if (matchesAny(head, PACKAGE_INSTALLS)) {
    categories.add("package_install")
    reasons.push("Command installs or changes dependencies")
  }

  if (matchesAny(head, PROJECT_SCRIPTS)) {
    categories.add("project_script_execution")
    reasons.push("Command executes project code or package scripts")
  }

  if (matchesAny(head, GIT_REMOTE)) {
    categories.add("git_remote_operation")
    reasons.push("Command performs a Git or GitHub remote operation")
  }

  if (commandTouchesCredential(tokens) || pathsTouchCredentials(ctx.readPaths) || pathsTouchCredentials(ctx.writePaths)) {
    categories.add("credential_access")
    reasons.push("Command touches credential-like paths")
  }

  if (commandWritesFile(ctx.command)) {
    categories.add("file_write")
    reasons.push("Command writes files through shell redirection or file mutation")
  }

  if (isSafeInspection(tokens, head, categories)) {
    categories.add("safe_inspection")
    reasons.push("Command is a local read-only inspection")
  }

  return decide(categories, reasons)
}

export function reviewFileAccess(ctx: FileContext): Review {
  const categories = new Set<Category>()
  const reasons: string[] = []

  if (pathsTouchCredentials(ctx.readPaths) || pathsTouchCredentials(ctx.writePaths)) {
    categories.add("credential_access")
    reasons.push("File access touches credential-like paths")
  }

  if (ctx.writePaths.length > 0) {
    categories.add("file_write")
    reasons.push("Tool writes files")
  }

  if (ctx.writePaths.some(isHighRiskProjectFile)) {
    categories.add("high_risk_project_file")
    reasons.push("Tool writes project execution or configuration files")
  }

  if (categories.size === 0 && ctx.toolType === "read") {
    categories.add("safe_inspection")
    reasons.push("Tool reads ordinary non-sensitive project files")
  }

  const review = decide(categories, reasons)
  if (ctx.toolType === "read" && review.decision === "deny") {
    return { ...review, decision: "ask", risk: "high", rememberable: false }
  }
  return review
}

function decide(categories: Set<Category>, reasons: string[]): Review {
  const list = Array.from(categories)
  if (categories.has("credential_access") && categories.has("shell_obfuscation")) {
    return result("deny", "critical", list, reasons, false)
  }
  if (categories.has("credential_access") && !categories.has("safe_inspection")) {
    return result("deny", "critical", list, reasons, false)
  }
  if (categories.has("network") && categories.has("shell_obfuscation")) {
    return result("deny", "critical", list, reasons, false)
  }
  if (categories.has("system_modification")) {
    return result("ask", "high", list, reasons, false)
  }
  if (
    categories.has("file_delete") ||
    categories.has("package_install") ||
    categories.has("git_remote_operation") ||
    categories.has("high_risk_project_file")
  ) {
    return result("ask", "high", list, reasons, false)
  }
  if (categories.has("network") || categories.has("project_script_execution") || categories.has("file_write")) {
    return result("ask", categories.has("project_script_execution") ? "high" : "medium", list, reasons, false)
  }
  if (categories.has("shell_obfuscation")) return result("ask", "medium", list, reasons, false)
  if (categories.has("safe_inspection")) return result("allow", "low", list, reasons, true)
  return result("ask", "medium", list, reasons.length ? reasons : ["Unknown operation requires approval"], false)
}

function result(decision: Decision, risk: Risk, categories: Category[], reasons: string[], rememberable: boolean): Review {
  return {
    decision,
    risk,
    categories,
    reasons: reasons.length ? reasons : ["No risk reason recorded"],
    rememberable,
  }
}

function tokenize(command: string) {
  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return matches.map((item) => {
    if (item.length < 2) return item
    const first = item[0]
    const last = item[item.length - 1]
    if ((first === '"' || first === "'") && first === last) return item.slice(1, -1)
    return item
  })
}

function commandHead(tokens: string[]) {
  const first = tokens[0]?.toLowerCase() ?? ""
  const second = tokens[1]?.toLowerCase() ?? ""
  if (!first) return ""
  if (first === "npm" && second === "run") return [first, second, tokens[2]?.toLowerCase()].filter(Boolean).join(" ")
  if (first === "pnpm" && second === "run") return [first, second, tokens[2]?.toLowerCase()].filter(Boolean).join(" ")
  if (first === "yarn" && second === "run") return [first, second, tokens[2]?.toLowerCase()].filter(Boolean).join(" ")
  if (first === "bun" && second === "run") return [first, second, tokens[2]?.toLowerCase()].filter(Boolean).join(" ")
  return [first, second].filter(Boolean).join(" ")
}

function matchesAny(head: string, prefixes: Set<string>) {
  for (const prefix of prefixes) {
    if (head === prefix || head.startsWith(prefix + " ")) return true
  }
  return false
}

function hasShellObfuscation(command: string) {
  return /(\|\||&&|[;|`]|<|>>?|&\s*$|\$\(|\beval\b|\b(?:bash|sh)\s+-c\b)/.test(command)
}

function hasNetwork(command: string, head: string) {
  const first = head.split(" ")[0] ?? ""
  return NETWORK_COMMANDS.has(first) || /https?:\/\//i.test(command)
}

function isRemoteCodeExecution(command: string) {
  return /(?:curl|wget|https?:\/\/).*(?:\||\$\().*(?:sh|bash)\b/i.test(command) || /\b(?:bash|sh)\s+-c\b.*(?:curl|wget|https?:\/\/)/i.test(command)
}

function commandWritesFile(command: string) {
  return /(^|[^<])>>?[^>]/.test(command) || /\b(?:tee|set-content|add-content)\b/i.test(command)
}

function isSafeInspection(tokens: string[], head: string, categories: Set<Category>) {
  if (categories.size > 0) return false
  if (SAFE_COMMANDS.has(head) || SAFE_COMMANDS.has(tokens[0]?.toLowerCase() ?? "")) return true
  return SAFE_CAT_COMMANDS.has(tokens[0]?.toLowerCase() ?? "") && !tokens.slice(1).some(isSensitivePath)
}

function commandTouchesCredential(tokens: string[]) {
  return tokens.some(isSensitivePath)
}

function pathsTouchCredentials(paths: string[]) {
  return paths.some(isSensitivePath)
}

function isSensitivePath(value: string) {
  const normalized = value.replaceAll("\\", "/")
  const base = path.basename(normalized)
  if (/^\.env(?:\.|$)/.test(base) && base !== ".env.example") return true
  if (SENSITIVE_BASENAMES.has(base)) return true
  if (SENSITIVE_EXTENSIONS.has(path.extname(base))) return true
  return normalized.includes("/.ssh/") || normalized.includes("/.aws/") || normalized.includes("/.git/hooks/") || normalized.endsWith("/.git/config")
}

function isHighRiskProjectFile(value: string) {
  const normalized = value.replaceAll("\\", "/")
  const base = path.basename(normalized)
  return HIGH_RISK_PROJECT_FILES.has(base) || normalized.includes("/.github/workflows/")
}

export const AutoReview = {
  reviewCommand,
  reviewFileAccess,
}
