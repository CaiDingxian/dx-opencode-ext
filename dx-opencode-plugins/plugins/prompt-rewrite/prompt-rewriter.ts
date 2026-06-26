import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Rewriter 模块协议: 模块自描述匹配条件(match)与改写逻辑(default)。
// 框架在 system.transform 时遍历所有模块,命中的链式应用(前者输出作为后者输入)。
export type RewriteContext = {
  agent?: string
  model?: string // "provider/modelID",如 "opencode-go/kimi-k2.6"
  sessionID: string
}

type Rewriter = {
  name: string
  match: (ctx: RewriteContext) => boolean
  default: (system: string[], ctx: RewriteContext) => string[] | void
}

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

// 解析 rewriters 目录: 优先 options.rewritersDir(相对项目目录),否则回退插件同级/上级
function resolveDir(custom?: string, projectDir?: string): string {
  if (custom && projectDir) return path.resolve(projectDir, custom)
  for (const base of [PLUGIN_DIR, path.join(PLUGIN_DIR, "..")]) {
    const dir = path.join(base, "rewriters")
    if (fs.existsSync(dir)) return dir
  }
  return path.join(PLUGIN_DIR, "rewriters")
}

// 加载目录下所有 rewriter 模块(.js/.mjs,忽略 . 或 _ 开头的文件)
async function loadRewriters(dir: string): Promise<Rewriter[]> {
  if (!fs.existsSync(dir)) return []
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(m?js)$/.test(f) && !/^[._]/.test(f))
  const out: Rewriter[] = []
  for (const f of files) {
    // 带时间戳的 file:// URL,确保修改后可热重载
    const url = pathToFileURL(path.join(dir, f)).href + `?t=${Date.now()}`
    try {
      const mod = await import(url)
      if (typeof mod.match === "function" && typeof mod.default === "function") {
        out.push({ name: f, match: mod.match, default: mod.default })
      } else {
        console.warn(`[prompt-rewriter] ${f} 缺少 match/default 导出,已跳过`)
      }
    } catch (err) {
      console.error(`[prompt-rewriter] 加载 ${f} 失败:`, err)
    }
  }
  return out
}

const server: Plugin = async (ctx, options) => {
  const dir = resolveDir(
    (options as { rewritersDir?: string } | undefined)?.rewritersDir,
    ctx.directory,
  )
  const rewriters = await loadRewriters(dir)

  if (rewriters.length === 0) {
    console.log("[prompt-rewriter] 未找到 rewriter 模块,插件未激活")
    return {}
  }
  console.log(`[prompt-rewriter] 已加载: ${rewriters.map((r) => r.name).join(", ")}`)

  // sessionID → 上下文: chat.message 缓存,system.transform 消费
  const cache = new Map<string, RewriteContext>()

  return {
    // 捕获当前会话的 agent 与 model(此事件先于 system.transform 触发)
    "chat.message": async (input, output) => {
      if (!input.sessionID) return
      const m = output.message.model ?? input.model
      cache.set(input.sessionID, {
        sessionID: input.sessionID,
        agent: input.agent,
        model: m ? `${m.providerID}/${m.modelID}` : undefined,
      })
    },

    // 链式应用所有命中的 rewriter
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      const c = cache.get(input.sessionID)
      if (!c) return
      for (const r of rewriters) {
        try {
          if (r.match(c)) {
            const res = r.default(output.system, c)
            if (Array.isArray(res)) output.system = res
          }
        } catch (err) {
          console.error(`[prompt-rewriter] ${r.name} 执行出错:`, err)
        }
      }
    },

    // 会话删除时清理缓存
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        cache.delete((event.properties as { info: { id: string } }).info.id)
      }
    },
  }
}

export default { id: "opencode-prompt-rewriter", server }
