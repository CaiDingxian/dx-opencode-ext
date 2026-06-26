import type { Hooks } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

type MessageWithParts = Parameters<NonNullable<Hooks["experimental.chat.messages.transform"]>>[1]["messages"][number]
type Part = MessageWithParts["parts"][number]

const TARGET_MODELS = new Set([
  "opencode-go-diy/kimi-k2.6",
  "opencode-go/kimi-k2.6"
])
const sessionModels = new Map<string, string>()

let logPath = ""

function debug(message: string, metadata: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), message, ...metadata }) + "\n"
  // console.error(`[kimi-keep-thinking] ${line.trim()}`)
  if (!logPath) return
  try {
    appendFileSync(logPath, line, "utf8")
  } catch (error) {
    // console.error(`[kimi-keep-thinking] failed to write log: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function hasText(part: Part): part is Part & { type: "text"; text: string } {
  return part.type === "text" && typeof (part as { text?: unknown }).text === "string"
}

function hasReasoning(part: Part): part is Part & { type: "reasoning"; text: string } {
  return part.type === "reasoning" && typeof (part as { text?: unknown }).text === "string"
}

function wrapthinking(text: string) {
  return `<thinking>${text.trim()}</thinking>`
}

function mergeReasoningIntoText(message: MessageWithParts) {
  if (message.info.role !== "assistant") return false

  const thinking = message.parts.filter(hasReasoning).map((part) => part.text.trim()).filter(Boolean).join("\n\n")
  if (!thinking) return false

  const text = message.parts.find(hasText)
  if (text?.text.includes("<thinking>")) return false

  // 将历史思考内容折叠进正文，规避不支持保留思考参数的供应商。
  if (text) {
    text.text = [wrapthinking(thinking), text.text].filter(Boolean).join("\n")
  } else {
    const firstReasoning = message.parts.find(hasReasoning)!
    message.parts.unshift({
      id: firstReasoning.id,
      sessionID: firstReasoning.sessionID,
      messageID: firstReasoning.messageID,
      type: "text",
      text: wrapthinking(thinking),
      synthetic: true,
    })
  }
  message.parts = message.parts.filter((part) => !hasReasoning(part))
  return true
}

export const KeepKimiThinkingPlugin = async (input: { directory: string }): Promise<Hooks> => {
  const logDir = join(input.directory, ".opencode")
  mkdirSync(logDir, { recursive: true })
  logPath = join(logDir, "kimi-keep-thinking.log")
  // debug("plugin loaded", { targets: Array.from(TARGET_MODELS) })

  return {
    "chat.message": async (input, output) => {
      const model = output.message.model ?? input.model
      const modelID = model ? `${model.providerID}/${model.modelID}` : undefined
      if (modelID) sessionModels.set(input.sessionID, modelID)
      debug("chat.message", {
        sessionID: input.sessionID,
        messageID: input.messageID,
        modelID,
        matched: TARGET_MODELS.has(modelID ?? ""),
      })
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      const sessionID = output.messages.at(-1)?.info.sessionID
      const modelID = sessionID ? sessionModels.get(sessionID) : undefined
      if (!sessionID) {
        // debug("transform skipped: missing sessionID")
        return
      }
      if (!TARGET_MODELS.has(modelID ?? "")) {
        // debug("transform skipped: model not matched", { sessionID, modelID })
        return
      }

      let changed = 0
      for (const message of output.messages) {
        if (mergeReasoningIntoText(message)) changed++
      }

      // debug("transform completed", { sessionID, modelID, changed })
     
    },
  }
}

export default KeepKimiThinkingPlugin
