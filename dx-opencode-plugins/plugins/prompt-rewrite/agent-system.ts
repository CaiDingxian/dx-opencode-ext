import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Agent file: `export default function(system: string[]) { ... }`
// Receives the system prompt array — push, unshift, splice, replace, whatever.
type AgentModule = {
  default?: (system: string[]) => string[] | void
}

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

// Fallback: same dir (single-file in .opencode/plugin/) → parent dir (package src/)
function resolveAgentsDir(): string {
  for (const base of [PLUGIN_DIR, path.join(PLUGIN_DIR, "..")]) {
    const dir = path.join(base, "agents")
    if (fs.existsSync(dir)) return dir
  }
  return path.join(PLUGIN_DIR, "agents")
}

async function loadAgentModules(
  agentsDir: string,
): Promise<Map<string, AgentModule>> {
  const agents = new Map<string, AgentModule>()

  if (!fs.existsSync(agentsDir)) {
    console.warn(`[agent-system] agents directory not found: ${agentsDir}`)
    return agents
  }

  console.log(`[agent-system] scanning agents directory: ${agentsDir}`)

  const entries = fs
    .readdirSync(agentsDir)
    .filter((f) => /\.(m?js)$/.test(f) && !/^[._]/.test(f))

  for (const file of entries) {
    const agentName = path.basename(file, path.extname(file))
    const filePath = path.join(agentsDir, file)

    try {
      // Use absolute file:// URL so relative imports inside agent files
      // resolve correctly (relative to the agent file's own location).
      // Cache-bust query param allows reload without restarting opencode.
      const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`
      const mod: AgentModule = await import(fileUrl)
      agents.set(agentName, mod)
      console.log(`[agent-system] loaded agent: ${agentName} (${file})`)
    } catch (err) {
      console.error(`[agent-system] failed to load ${file}:`, err)
    }
  }

  return agents
}

const server: Plugin = async (_ctx, options) => {
  const optDir = (options as any)?.agentsDir?.toString()
  const agentsDir = optDir
    ? path.resolve(_ctx.directory, optDir)
    : resolveAgentsDir()

  const agentModules = await loadAgentModules(agentsDir)

  if (agentModules.size === 0) {
    console.log("[agent-system] no agent files found, plugin inactive")
    return {}
  }

  console.log(
    `[agent-system] active agents: ${[...agentModules.keys()].join(", ")}`,
  )

  // sessionID → current agent name (captured via chat.message)
  const sessionAgentCache = new Map<string, string>()

  return {
    // Step 1: capture agent name (fires before system.transform)
    "chat.message": async (input, _output) => {
      if (input.sessionID && input.agent) {
        sessionAgentCache.set(input.sessionID, input.agent)
      }
    },

    // Step 2: apply agent-specific system prompt modifications
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return

      const agentName = sessionAgentCache.get(input.sessionID)
      if (!agentName) return

      const mod = agentModules.get(agentName)
      if (!mod) return

      if (typeof mod.default !== "function") return
      try {
        const r = mod.default(output.system)
        if (Array.isArray(r)) output.system = r
      } catch (err) {
        console.error(`[agent-system] error applying agent "${agentName}":`, err)
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        sessionAgentCache.delete((event.properties as any).sessionID)
      }
    },
  }
}

export default {
  id: "opencode-agent-system",
  server,
}
