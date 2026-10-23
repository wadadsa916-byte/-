import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { readFile, writeFile } from "node:fs/promises"

const root = new URL("./", import.meta.url)
const models = JSON.parse(await readFile(new URL("models.json", root), "utf8"))
const tasks = JSON.parse(await readFile(new URL("tasks.json", root), "utf8"))
const allowed = new Map(models.map((row) => [row.id, row]))

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) return fallback
  return process.argv[index + 1]
}

const model = arg("--model", "")
const task = arg("--task", "")
const variant = arg("--variant", "original")
const rounds = Math.min(3, Math.max(1, Number(arg("--rounds", "1")) || 1))
const count = Math.min(3, Math.max(1, Number(arg("--count", "3")) || 3))
const tokenizer = process.argv.includes("--tokenizer")
const effort = ["", "low", "medium", "high"].includes(arg("--effort", "")) ? arg("--effort", "") : ""
const runs = Math.min(10, Math.max(1, Number(arg("--runs", "1")) || 1))
const jobAt = Number(arg("--job-at", "0")) || 0
const gateway = process.env.MAGPIE_BASE || `http://127.0.0.1:${process.env.MAGPIE_PORT || "3425"}/v1`
const row = allowed.get(model)

if (!row) {
  console.error("这个模型不在自定义供应商列表里")
  process.exit(2)
}
if (!["candy", "fingerprint", "pelican"].includes(task)) {
  console.error("检测项目只能是 candy、fingerprint 或 pelican")
  process.exit(2)
}

function run(command, args, { onTick } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearInterval(tick)
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000) })
    child.on("error", (error) => finish({ code: 1, stdout, error: `启动失败：${error.code || error.message}` }))
    const timer = setTimeout(() => child.kill("SIGTERM"), 12 * 60 * 1000)
    const started = Date.now()
    const tick = onTick ? setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 1200) : null
    child.on("close", (code) => {
      finish({ code: code ?? 1, stdout, error: stderr.trim() })
    })
  })
}

function ask(prompt, onDelta) {
  const body = JSON.stringify({
    model,
    stream: true,
    messages: [{ role: "user", content: prompt }],
  })
  return new Promise((resolve) => {
    const child = spawn("curl", [
      "-sS", "-N", "--max-time", "180",
      `${gateway}/chat/completions`,
      "-H", "authorization: Bearer " + (process.env.MAGPIE_KEY || "magpie"),
      "-H", "content-type: application/json",
      "-d", body,
    ], { stdio: ["ignore", "pipe", "pipe"] })
    let buffer = ""
    let answer = ""
    let reasoning = ""
    let stderr = ""
    let failed = ""
    let lastByte = Date.now()
    const started = lastByte
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.stdout.on("data", (chunk) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === "[DONE]") continue
        let parsed
        try { parsed = JSON.parse(data) } catch { continue }
        if (parsed.error) failed = parsed.error.message || "网关拒绝了这次请求"
        const delta = parsed.choices?.[0]?.delta || {}
        if (delta.reasoning_content) reasoning += delta.reasoning_content
        if (typeof delta.content === "string") answer += delta.content
        if (delta.reasoning_content || delta.content) lastByte = Date.now()
        if (onDelta) onDelta({ answer, reasoning })
      }
    })
    const timer = setInterval(() => {
      const quiet = Date.now() - lastByte
      const elapsed = Date.now() - started
      if ((answer || reasoning) && quiet < 20000 && elapsed < 8 * 60 * 1000) return
      if (elapsed < 45000 && quiet < 45000) return
      child.kill("SIGTERM")
    }, 1000)
    child.on("close", (code) => {
      clearInterval(timer)
      const partial = answer || reasoning
      const stopped = code === 28 || code === 143 || /timed out/i.test(stderr)
      resolve({
        code: failed ? 1 : (partial ? 0 : (code ?? 1)),
        answer,
        reasoning,
        error: failed || (!partial && stopped ? "45 秒内没有任何返回" : ""),
      })
    })
  })
}

function textOf(raw) {
  const data = JSON.parse(raw)
  const content = data.choices?.[0]?.message?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map((part) => part.text || part.content || "").join("\n")
  }
  return ""
}

function hasStandalone21(text) {
  for (let i = 0; i + 1 < text.length; i += 1) {
    if (text[i] !== "2" || text[i + 1] !== "1") continue
    const before = i > 0 ? text[i - 1] : ""
    const after = text[i + 2] || ""
    if (!/\d/.test(before) && !/\d/.test(after)) return true
  }
  return false
}

function extractCode(answer, language) {
  const pattern = /```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n[ \t]*```/g
  const blocks = [...answer.matchAll(pattern)]
  const named = blocks.find((block) => block[1].toLowerCase() === language)
  if (named) return named[2].trim()
  const markup = blocks.find((block) => block[2].trim().startsWith("<"))
  if (markup) return markup[2].trim()
  const bare = answer.trim()
  return blocks.length === 0 && bare.startsWith("<") ? bare : ""
}


const progressFiles = ["page/progress.js", "ui/progress.js"].map((file) => new URL(file, root))
let progressAt = 0
async function publishProgress(state) {
  const now = Date.now()
  if (!state.done && now - progressAt < 1100) return
  progressAt = now
  const body = "window.MAGPIE_LMFP_PROGRESS = " + JSON.stringify({
    ...state,
    at: new Date().toISOString(),
  }) + ";\n"
  await Promise.all(progressFiles.map((file) => writeFile(file, body)))
}
let payload
if (task === "fingerprint") {
  console.log(`指纹 ${row.providerName} / ${row.model}`)
  const cli = fileURLToPath(new URL("vendor/lmfpd/bin/fpd.js", root))
  const inputFile = arg("--input", "")
  const args = [
    cli,
    ...(inputFile ? ["--input", inputFile] : [
      "-b", gateway,
    ]),
    ...(inputFile ? [] : [
    "-k", "magpie",
    "-m", model,
    "-a", ["chatcompletion", "responses", "message"].includes(arg("--format", "chatcompletion")) ? arg("--format", "chatcompletion") : "chatcompletion",
    "-n", String(rounds),
    "--count", String(count),
    "-p", process.argv.includes("--parallel") ? String(count) : "1",
    ]),
    "--json",
    "--no-update-check",
  ]
  if (effort) args.push("-e", effort)
  const challengeFile = arg("--challenges", "")
  if (challengeFile) args.push("--challenges", challengeFile)
  await publishProgress({ model, task, jobAt, phase: "正在取样", received: 0, done: false })
  const result = await run(process.execPath, args, {
    onTick: (seconds) => {
      publishProgress({ model, task, phase: "正在取样", seconds, samples: [], done: false })
    },
  })
  let parsed = null
  try { parsed = JSON.parse(result.stdout) } catch { parsed = null }
  const round = parsed && parsed.rounds && parsed.rounds[0]
  const analysis = round && round.analysis
  const sample = round && round.samples && round.samples[0]
  const ranking = (analysis && analysis.results) || []
  const top = ranking[0]
  const failure = parsed ? (sample && sample.error) || (round && round.error) : result.error
  let error = ""
  if (!parsed) error = result.error || "没有返回可解析的 JSON"
  else if (!analysis) error = failure || "这次没有产生排名"
  payload = {
    task, at: new Date().toISOString(),
    request: { model, rounds, count, format: arg("--format", "chatcompletion"), parallel: process.argv.includes("--parallel") },
    exitCode: error ? 1 : 0,
    result: error ? null : {
      status: "completed",
      prediction: analysis.prediction,
      family: analysis.family_prediction_name,
      probability: analysis.probability,
      probabilityStatus: analysis.probability_status,
      decision: analysis.decision,
      used: analysis.used_outputs,
      confidence: analysis.evidence || null,
      ranking: ranking.slice(0, 10),
      sample: sample ? { state: sample.state, count: sample.count, expected: sample.expectedCount } : null,
      samples: (round.samples || []).map((item) => ({
        phase: item.state,
        count: item.count,
        expected: item.expectedCount,
        reply: item.text || item.rawText || "",
      })),
    },
    error,
  }
} else if (task === "candy") {
  console.log(`糖果题 ${row.providerName} / ${row.model}`)
  let answer = ""
  let error = ""
  for (let run = 1; run <= runs; run += 1) {
    await publishProgress({ model, task, jobAt, phase: `第 ${run}/${runs} 次`, received: 0, done: false })
    const result = await ask(effort ? `推理强度：${effort}。\n` + tasks.candy.prompt : tasks.candy.prompt, (progress) => {
    const text = progress.answer || progress.reasoning
    process.stdout.write(`\r已收到 ${text.length} 字`)
    publishProgress({
      model, task, jobAt, phase: progress.answer ? "正在接收回答" : "正在思考",
      received: text.length, preview: text.slice(-240), done: false,
    })
  })
    answer = result.answer || result.reasoning
    error = answer ? "" : (result.error || "网关没有返回回答")
    if (answer) break
  }
  payload = {
    task, at: new Date().toISOString(),
    request: { model },
    exitCode: error ? 1 : 0,
    result: answer ? { answer, status: hasStandalone21(answer) ? "correct" : "wrong" } : null,
    error,
  }
} else {
  const item = tasks.pelican[variant]
  if (!item) {
    console.error("鹈鹕版本只能是 original 或 all-in-one")
    process.exit(2)
  }
  console.log(`画鹈鹕 ${item.label} ${row.providerName} / ${row.model}`)
  await publishProgress({ model, task, jobAt, variant: item.id, phase: "正在向网关提问", received: 0, done: false })
  const result = await ask(item.prompt, (progress) => {
    const text = progress.answer || progress.reasoning
    process.stdout.write(`\r已收到 ${text.length} 字`)
    publishProgress({
      model, task, jobAt, variant: item.id, phase: progress.answer ? "正在接收回答" : "正在思考",
      received: text.length, preview: text.slice(-240), done: false,
    })
  })
  let answer = result.answer
  let error = result.error
  if (!answer && !error) error = "网关没有返回回答"
  const code = answer ? extractCode(answer, item.language) : ""
  if (!error && !code) error = `回答里没有 ${item.language.toUpperCase()} 代码`
  const page = !code ? "" : item.language === "svg"
    ? `<!doctype html><style>html,body{height:100%;margin:0}body>svg{display:block;width:100%;height:100%}</style>${code}`
    : code
  payload = {
    task, at: new Date().toISOString(),
    request: { model, variant: item.id, label: item.label },
    exitCode: error ? 1 : 0,
    result: error ? null : { status: "completed", language: item.language, page },
    error,
  }
}

async function appendHistory(entry) {
  const file = "page/history.js"
  let history = []
  try {
    const current = await readFile(new URL(file, root), "utf8")
    const marker = "window.MAGPIE_LMFP_HISTORY = "
    if (current.startsWith(marker)) history = JSON.parse(current.slice(marker.length).replace(/;\s*$/, ""))
  } catch { history = [] }
  history.unshift(entry)
  const body = "window.MAGPIE_LMFP_HISTORY = " + JSON.stringify(history.slice(0, 200)) + ";\n"
  await Promise.all([
    writeFile(new URL("page/history.js", root), body),
    writeFile(new URL("ui/history.js", root), body),
  ])
}

const results = {}
for (const file of ["page/result.js", "ui/result.js"]) {
  try {
    const current = await readFile(new URL(file, root), "utf8")
    const marker = "window.MAGPIE_LMFP_RESULTS = "
    if (current.startsWith(marker)) Object.assign(results, JSON.parse(current.slice(marker.length).replace(/;\s*$/, "")))
  } catch { /* start a new history */ }
}
const key = `${model}:${task}${task === "pelican" ? ":" + (payload.request.variant || variant) : ""}`
results[key] = payload
const done = {
  model, task, jobAt,
  phase: payload.error ? "没有完成" : "完成",
  done: true,
  error: payload.error || "",
  status: payload.result && payload.result.status || "",
  preview: (payload.result && (payload.result.answer || payload.result.page) || "").slice(-800),
}
if (task === "fingerprint" && payload.result) {
  done.prediction = payload.result.prediction || ""
  done.family = payload.result.family || ""
  done.probability = payload.result.probability
  done.decision = payload.result.decision || ""
  done.ranking = (payload.result.ranking || []).slice(0, 8).map((item) => ({
    model: item.display_name || item.model,
    family: item.family_name || item.family,
    score: item.score,
    probability: item.probability,
  }))
  done.samples = payload.result.samples || []
}
await publishProgress(done)
if (task === "fingerprint") {
  const ranking = (payload.result && payload.result.ranking) || []
  await appendHistory({
    at: payload.at,
    task,
    model,
    manual: process.argv.includes("--input"),
    prediction: (payload.result && payload.result.prediction) || "",
    family: (payload.result && payload.result.family) || "",
    probability: payload.result ? payload.result.probability : null,
    used: (payload.result && payload.result.used) || 0,
    samples: payload.result ? (payload.result.samples || []).length : 0,
    top: ranking.slice(0, 3).map((item) => item.display_name || item.model),
    error: payload.error || "",
  })
}
const body = "window.MAGPIE_LMFP_RESULTS = " + JSON.stringify(results) + ";\n"
await Promise.all([
  writeFile(new URL("page/result.js", root), body),
  writeFile(new URL("ui/result.js", root), body),
])
if (payload.error) {
  console.error(payload.error)
  process.exit(1)
}
if (task === "candy") console.log(payload.result.status === "correct" ? "答对，出现了独立的 21。" : "答错，没有出现独立的 21。")
else if (task === "pelican") console.log("画完了。回到 magpie 点刷新结果。")
else {
  const top = payload.result.rounds?.find((round) => round?.ranking)?.ranking?.[0]
  console.log(top ? `完成。最接近 ${top.model || top.id || "未知"}。` : "完成。")
}
console.log("回到 magpie 点刷新结果。")
