import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MAIN_MD = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "MAIN.md"),
  "utf-8",
)

// 仅对 build agent 生效
export const match = ({ agent }) => agent === "build"

// 将自定义指令追加到首段 system prompt
export default function (system) {
  system[0] += MAIN_MD
}
