const $ = (id) => document.getElementById(id)
const cards = [0, 1, 2].map((index) => document.getElementById("sample-panel-" + index))
let challenges = []
let pending = false
let pendingAt = 0
let currentJobAt = 0
let mode = "api"
let notice = null

function models() {
  const rows = Array.isArray(window.MAGPIE_LMFP_MODELS) ? window.MAGPIE_LMFP_MODELS : []
  const provider = (magpie.context || {}).provider
  return provider ? rows.filter((row) => row.provider === provider.id) : rows
}

function fillModels() {
  const select = $("lmfp-model")
  if (!select) return
  if (!models().length) {
    const option = document.createElement("option")
    option.textContent = "先在 magpie 里加一个供应商"
    option.value = ""
    select.replaceChildren(option)
    return
  }
  select.replaceChildren()
  const groups = new Map()
  for (const row of models()) {
    if (!groups.has(row.providerName)) groups.set(row.providerName, [])
    groups.get(row.providerName).push(row)
  }
  for (const [name, rows] of groups) {
    const group = document.createElement("optgroup")
    group.label = name
    for (const row of rows) {
      const option = document.createElement("option")
      option.value = row.id
      option.textContent = row.model
      group.append(option)
    }
    select.append(group)
  }
}

function cardParts(card) {
  if (!card) return null
  return {
    badge: card.querySelector('span[data-slot="badge"]'),
    prompt: card.querySelector("p.text-body"),
    reply: card.querySelector("textarea.fp-reply"),
    count: [...card.querySelectorAll("span, p")].find((node) => /\d+ 个数字/.test(node.textContent || "")),
    copy: [...card.querySelectorAll("button")].find((node) => (node.textContent || "").trim() === "复制"),
    expand: [...card.querySelectorAll("button")].find((node) => (node.textContent || "").trim() === "展开"),
  }
}

function numberCount(text) {
  const runs = []
  let current = []
  let previousEnd = 0
  const pattern = /\d+/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const separator = text.slice(previousEnd, match.index)
    const value = Number(match[0])
    if (current.length && /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(separator)) {
      runs.push(current)
      current = []
    }
    if (value >= 1 && value <= 355) current.push(value)
    previousEnd = match.index + match[0].length
  }
  if (current.length) runs.push(current)
  return runs.length ? Math.max(...runs.map((run) => run.length)) : 0
}

function labels() {
  return {
    pending: "请求中",
    requesting: "请求中",
    streaming: "取样中",
    complete: "已填",
    completed: "已填",
    done: "已填",
    capped: "已截断",
    truncated: "已截断",
    rejected: "出错",
    stopped: "已停止",
    cancelled: "已停止",
    failed: "出错",
  }
}

function renderChallenges() {
  challenges.forEach((challenge, index) => {
    const parts = cardParts(cards[index])
    if (!parts) return
    if (parts.prompt) parts.prompt.textContent = challenge.prompt
    if (parts.badge) parts.badge.textContent = "待填"
    if (parts.count) parts.count.textContent = "需要至少 " + Math.max(80, Math.ceil(challenge.expected_count * 0.55)) + " 个数字"
    if (parts.copy) parts.copy.onclick = () => {
      if (navigator.clipboard) navigator.clipboard.writeText(challenge.prompt).catch(() => {})
    }
    if (parts.expand && parts.prompt) {
      parts.expand.onclick = () => {
        const clamped = parts.prompt.classList.toggle("line-clamp-4")
        parts.expand.textContent = clamped ? "展开" : "收起"
      }
    }
  })
}

function paint(progress) {
  const map = labels()
  const samples = progress && Array.isArray(progress.samples) ? progress.samples : []
  challenges.forEach((challenge, index) => {
    const parts = cardParts(cards[index])
    if (!parts) return
    const sample = progress && progress.model === $("lmfp-model").value ? samples[index] : null
    if (parts.badge) {
      const running = progress && progress.model === $("lmfp-model").value && !progress.done
      const text = sample ? map[sample.phase] || sample.phase : running ? map.requesting : "待填"
      if (parts.badge.textContent !== text) parts.badge.textContent = text
    }
    if (parts.reply) {
      const text = sample && sample.reply ? sample.reply : ""
      if (text && parts.reply.value !== text) {
        parts.reply.value = text
        parts.reply.scrollTop = parts.reply.scrollHeight
      }
    }
    if (parts.count) {
      const filled = parts.reply ? numberCount(parts.reply.value) : 0
      const text = filled ? filled + " / " + challenge.expected_count + " 个数字" : "需要至少 " + Math.max(80, Math.ceil(challenge.expected_count * 0.55)) + " 个数字"
      if (parts.count.textContent !== text) parts.count.textContent = text
    }
  })
  if ($("lmfp-status")) {
    if (!progress || progress.model !== $("lmfp-model").value) {
      const waited = pendingAt ? Math.round((Date.now() - pendingAt) / 1000) : 0
      $("lmfp-status").textContent = pending
        ? (waited > 20 ? "本机助手没有接单，点开始取样重试" : "已交给本机，正在取样…")
        : ""
    } else {
      const seconds = progress.seconds ? "（已 " + progress.seconds + " 秒）" : ""
      $("lmfp-status").textContent = (progress.phase || "") + seconds
    }
  }
  const result = $("lmfp-result")
  if (result) {
    const staleForPending = pending && progress && (progress.jobAt ? progress.jobAt !== currentJobAt : true)
    if (staleForPending) {
      result.replaceChildren()
      result.hidden = true
      if ($("lmfp-after")) $("lmfp-after").hidden = true
      return
    }
    if (!progress || !progress.done || progress.model !== $("lmfp-model").value) {
      if (!pending) result.replaceChildren()
      result.hidden = currentView !== "detect"
    } else {
      result.replaceChildren(resultPanel(progress))
      result.hidden = currentView !== "detect"
    }
  }
  const sameJob = !progress || !progress.jobAt || progress.jobAt === currentJobAt
  const age = progress && progress.at ? Date.now() - Date.parse(progress.at) : 0
  const fresh = !progress || !progress.at || age < 120000
  const active = Boolean(progress && progress.model === $("lmfp-model").value && !progress.done && sameJob && fresh)
  if ($("lmfp-running")) $("lmfp-running").hidden = currentView !== "detect" || !active || stopped
  if ($("lmfp-start")) $("lmfp-start").disabled = active
  const mine = progress && (!progress.jobAt || progress.jobAt === currentJobAt)
  if (progress && progress.done && progress.model === $("lmfp-model").value && mine) {
    pending = false
    pendingAt = 0
    stopped = false
    if ($("lmfp-after")) $("lmfp-after").hidden = currentView !== "detect"
    if ($("lmfp-running")) $("lmfp-running").hidden = true
    const button = $("lmfp-start")
    if (button) button.disabled = false
  }
}

function resultPanel(progress) {
  const card = document.createElement("section")
  card.className = "fp-card flex flex-col gap-3 p-4"
  const head = document.createElement("div")
  head.className = "flex h-9 items-center justify-between gap-2"
  const title = document.createElement("span")
  title.className = "text-card-title"
  title.textContent = "结果"
  head.append(title)
  card.append(head)
  if (progress.error) {
    const line = document.createElement("p")
    line.className = "text-body text-destructive"
    line.textContent = progress.error
    card.append(line)
    return card
  }
  const ranking = Array.isArray(progress.ranking) ? progress.ranking : []
  if (!ranking.length) {
    const line = document.createElement("p")
    line.className = "text-body text-muted-foreground"
    line.textContent = progress.decision === "not_model"
      ? "相邻数字的变化方式不像语言模型（常见于按顺序、排序或程序生成），未生成排名。"
      : "这次没有产生排名"
    card.append(line)
    return card
  }
  const lead = document.createElement("p")
  lead.className = "text-body"
  const chance = typeof progress.probability === "number" ? "，归因概率 " + (progress.probability * 100).toFixed(1) + "%" : "，置信度不足"
  lead.textContent = "最接近 " + (progress.prediction || "未知") + (progress.family ? "（" + progress.family + "）" : "") + chance
  card.append(lead)
  const list = document.createElement("ol")
  list.className = "flex flex-col gap-1 text-body"
  ranking.forEach((item) => {
    const line = document.createElement("li")
    const percent = typeof item.probability === "number" ? " " + (item.probability * 100).toFixed(1) + "%" : ""
    line.textContent = (item.model || "") + (item.family ? " · " + item.family : "") + percent
    list.append(line)
  })
  card.append(list)
  return card
}

async function startRun() {
  if (!$("lmfp-model").value) {
    if ($("lmfp-status")) $("lmfp-status").textContent = "未设置模型"
    return
  }
  pending = true
  pendingAt = Date.now()
  const button = $("lmfp-start")
  if (button) button.disabled = true
  if ($("lmfp-status")) $("lmfp-status").textContent = "已交给本机，正在取样…"
  const texts = cards.map((card) => {
    const parts = cardParts(card)
    return parts && parts.reply ? parts.reply.value.trim() : ""
  })
  const manual = mode === "manual"
  if (manual && texts.filter(Boolean).length === 0) {
    pending = false
    pendingAt = 0
    if ($("lmfp-status")) $("lmfp-status").textContent = "填写至少 1 条回复后检测"
    return
  }
  const job = {
    model: $("lmfp-model").value,
    task: "fingerprint",
    manual,
    texts: manual ? texts : undefined,
    rounds: 1,
    count: challenges.length,
    format: $("lmfp-format").value,
    effort: $("lmfp-effort").value,
    parallel: $("lmfp-parallel").checked,
    tokenizer: $("lmfp-tokenizer").checked,
    challenges,
    at: Date.now(),
  }
  try {
    let saved = await magpie.options.set({ job }).catch(() => null)
    if (!saved || !saved.job) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      saved = await magpie.options.set({ job })
    }
    if (!saved || !saved.job) throw new Error("没能交给本机助手")
    currentJobAt = job.at
  } catch (error) {
    pending = false
    const button = $("lmfp-start")
    if (button) button.disabled = false
    if ($("lmfp-status")) $("lmfp-status").textContent = error && error.message ? error.message : "没能开始"
  }
}


function selectView(view) {
  const map = { detect: "view-detect", library: "lmfp-library", docs: "lmfp-docs" }
  for (const [name, id] of Object.entries(map)) {
    const node = $(id)
    if (node) node.hidden = name !== view
  }
  const detectPage = document.querySelector(".fp-page")
  if (detectPage) detectPage.hidden = view !== "detect"
  // main still holds flex space even when its only child is hidden.
  const main = document.querySelector("main")
  if (main) main.hidden = view !== "detect"
  let activeLink = null
  document.querySelectorAll(".fp-nav a").forEach((link) => {
    const label = (link.textContent || "").trim()
    const target = label === "样本库" ? "library" : label === "文档" ? "docs" : "detect"
    const active = target === view
    link.classList.toggle("active", active)
    if (active) {
      link.setAttribute("aria-current", "page")
      activeLink = link
    } else {
      link.removeAttribute("aria-current")
    }
    link.onclick = (event) => { event.preventDefault(); selectView(target) }
  })
  const indicator = document.querySelector(".fp-nav-indicator")
  if (indicator && activeLink) {
    const nav = activeLink.parentElement.getBoundingClientRect()
    const box = activeLink.getBoundingClientRect()
    indicator.style.left = Math.round(box.left - nav.left) + "px"
    indicator.style.width = Math.round(box.width) + "px"
  }
  const actionbar = document.querySelector(".fp-actionbar")
  if (actionbar) actionbar.hidden = view !== "detect"
  // These live outside .fp-page, so hide them explicitly when leaving 检测.
  currentView = view
  if ($("lmfp-actions")) $("lmfp-actions").hidden = view !== "detect"
  paint(window.MAGPIE_LMFP_PROGRESS)
  if (view === "library") renderLibrary()
  if (view === "docs") renderDocs()
}

function renderDocs() {
  const body = $("lmfp-docs-body")
  if (body && !body.textContent) body.textContent = String(window.MAGPIE_LMFP_DOCS || "文档加载失败").replace(/<[^>]+>/g, "")
}

function history() {
  return Array.isArray(window.MAGPIE_LMFP_HISTORY) ? window.MAGPIE_LMFP_HISTORY : []
}

function whenText(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function outcomeText(entry) {
  if (entry.error) return "出错"
  if (!entry.prediction) return "没有排名"
  const chance = typeof entry.probability === "number" ? " " + (entry.probability * 100).toFixed(1) + "%" : ""
  return entry.prediction + chance
}

function renderLibrary() {
  const rows = history()
  if ($("lmfp-bank-summary")) {
    const done = rows.filter((entry) => !entry.error).length
    $("lmfp-bank-summary").textContent = `本插件共记录 ${rows.length} 次检测 · 成功 ${done} 次`
  }
  const search = $("lmfp-bank-search")
  const sort = $("lmfp-bank-sort")
  if (search && !search.oninput) search.oninput = renderLibrary
  if (sort && !sort.onchange) {
    sort.replaceChildren(new Option("按时间", "at"), new Option("按模型", "model"))
    sort.onchange = renderLibrary
  }
  const familySelect = $("lmfp-bank-family")
  if (familySelect && familySelect.options.length === 0) {
    familySelect.replaceChildren(new Option("全部项目", ""))
    for (const value of ["fingerprint", "candy", "pelican"]) familySelect.append(new Option(value, value))
    familySelect.onchange = renderLibrary
  }
  const query = (search && search.value || "").trim().toLowerCase()
  const taskFilter = familySelect ? familySelect.value : ""
  const key = sort ? sort.value : "at"
  const list = rows
    .filter((entry) => (!taskFilter || entry.task === taskFilter) && (!query || String(entry.model).toLowerCase().includes(query)))
    .sort((a, b) => (key === "model" ? String(a.model).localeCompare(String(b.model)) : String(b.at).localeCompare(String(a.at))))
  const tbody = $("lmfp-bank-rows")
  if (!tbody) return
  tbody.replaceChildren()
  if (!list.length) {
    const tr = document.createElement("tr")
    const td = document.createElement("td")
    td.colSpan = 5
    td.className = "p-3 text-muted-foreground"
    td.textContent = "还没有检测记录。到「检测」页跑一次就会记在这里。"
    tr.append(td)
    tbody.append(tr)
    return
  }
  for (const entry of list) {
    const tr = document.createElement("tr")
    tr.className = "border-t border-border"
    const cells = [
      whenText(entry.at),
      entry.model,
      entry.task === "candy" ? "糖果题" : entry.task === "pelican" ? "画鹈鹕" : "指纹检测",
      outcomeText(entry),
      entry.manual ? "离线验证" : "网关取样",
    ]
    cells.forEach((value, index) => {
      const td = document.createElement("td")
      td.className = "p-3" + (index === 0 ? " text-muted-foreground" : "") + (index === 3 ? " font-medium" : "")
      td.textContent = String(value)
      tr.append(td)
    })
    tbody.append(tr)
  }
}

async function stopRun() {
  stopped = true
  let lastError = ""
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const saved = (await magpie.options.get()) || {}
      const stamp = Date.now()
      await magpie.options.set({ ...saved, stop: stamp })
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const check = (await magpie.options.get()) || {}
      if (check.stop === stamp) {
        lastError = ""
        break
      }
      lastError = "stop 未写入"
    } catch (error) {
      lastError = error && error.message ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  stopped = false
  pending = false
  pendingAt = 0
  if ($("lmfp-start")) $("lmfp-start").disabled = false
  if ($("lmfp-running")) $("lmfp-running").hidden = true
  if ($("lmfp-status")) $("lmfp-status").textContent = lastError ? "停止失败：" + lastError : "已请求停止"
}

function exportJson() {
  const progress = window.MAGPIE_LMFP_PROGRESS
  if (!progress) return
  const payload = {
    model: progress.model,
    at: progress.at,
    prediction: progress.prediction,
    family: progress.family,
    probability: progress.probability,
    ranking: progress.ranking,
    samples: progress.samples,
    error: progress.error || "",
    challenges,
  }
  const text = JSON.stringify(payload, null, 2)
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "fingerprint-" + String(progress.model).replace(/[^a-z0-9]+/gi, "-") + ".json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    if ($("lmfp-after-note")) $("lmfp-after-note").textContent = "已导出 JSON"
  } catch (error) {
    if ($("lmfp-after-note")) $("lmfp-after-note").textContent = "导出失败：" + (error.message || "浏览器不允许下载")
  }
}

async function start() {
  try { await Promise.race([magpie.ready, new Promise((resolve) => setTimeout(resolve, 1500))]) } catch {}
  fillModels()
  const count = 3
  challenges = window.MAGPIE_LMFP_CHALLENGES ? window.MAGPIE_LMFP_CHALLENGES(count) : []
  renderChallenges()
  const startButton = $("lmfp-start")
  if (startButton) startButton.addEventListener("click", () => { startRun().catch(() => {}) })
  if ($("lmfp-stop")) $("lmfp-stop").addEventListener("click", () => { stopRun().catch(() => {}) })
  if ($("lmfp-retest")) $("lmfp-retest").addEventListener("click", () => { challenges = window.MAGPIE_LMFP_CHALLENGES(challenges.length || 3); renderChallenges(); startRun().catch(() => {}) })
  if ($("lmfp-export")) $("lmfp-export").addEventListener("click", () => { exportJson() })
  for (const button of document.querySelectorAll(".fp-page [role='tab'], .fp-page button")) {
    const label = (button.textContent || "").trim()
    if (label === "手动") button.addEventListener("click", () => setMode("manual"))
    if (label === "API") button.addEventListener("click", () => setMode("api"))
    if (label === "换一组提示词") button.addEventListener("click", () => { challenges = window.MAGPIE_LMFP_CHALLENGES(challenges.length || 3); renderChallenges() })
  }
  selectView("detect")
  const reroll = [...document.querySelectorAll("button")].find((node) => (node.textContent || "").trim() === "换一组提示词")
  if (reroll) reroll.addEventListener("click", () => { challenges = window.MAGPIE_LMFP_CHALLENGES(challenges.length || 3); renderChallenges() })
  const seen = await magpie.options.get().catch(() => ({}))
  const leftover = seen && seen.progress
  paint(leftover)
  if (leftover && !leftover.done) {
    const job = seen.job
    if (job && !job.done) {
      // A job is still queued: ask the helper to stop it.
      await stopRun()
    } else {
      // Nothing is running; just show the old marker as stopped.
      paint({ ...leftover, done: true, phase: "已停止" })
      pending = false
      pendingAt = 0
    }
  }
  setInterval(() => {
    magpie.options.get().then((next) => paint(next && next.progress)).catch(() => {})
  }, 1000)
  notice = seen
}
start()
