import { readFile, writeFile } from "node:fs/promises"

import { homedir } from "node:os"
import { join } from "node:path"

const configPath = process.env.MAGPIE_PROVIDERS || join(homedir(), ".config/magpie/providers.json")
const config = JSON.parse(await readFile(configPath, "utf8"))
const models = []
for (const row of config.providers || []) {
  if (row.preset || !row.chat) continue
  const label = row.name || row.id
  for (const model of row.models || []) {
    const id = typeof model === "string" ? model : (model.id || model.name)
    if (!id) continue
    models.push({
      id: `${row.id}/${id}`,
      model: id,
      name: `${label} · ${id}`,
      provider: row.id,
      providerName: label,
    })
  }
}
const body = "window.MAGPIE_LMFP_MODELS = " + JSON.stringify(models) + ";\n"
await writeFile(new URL("./models.json", import.meta.url), JSON.stringify(models, null, 2) + "\n")
await writeFile(new URL("./page/models.js", import.meta.url), body)
await writeFile(new URL("./ui/models.js", import.meta.url), body)
console.log(`已同步 ${models.length} 个自定义供应商模型`)
