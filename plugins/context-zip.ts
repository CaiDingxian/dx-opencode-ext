import type { Plugin } from "@opencode-ai/plugin"

const PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`

export const CompactionPlugin: Plugin = async (ctx) => {
  let on = false
  return {
        "experimental.session.compacting": async(_input, output) => {
      on = true
      output.prompt = PROMPT
      output.context = []
    },
    "experimental.chat.system.transform": async(_input, output) => {
      if (!on) return
      output.system.length = 0
      on = false
    },
  }
}
