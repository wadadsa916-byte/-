import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const root = new URL("./", import.meta.url)
const webBase = `http://127.0.0.1:${process.env.MAGPIE_WEB_PORT || "3430"}`
const webLog = process.env.MAGPIE_WEB_LOG || join(homedir(), "Library/Logs/magpie-web.log")
let spec = process.env.MAGPIE_SPEC || ""
let cookie = ""
let busy = false
let running = null
const runtimeStubs = {
  "page/progress.js": "window.MAGPIE_LMFP_PROGRESS = null;\n",
  "page/result.js": "window.MAGPIE_LMFP_RESULTS = {};\n",
  "page/history.js": "window.MAGPIE_LMFP_HISTORY = [];\n",
  "ui/progress.js": "window.MAGPIE_LMFP_PROGRESS = null;\n",
  "ui/result.js": "window.MAGPIE_LMFP_RESULTS = {};\n",
  "ui/history.js": "window.MAGPIE_LMFP_HISTORY = [];\n",
}
for (const [name, body] of Object.entries(runtimeStubs)) {
  const file = new URL(name, root)
  try {
    readFileSync(file, "utf8")
  } catch {
    writeFileSync(file, body)
  }
}

const stateFile = new URL("./.watch-state.json", root)
let seen = 0
try {
  seen = JSON.parse(readFileSync(stateFile, "utf8")).lastJobAt || 0
} catch { seen = 0 }
function rememberJob(at) {
  seen = at
  try {
    writeFileSync(stateFile, JSON.stringify({ lastJobAt: at }))
  } catch (error) {
    console.error("记录已处理任务失败：" + error.message)
  }
}

function keyFromLog() {
  let text = ""
  try {
    text = readFileSync(webLog, "utf8")
  } catch {
    throw new Error(`找不到 magpie 的网页日志：${webLog}（可用 MAGPIE_WEB_LOG 指定）`)
  }
  let key = ""
  for (const line of text.split("\n")) {
    if (line.includes("3430") && line.includes("?k=")) key = line.split("?k=")[1].trim().split(/\s/)[0]
  }
  if (!key) throw new Error("magpie web 的登录链接不在日志里")
  return key
}

function spawnSyncCurl(args) {
  let stdout = ""
  let stderr = ""
  const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  return new Promise((resolve) => {
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }))
  })
}


async function resolveSpec() {
  if (spec) return spec
  if (!cookie) await signIn()
  const result = await spawnSyncCurl(["-sS", "-b", cookie, `${webBase}/api/plugin-pages`])
  if (result.status !== 0) throw new Error("读不到 magpie 的插件列表")
  let list = []
  try { list = JSON.parse(result.stdout) } catch { list = [] }
  const mine = list.find((item) => item && item.name === "magpie-lmfp")
    || list.find((item) => item && typeof item.spec === "string" && item.spec.endsWith("magpie-lmfp"))
    || (list.length === 1 ? list[0] : null)
  if (!mine || !mine.spec) throw new Error("没有找到已安装的 magpie-lmfp 插件（可用 MAGPIE_SPEC 指定）")
  spec = mine.spec
  return spec
}

async function options() {
  await resolveSpec()
  const result = await spawnSyncCurl([
    "-sS", "-b", cookie, "-H", "content-type: application/json",
    "-d", JSON.stringify({ spec }),
    `${webBase}/api/plugin-pages/options`,
  ])
  if (result.status !== 0 || result.stdout.startsWith("open the link")) {
    signIn()
    return null
  }
  return JSON.parse(result.stdout)
}

let signing = null
function signIn() {
  if (!signing) {
    signing = new Promise((resolve, reject) => {
      const jar = mkdtempSync(join(tmpdir(), "magpie-lmfp-"))
      const file = join(jar, "cookies")
      const child = spawn("curl", ["-sS", "-c", file, "-o", "/dev/null", `${webBase}/?k=${keyFromLog()}`])
      child.on("close", (status) => {
        signing = null
        if (status !== 0) return reject(new Error("登录失败"))
        const line = readFileSync(file, "utf8").split("\n").find((row) => row.includes("magpie_web_3430"))
        const value = line ? line.split("\t").at(-1).trim() : ""
        if (!value) return reject(new Error("登录没有返回 cookie"))
        cookie = `magpie_web_3430=${value}`
        rmSync(jar, { recursive: true, force: true })
        resolve()
      })
    })
  }
  return signing
}

async function publish(options) {
  const result = await spawnSyncCurl([
    "-sS", "-b", cookie, "-H", "content-type: application/json",
    "-d", JSON.stringify({ spec, options }),
    `${webBase}/api/plugin-pages/options`,
  ])
  if (result.status !== 0) throw new Error(result.stderr || "写入页面选项失败")
  return result.stdout
}

// magpie replaces the whole options object, so every write merges what must stay.
let lastPatch = 0
function readProgress() {
  try {
    const text = readFileSync(new URL("./page/progress.js", root), "utf8")
    const marker = "window.MAGPIE_LMFP_PROGRESS = "
    if (!text.startsWith(marker)) return null
    return JSON.parse(text.slice(marker.length).replace(/;\s*$/, ""))
  } catch {
    return null
  }
}

async function patch(fields) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const wait = 1100 - (Date.now() - lastPatch)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    const saved = (await options()) || {}
    const merged = { ...saved, ...fields }
    // The progress file is the source of truth: never write a stale copy back.
    if (!("progress" in fields)) {
      const current = readProgress()
      if (current) merged.progress = current
    }
    // Never drop a job the page wrote after we read the options.
    if (!("job" in fields) && saved.job) merged.job = saved.job
    lastPatch = Date.now()
    await publish(merged)
    const after = (await options()) || {}
    if (!saved.job || after.job) {
      if (!saved.job || after.job.at === merged.job.at) return
    }
  }
}

async function clear(job) {
  await patch({
    job: { ...job, done: true },
    progress: { model: job.model, task: job.task, phase: "排队中", done: false, jobAt: job.at, at: new Date().toISOString() },
  })
}

let progressSent = ""
async function mirrorProgress() {
  let progress = null
  try {
    const file = new URL("./page/progress.js", root)
    const text = readFileSync(file, "utf8")
    const marker = "window.MAGPIE_LMFP_PROGRESS = "
    if (text.startsWith(marker)) progress = JSON.parse(text.slice(marker.length).replace(/;\s*$/, ""))
  } catch { return }
  if (!progress) return
  const serialized = JSON.stringify(progress)
  if (serialized === progressSent) return
  await patch({ progress })
  progressSent = serialized
}

async function run(job) {
  const args = [fileURLToPath(new URL("./run.mjs", root)), "--model", job.model, "--task", job.task, "--job-at", String(job.at || 0)]
  if (job.task === "fingerprint" && job.manual) {
    const file = join(tmpdir(), `magpie-lmfp-manual-${job.at}.json`)
    const outputs = (job.texts || [])
      .map((value, index) => ({ text: value, expected_count: (job.challenges && job.challenges[index] && job.challenges[index].expected_count) || 300 }))
      .filter((item) => item.text && item.text.trim())
    writeFileSync(file, JSON.stringify({ outputs }))
    args.push("--input", file, "-m", job.model)
    console.log(`离线验证 ${outputs.length} 条回复`)
  } else if (job.task === "fingerprint") {
    args.push("--rounds", String(job.rounds || 1), "--count", String(job.count || 3))
    if (Array.isArray(job.challenges) && job.challenges.length === Number(job.count || 3)) {
      const file = join(tmpdir(), `magpie-lmfp-challenges-${job.at}.json`)
      writeFileSync(file, JSON.stringify(job.challenges))
      args.push("--challenges", file)
    }
    if (job.format) args.push("--format", job.format)
    if (job.parallel) args.push("--parallel")
    if (job.tokenizer) args.push("--tokenizer")
  } else if (job.task === "candy") {
    args.push("--runs", String(job.runs || 1))
    if (job.effort) args.push("--effort", job.effort)
  } else if (job.task === "pelican") {
    args.push("--variant", job.variant || "original")
    if (job.effort) args.push("--effort", job.effort)
  }
  console.log(`开始 ${job.task} ${job.model}`)
  const child = spawn(process.execPath, args, { stdio: "inherit", detached: true })
  running = child
  const code = await new Promise((resolve) => child.on("close", resolve))
  running = null
  console.log(code === 0 ? "完成" : `退出 ${code}`)
}

async function stopRun(job) {
  if (!running) return
  console.log("收到停止请求")
  try {
    process.kill(-running.pid, "SIGTERM")
  } catch {
    running.kill("SIGTERM")
  }
  await new Promise((resolve) => setTimeout(resolve, 1500))
  if (running) {
    try {
      process.kill(-running.pid, "SIGKILL")
    } catch {
      running.kill("SIGKILL")
    }
  }
  progressSent = ""
  await patch({
    job: { ...job, done: true },
    progress: { model: job.model || "", task: job.task || "fingerprint", phase: "已停止", done: true, error: "已停止" },
    stop: 0,
  })
}

async function tick() {
  if (!cookie) await signIn()
  const saved = await options()
  if (saved && saved.stop && running) {
    await stopRun(saved.job || {})
    return
  }
  if (busy) return
  const job = saved && saved.job
  if (!job || !job.model || !job.task || job.done || job.at === seen) return
  rememberJob(job.at)
  busy = true
  try {
    await clear(job)
    await run(job)
    await mirrorProgress()
    await patch({ job: { ...job, done: true } })
  } finally {
    busy = false
  }
}

try {
  const sync = spawn(process.execPath, [fileURLToPath(new URL("./sync.mjs", root))], { stdio: "ignore" })
  await new Promise((resolve) => sync.on("close", resolve))
  console.log("模型列表已与网关同步")
} catch (error) {
  console.error("同步模型列表失败：" + error.message)
}
let pendingOptions = await options().catch(() => null)
if (pendingOptions && pendingOptions.stop) {
  await patch({ stop: 0 }).catch(() => {})
  pendingOptions = await options().catch(() => null)
}
const staleProgress = pendingOptions && pendingOptions.progress
if (staleProgress && !staleProgress.done) {
  await patch({ progress: { ...staleProgress, done: true, phase: "已停止", error: "上一次取样没有结束" } }).catch(() => {})
  console.log("已把上次遗留的取样标记为停止")
}
console.log("等待页面里的开始检测")
let mirroring = false
let mirrorAt = 0
setInterval(() => {
  tick().catch((error) => console.error(error.message))
  if (mirroring) return
  mirroring = true
  if (Date.now() - mirrorAt < 5000) { mirroring = false; return }
  mirrorAt = Date.now()
  mirrorProgress()
    .catch((error) => console.error("写进度失败：" + error.message))
    .finally(() => { mirroring = false })
}, 1000)
