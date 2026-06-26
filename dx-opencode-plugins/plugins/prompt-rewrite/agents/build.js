import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MAIN_MD = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "MAIN.md"),
  "utf-8",
)

/** @param {string[]} system */
export default function (system) {
  system[0] = system[0] + MAIN_MD
}
