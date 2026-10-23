import {
  parseNumbers
} from "./fpd-ea5f9wr0.js";

// cli/detect-options.ts
import { parseArgs } from "node:util";

// shared/completion-request.ts
var COMPLETION_TIMEOUT_MS = 250000;
var SERVICE_TIERS = ["flex", "default", "fast", "ultrafast"];
var serviceTierField = (format) => format === "anthropic" ? "speed" : "service_tier";
var SPEED_BETA = "fast-mode-2026-02-01";
var sendsSpeed = (config) => config.format === "anthropic" && config.serviceTier !== undefined && config.serviceTier !== "default";
function completionBody(config, prompt, system = "") {
  const messages = [{ role: "user", content: prompt }];
  let body = { model: config.model, messages, max_tokens: 8192, stream: config.stream ?? true };
  if (config.format === "anthropic") {
    if (system)
      body.system = system;
    if (config.effort === "none")
      body.thinking = { type: "disabled" };
    else if (config.effort && config.effort !== "default") {
      body.thinking = { type: "adaptive" };
      body.output_config = { effort: config.effort };
    }
  } else if (config.format === "responses") {
    body = { model: config.model, input: messages, max_output_tokens: 8192, stream: config.stream ?? true, store: false };
    if (system)
      body.instructions = system;
    if (config.effort && config.effort !== "default")
      body.reasoning = { effort: config.effort };
  } else {
    if (system)
      messages.unshift({ role: "system", content: system });
    if (config.effort && config.effort !== "default")
      body.reasoning_effort = config.effort;
  }
  if (config.serviceTier && config.serviceTier !== "default")
    body[serviceTierField(config.format)] = config.serviceTier;
  return body;
}

// shared/tokenizer-posterior.ts
var TOKENIZER_MODEL = {
  prior: { known: 0.8, relative: 0.1, alien: 0.1 },
  knownRates: [[0.02, 0.4], [0.06, 0.4], [0.15, 0.2]],
  relativeRates: [[0.2, 0.3], [0.4, 0.4], [0.7, 0.3]],
  narrow: 0.02,
  wide: 0.85,
  floor: 0.000001,
  offsetWindow: 3,
  alienSpread: 0.15,
  minimumProbes: 4,
  maximumProbes: 20,
  stopAt: 0.99,
  minimumGain: 0.0001,
  planned: 24
};
var logSumExp = (values) => {
  const top = Math.max(...values);
  return top === -Infinity ? top : top + Math.log(values.reduce((sum, value) => sum + Math.exp(value - top), 0));
};
var logGeometric = (distance, p) => Math.log((1 - p) / (1 + p)) + Math.abs(distance) * Math.log(p);
var logResidual = (distance, rate) => logSumExp([
  Math.log(1 - rate) + logGeometric(distance, TOKENIZER_MODEL.narrow),
  Math.log(rate) + logGeometric(distance, TOKENIZER_MODEL.wide),
  Math.log(TOKENIZER_MODEL.floor)
]);
var nearest = (delta, allowed) => allowed.reduce((best, value) => Math.abs(delta - value) < Math.abs(best) ? delta - value : best, Infinity);
var prepared = new WeakMap;
function prepare(bank) {
  let cached = prepared.get(bank);
  if (!cached) {
    const index = new Map(bank.probes.map((probe, j) => [probe.id, j]));
    const values = bank.classes.map((item) => item.counts.map((value, j) => item.alternatives?.[j] ?? [value]));
    const alienScale = bank.probes.map((_, j) => {
      const sorted = bank.classes.map((item) => item.counts[j]).sort((a, b) => a - b);
      return Math.exp(-1 / Math.max(1.5, TOKENIZER_MODEL.alienSpread * sorted[Math.floor(sorted.length / 2)]));
    });
    cached = { index, values, alienScale };
    prepared.set(bank, cached);
  }
  return cached;
}
function data(bank, observations) {
  const { index } = prepare(bank);
  return observations.map((observation) => {
    if (observation.probe === null)
      return { j: -1, tokens: observation.tokens };
    const j = index.get(observation.probe);
    if (j === undefined)
      throw new Error(`Probe text ${observation.probe} is not in the tokenizer bank.`);
    return { j, tokens: observation.tokens };
  });
}
var offsets = (baseline) => Array.from({ length: 2 * TOKENIZER_MODEL.offsetWindow + 1 }, (_, i) => baseline - TOKENIZER_MODEL.offsetWindow + i);
var allowedOf = (prepared, c, j) => j === -1 ? [0] : prepared.values[c][j];
var BASELINE_RATE = TOKENIZER_MODEL.knownRates[0][0];
function classEvidence(prepared, rows, c, grid, baseline) {
  const terms = [];
  let best = { log: -Infinity, offset: baseline };
  const prior = -Math.log(2 * TOKENIZER_MODEL.offsetWindow + 1);
  for (const offset of offsets(baseline)) {
    const residuals = rows.map((row) => nearest(row.tokens - offset, allowedOf(prepared, c, row.j)));
    for (const [rate, weight] of grid) {
      const log = residuals.reduce((sum, value, i) => sum + logResidual(value, rows[i].j === -1 ? BASELINE_RATE : rate), 0);
      terms.push(prior + Math.log(weight) + log);
      if (log > best.log)
        best = { log, offset };
    }
  }
  return { log: logSumExp(terms), offset: best.offset };
}
function alienEvidence(prepared, rows, size, baseline) {
  const prior = -Math.log(2 * TOKENIZER_MODEL.offsetWindow + 1);
  return logSumExp(offsets(baseline).map((offset) => prior + rows.reduce((sum, row) => {
    if (row.j === -1)
      return sum + logResidual(row.tokens - offset, BASELINE_RATE);
    const density = prepared.values.reduce((total, _, c) => total + Math.exp(logGeometric(nearest(row.tokens - offset, prepared.values[c][row.j]), prepared.alienScale[row.j])), 0) / size;
    return sum + Math.log(density + TOKENIZER_MODEL.floor);
  }, 0)));
}
function tokenizerPosterior(bank, observations) {
  const rows = data(bank, observations);
  const first = rows.find((row) => row.j === -1);
  if (!first)
    return null;
  const state = prepare(bank), size = bank.classes.length, prior = TOKENIZER_MODEL.prior;
  const known = bank.classes.map((_, c) => classEvidence(state, rows, c, TOKENIZER_MODEL.knownRates, first.tokens));
  const relative = bank.classes.map((_, c) => classEvidence(state, rows, c, TOKENIZER_MODEL.relativeRates, first.tokens));
  const logs = {
    known: known.map((item) => Math.log(prior.known / size) + item.log),
    relative: relative.map((item) => Math.log(prior.relative / size) + item.log),
    alien: Math.log(prior.alien) + alienEvidence(state, rows, size, first.tokens)
  };
  const evidence = logSumExp([...logs.known, ...logs.relative, logs.alien]);
  const probes = rows.filter((row) => row.j !== -1);
  const classes = bank.classes.map((item, c) => ({
    id: item.id,
    exact: Math.exp(logs.known[c] - evidence),
    related: Math.exp(logs.relative[c] - evidence),
    matched: probes.filter((row) => nearest(row.tokens - known[c].offset, state.values[c][row.j]) === 0).length,
    compared: probes.length,
    overhead: known[c].offset
  })).sort((a, b) => b.exact + b.related - a.exact - a.related);
  const labs = new Map;
  for (const [c, item] of bank.classes.entries()) {
    const lab = labs.get(item.lab) ?? { lab: item.lab, lab_name: item.lab_name, total: 0 };
    lab.total += Math.exp(logs.known[c] - evidence) + Math.exp(logs.relative[c] - evidence);
    labs.set(item.lab, lab);
  }
  const alien = Math.exp(logs.alien - evidence);
  return {
    classes,
    alien,
    answered: probes.length,
    unknown: alien + classes.reduce((sum, score) => sum + score.related, 0),
    labs: [...labs.values()].sort((a, b) => b.total - a.total)
  };
}
var PLAN_RATE = { known: 0.06, relative: 0.4 };
var PLAN_WINDOW = 24;
var densityTables = new Map;
function densityOf(distance, rate) {
  let table = densityTables.get(rate);
  if (!table) {
    table = Float64Array.from({ length: 2048 }, (_, d) => Math.exp(logResidual(d, rate)));
    densityTables.set(rate, table);
  }
  return table[Math.min(Math.abs(distance), 2047)];
}
var plans = new WeakMap;
function rootsOf(bank, state, atom, j) {
  let tables = plans.get(bank);
  if (!tables) {
    tables = bank.probes.map((_, p) => {
      const values = state.values.map((item) => item[p][0]);
      const low = Math.min(...values) - PLAN_WINDOW;
      return { low, size: Math.max(...values) + PLAN_WINDOW - low + 1, roots: new Map };
    });
    plans.set(bank, tables);
  }
  const plan = tables[j], key = `${atom.kind}:${atom.c}`;
  let roots = plan.roots.get(key);
  if (!roots) {
    const raw = Float64Array.from({ length: plan.size }, (_, i) => {
      const y = plan.low + i;
      if (atom.kind !== "alien")
        return densityOf(y - state.values[atom.c][j][0], PLAN_RATE[atom.kind]);
      return state.values.reduce((sum, item) => sum + Math.exp(logGeometric(y - item[j][0], state.alienScale[j])), 0);
    });
    const norm = raw.reduce((sum, value) => sum + value, 0);
    roots = raw.map((value) => Math.sqrt(value / norm));
    plan.roots.set(key, roots);
  }
  return roots;
}
var dot = (a, b) => {
  let sum = 0;
  for (let i = 0;i < a.length; i++)
    sum += a[i] * b[i];
  return sum;
};
var initialPlans = new WeakMap;
function nextProbes(bank, posterior, asked, count) {
  const initial = !posterior && asked.size === 0 ? initialPlans.get(bank)?.get(count) : undefined;
  if (initial)
    return [...initial];
  const state = prepare(bank);
  const position = new Map(bank.classes.map((item, c) => [item.id, c]));
  const scores = posterior?.classes.slice(0, TOKENIZER_MODEL.planned) ?? bank.classes.map((item) => ({ id: item.id, exact: 1, related: 0 }));
  const atoms = [];
  for (const score of scores) {
    const c = position.get(score.id);
    atoms.push({ group: score.id, weight: score.exact, kind: "known", c });
    if (score.related > 0)
      atoms.push({ group: "unknown", weight: score.related, kind: "relative", c });
  }
  if (posterior && posterior.alien > 0)
    atoms.push({ group: "unknown", weight: posterior.alien, kind: "alien", c: -1 });
  const total = atoms.reduce((sum, atom) => sum + atom.weight, 0) || 1;
  const pairs = [];
  for (let a = 0;a < atoms.length; a++) {
    for (let b = a + 1;b < atoms.length; b++) {
      if (atoms[a].group !== atoms[b].group)
        pairs.push({ a, b, weight: Math.sqrt(atoms[a].weight * atoms[b].weight) / total });
    }
  }
  const candidates = bank.probes.map((probe, j) => ({ id: probe.id, j })).filter((candidate) => !asked.has(candidate.id));
  const coefficients = new Map(candidates.map(({ id, j }) => {
    const roots = atoms.map((atom) => rootsOf(bank, state, atom, j));
    return [id, pairs.map(({ a, b }) => dot(roots[a], roots[b]))];
  }));
  const remaining = pairs.map(() => 1);
  const chosen = [];
  while (chosen.length < count) {
    let best;
    for (const { id } of candidates) {
      if (chosen.includes(id))
        continue;
      const bc = coefficients.get(id);
      const gain = pairs.reduce((sum, pair, t) => sum + pair.weight * remaining[t] * (1 - bc[t]), 0);
      if (!best || gain > best.gain)
        best = { id, gain };
    }
    if (!best || best.gain < TOKENIZER_MODEL.minimumGain)
      break;
    chosen.push(best.id);
    const bc = coefficients.get(best.id);
    bc.forEach((value, t) => {
      remaining[t] *= value;
    });
  }
  if (!posterior && asked.size === 0) {
    const cache = initialPlans.get(bank) ?? new Map;
    cache.set(count, [...chosen]);
    initialPlans.set(bank, cache);
  }
  return chosen;
}
var normalizeModel = (model) => model.trim().toLowerCase().replace(/^.*\//, "").replace(/:.*$/, "");
function expectedClasses(bank, model) {
  const id = normalizeModel(model);
  if (!id)
    return null;
  const vendor = bank.api_models.find((entry) => new RegExp(entry.pattern, "i").test(id));
  if (vendor)
    return { expected: vendor.class ? [vendor.class] : [], vendor: vendor.vendor, firstParty: true };
  const classes = bank.classes.filter((item) => item.aliases.some((alias) => new RegExp(alias, "i").test(id)));
  return classes.length ? { expected: classes.map((item) => item.id), vendor: classes[0].lab_name, firstParty: false } : null;
}
var classPosterior = (posterior, classes, relatives) => posterior.classes.filter((score) => classes.includes(score.id)).reduce((sum, score) => sum + score.exact + (relatives ? score.related : 0), 0);
function tokenizerVerdict(bank, posterior, model = "") {
  const byExact = posterior.classes.reduce((best, score) => score.exact > best.exact ? score : best);
  const byRelated = posterior.classes.reduce((best, score) => score.related > best.related ? score : best);
  const [kind, top, confidence] = byExact.exact >= posterior.unknown ? ["exact", byExact, byExact.exact] : byRelated.related >= posterior.alien ? ["related", byRelated, byRelated.related] : ["unknown", posterior.classes[0], posterior.unknown];
  const expected = model ? expectedClasses(bank, model) : null;
  let claim = null;
  if (expected) {
    const probability = expected.expected.length ? classPosterior(posterior, expected.expected, !expected.firstParty) : posterior.unknown;
    claim = { ...expected, probability, status: probability >= 0.9 ? "consistent" : probability <= 0.1 ? "inconsistent" : "uncertain" };
  }
  return { kind, top, confidence, claim };
}
function probingDone(posterior, maximum = TOKENIZER_MODEL.maximumProbes) {
  if (posterior.answered >= maximum)
    return true;
  if (posterior.answered < TOKENIZER_MODEL.minimumProbes)
    return false;
  const top = posterior.classes[0];
  return Math.max(top.exact, posterior.unknown) >= TOKENIZER_MODEL.stopAt;
}

// cli/detect-options.ts
var TIER_ALIASES = { f: "fast", uf: "ultrafast", slow: "flex", priority: "fast", standard: "default" };
function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return number;
}
function parseOptions(args, env = process.env) {
  const { values } = parseArgs({ args: args.map((arg) => arg === "-ns" ? "--no-stream" : arg), options: {
    model: { type: "string", short: "m" },
    apikey: { type: "string", short: "k" },
    baseurl: { type: "string", short: "b" },
    api: { type: "string", short: "a" },
    count: { type: "string" },
    parallel: { type: "string", short: "p" },
    repeat: { type: "string", short: "n" },
    strict: { type: "boolean", short: "s" },
    "no-stream": { type: "boolean" },
    timeout: { type: "string" },
    effort: { type: "string", short: "e" },
    "service-tier": { type: "string", short: "t" },
    input: { type: "string" },
    output: { type: "string" },
    bank: { type: "string" },
    challenges: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    "base-url": { type: "string" },
    "api-key": { type: "string" },
    "no-update-check": { type: "boolean" },
    tokenizer: { type: "boolean" },
    "max-probes": { type: "string" },
    "tokenizer-bank": { type: "string" }
  }, strict: true, allowPositionals: false });
  if (values.help)
    return;
  const apiInput = (values.api ?? "responses").toLowerCase();
  const api = apiInput === "cc" ? "chatcompletion" : ["responses", "chatcompletion", "message"].find((name) => name.startsWith(apiInput));
  if (!apiInput || !api)
    throw new Error("--api must be a prefix of responses, chatcompletion, or message (or cc).");
  const tierInput = (values["service-tier"] ?? "default").toLowerCase();
  const serviceTier = Object.hasOwn(TIER_ALIASES, tierInput) ? TIER_ALIASES[tierInput] : SERVICE_TIERS.find((tier) => tier.startsWith(tierInput));
  if (!tierInput || !serviceTier)
    throw new Error("--service-tier must be flex, default, fast, or ultrafast, a prefix, or an alias: f, uf, slow, priority, standard.");
  const count = positiveInteger(values.count ?? "3", "--count", 3);
  const parallel = Math.min(positiveInteger(values.parallel ?? "3", "--parallel", 3), count);
  const repeat = positiveInteger(values.repeat ?? "1", "--repeat");
  const timeout = Number(values.timeout ?? "120");
  if (!Number.isFinite(timeout) || timeout < 0.001 || timeout > 2147483.647) {
    throw new Error("--timeout must be between 0.001 and 2147483.647 seconds.");
  }
  if (values.input && (repeat !== 1 || values.challenges || values.count !== undefined)) {
    throw new Error("--input cannot be combined with --repeat, --challenges, or --count.");
  }
  if (values.strict && count !== 3) {
    throw new Error("--strict requires --count 3. Use relaxed mode for one or two samples without confidence scores.");
  }
  const maxProbes = positiveInteger(values["max-probes"] ?? String(TOKENIZER_MODEL.maximumProbes), "--max-probes", 60);
  if (maxProbes < TOKENIZER_MODEL.minimumProbes)
    throw new Error(`--max-probes must be an integer from ${TOKENIZER_MODEL.minimumProbes} to 60.`);
  const unused = (values.input ? ["tokenizer", "max-probes"] : values.tokenizer ? [] : ["max-probes", "tokenizer-bank"]).filter((name) => values[name] !== undefined).map((name) => `--${name}`);
  if (unused.length) {
    const names = unused.join(" and "), verb = unused.length === 1 ? "applies" : "apply";
    throw new Error(values.input ? `${names} ${verb} only to live detection. --input sends no requests. It shows the tokenizer probe saved in the file, if any. Remove ${names}.` : `${names} ${verb} only to the tokenizer probe. Add --tokenizer to run the probe, or remove ${names}.`);
  }
  const config = {
    model: (values.model ?? env.MODEL ?? "").trim(),
    apiKey: (values.apikey ?? values["api-key"] ?? env.API_KEY ?? "").trim(),
    baseUrl: (values.baseurl ?? values["base-url"] ?? env.BASE_URL ?? "").trim(),
    format: api === "message" ? "anthropic" : api === "chatcompletion" ? "openai" : "responses",
    serviceTier,
    stream: !values["no-stream"],
    effort: values.effort ?? ""
  };
  if (!values.input) {
    for (const [name, value, variable] of [
      ["model", config.model, "MODEL"],
      ["apikey", config.apiKey, "API_KEY"],
      ["baseurl", config.baseUrl, "BASE_URL"]
    ]) {
      if (!value)
        throw new Error(`Set --${name} or the ${variable} environment variable.`);
    }
  }
  return {
    config,
    api,
    count,
    parallel,
    repeat,
    timeoutMs: Math.round(timeout * 1000),
    strict: !!values.strict,
    json: !!values.json,
    updateCheck: !values["no-update-check"] && !env.FPD_NO_UPDATE_CHECK && !env.NO_UPDATE_NOTIFIER,
    input: values.input,
    output: values.output,
    bank: values.bank,
    challenges: values.challenges,
    tokenizer: !!values.tokenizer,
    maxProbes,
    tokenizerBank: values["tokenizer-bank"]
  };
}
function requestEndpoint(config) {
  let url;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error("Base URL must be a valid HTTP or HTTPS URL.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL must use HTTP or HTTPS without credentials, a query, or a fragment.");
  }
  const suffix = config.format === "responses" ? "/responses" : config.format === "anthropic" ? "/messages" : "/chat/completions";
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(responses|messages|chat\/completions)$/.test(path) && !path.endsWith(suffix)) {
    throw new Error("The endpoint in --baseurl does not match --api.");
  }
  url.pathname = path.endsWith(suffix) ? path : (path || "/v1") + suffix;
  return url.href;
}

// shared/throughput.ts
var MIN_WINDOW_MS = 250;
var MIN_EVENTS = 4;
var MIN_TOKENS = 16;
var USAGE_RATIO = [0.5, 2];
var USAGE_GRACE_MS = 1500;
async function readBefore(reader, deadline) {
  if (deadline === Infinity)
    return reader.read();
  let clear = () => {};
  const expired = new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - performance.now()));
    clear = () => clearTimeout(timer);
  });
  try {
    return await Promise.race([reader.read(), expired]);
  } finally {
    clear();
  }
}
function estimateTokens(text) {
  let tokens = 0;
  for (const [part] of text.matchAll(/ ?\p{L}+|\p{N}+|\s+|[^\s\p{L}\p{N}]+/gu)) {
    tokens += /\p{N}/u.test(part) ? Math.ceil(part.length / 3) : /\p{L}/u.test(part) ? Math.ceil(part.length / 4) : 1;
  }
  return tokens;
}
function outputUsage(value) {
  const usage = value && typeof value === "object" ? value : {};
  const output = usage.completion_tokens ?? usage.output_tokens;
  if (typeof output !== "number" || output <= 0)
    return;
  const reasoning = (usage.completion_tokens_details ?? usage.output_tokens_details)?.reasoning_tokens;
  return { output, reasoning: typeof reasoning === "number" ? reasoning : undefined };
}
function throughputMeter(startedAt = performance.now()) {
  let text = "", events = 0, reasoningAt, firstAt = 0, firstLength = 0, lastAt = 0;
  return {
    reasoning() {
      reasoningAt ??= performance.now();
    },
    update(value) {
      if (value.length <= text.length)
        return;
      const now = performance.now();
      if (!events) {
        firstAt = now;
        firstLength = value.length;
      }
      text = value;
      lastAt = now;
      events++;
    },
    result(usage) {
      if (!events)
        return;
      const ttftMs = firstAt - startedAt;
      const total = estimateTokens(text), share = (total - estimateTokens(text.slice(0, firstLength))) / total;
      const reported = outputUsage(usage), covers = (count) => count >= USAGE_RATIO[0] * total;
      const plausible = (count) => covers(count) && count <= USAGE_RATIO[1] * total;
      let tokens = total * share, windowMs = lastAt - firstAt, estimated = true;
      if (reported?.reasoning !== undefined) {
        const visible = reported.output - reported.reasoning;
        if (plausible(visible)) {
          tokens = visible * share;
          estimated = false;
        }
      } else if (reported && reasoningAt !== undefined && reasoningAt < firstAt) {
        if (covers(reported.output)) {
          tokens = reported.output;
          windowMs = lastAt - reasoningAt;
          estimated = false;
        }
      } else if (reported && plausible(reported.output)) {
        tokens = reported.output * share;
        estimated = false;
      }
      if (events < MIN_EVENTS || windowMs < MIN_WINDOW_MS || tokens < MIN_TOKENS)
        return { ttftMs };
      return { ttftMs, tokensPerSecond: tokens * 1000 / windowMs, ...estimated ? { estimated } : {} };
    }
  };
}

// shared/completion.ts
var coded = (message, code, extra) => Object.assign(new Error(message), { code }, extra);
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value) {
  return isObject(value) ? value : {};
}
function array(value) {
  return Array.isArray(value) ? value.map(object) : [];
}
function string(value) {
  return typeof value === "string" ? value : "";
}
var outputText = (response) => array(response.output).filter((x) => x.type === "message").flatMap((x) => array(x.content)).filter((x) => x.type === "output_text").map((x) => string(x.text)).join("");
async function readCompletion(response, format, onText, onProgress, maxNumbers, meter) {
  let text = "", raw = "", finish = "", terminal = false, ended = false, capped = false;
  let responseModel, responseId, providerReported, usage;
  const snapshot = () => ({
    text,
    responseModel,
    responseId,
    usage,
    providerReported,
    finishReason: finish || undefined,
    capped,
    completion: capped ? "truncated" : terminal && ["stop", "end_turn", "completed"].includes(finish) ? "complete" : ["length", "max_tokens", "incomplete", "max_output_tokens"].includes(finish) || ended && !terminal && text.length > 0 ? "truncated" : "unknown"
  });
  const report = () => onProgress?.(snapshot());
  const metadata = (value) => {
    const d = object(value);
    if (typeof d.model === "string")
      responseModel = d.model;
    if (typeof d.id === "string")
      responseId = d.id;
    if (typeof d.provider === "string")
      providerReported = d.provider;
    if (d.usage)
      usage = d.usage;
  };
  const emit = (part) => {
    raw += part;
    meter?.update(raw);
    if (capped)
      return;
    text += part;
    onText?.(text);
    report();
    if (maxNumbers === undefined)
      return;
    const numbers = parseNumbers(text.replace(/\d+$/, ""));
    if (numbers.length >= maxNumbers) {
      text = numbers.slice(0, maxNumbers).join(", ");
      capped = true;
    }
  };
  try {
    if (!response.ok) {
      let d;
      try {
        d = object(await response.json());
      } catch {
        throw coded(`代理不可用（HTTP ${response.status}），请确认站点包含 API 代理函数`, "proxy_unavailable", { httpStatus: response.status });
      }
      metadata(d);
      const error = object(d.error);
      throw coded(`HTTP ${response.status}：${string(error.message) || string(d.message) || "请求失败"}`, error.code === "upstream_not_api" ? "upstream_not_api" : "http", { httpStatus: response.status });
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      let d;
      try {
        d = object(await response.json());
      } catch {
        throw coded("接口未返回 JSON 或 SSE，请检查部署是否包含 API Function", "not_json");
      }
      metadata(d);
      if (format === "responses") {
        text = outputText(d);
        finish = string(d.status);
        terminal = d.status === "completed";
      } else if (format === "anthropic") {
        text = array(d.content).filter((x) => x.type === "text").map((x) => string(x.text)).join("");
        finish = string(d.stop_reason);
        terminal = true;
      } else {
        const c = array(d.choices)[0] ?? {}, message = object(c.message);
        text = string(message.content);
        finish = message.refusal ? "refusal" : string(c.finish_reason);
        terminal = true;
      }
      onText?.(text);
      report();
    } else {
      if (!response.body)
        throw coded("接口未返回流式正文", "no_stream_body");
      const reader = response.body.getReader(), decoder = new TextDecoder;
      let buffer = "";
      const event = (frame) => {
        const payload = frame.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join(`
`);
        if (!payload)
          return;
        if (payload.trim() === "[DONE]") {
          terminal = true;
          report();
          return;
        }
        let d;
        try {
          d = object(JSON.parse(payload));
        } catch {
          throw coded("流式数据不是有效的 JSON", "bad_stream_json");
        }
        const previousUsage = usage;
        metadata(d);
        metadata(d.response);
        if (d.error || d.type === "error")
          throw coded(string(object(d.error).message) || string(d.message) || "上游流式调用失败", "upstream_stream_error");
        if (format === "openai") {
          const choices = array(d.choices), c = choices.find((c) => c.index === 0) ?? choices[0] ?? {}, delta = object(c.delta);
          if (delta.reasoning_content || delta.reasoning)
            meter?.reasoning();
          if (delta.refusal)
            finish = "refusal";
          if (c.finish_reason)
            finish = string(c.finish_reason);
          if (typeof delta.content === "string")
            emit(delta.content);
        } else if (format === "anthropic") {
          const block = object(d.content_block), delta = object(d.delta);
          if (d.type === "message_start")
            metadata(d.message);
          if (block.type === "thinking" || block.type === "redacted_thinking" || delta.type === "thinking_delta")
            meter?.reasoning();
          if (d.type === "content_block_start" && block.type === "text" && block.text)
            emit(string(block.text));
          if (d.type === "content_block_delta" && delta.type === "text_delta")
            emit(string(delta.text));
          if (d.type === "message_delta") {
            finish = string(delta.stop_reason) || finish;
            usage = { ...object(previousUsage), ...object(d.usage) };
          }
          if (d.type === "message_stop")
            terminal = true;
        } else {
          if (string(d.type).startsWith("response.reasoning"))
            meter?.reasoning();
          if (d.type === "response.output_text.delta")
            emit(string(d.delta));
          if (d.type === "response.output_item.done" && !text) {
            const fallback = outputText({ output: [d.item] });
            if (fallback)
              emit(fallback);
          }
          const type = string(d.type), response = object(d.response);
          if (["response.completed", "response.failed", "response.incomplete"].includes(type)) {
            finish = string(response.status) || type.slice(9);
            terminal = type === "response.completed";
            const full = outputText(response);
            if (full && !capped) {
              text = full;
              onText?.(text);
            }
            report();
            if (!terminal)
              throw coded(string(object(response.error).message) || "Responses 输出未完整结束", "responses_incomplete");
          }
        }
        report();
      };
      let deadline = Infinity, draining = true, finishAtCap = "";
      const reading = () => !terminal && (!capped || !!meter && draining);
      const handle = (frame) => {
        if (!capped)
          return event(frame);
        try {
          event(frame);
        } catch {
          draining = false;
        }
      };
      try {
        while (reading()) {
          if (capped && deadline === Infinity) {
            deadline = performance.now() + USAGE_GRACE_MS;
            finishAtCap = finish;
          }
          const chunk = await readBefore(reader, deadline);
          if (!chunk)
            break;
          const { done, value } = chunk;
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          let match;
          while (reading() && (match = /\r?\n\r?\n/.exec(buffer))) {
            handle(buffer.slice(0, match.index));
            buffer = buffer.slice(match.index + match[0].length);
          }
          if (done) {
            if (reading() && buffer.trim())
              handle(buffer);
            break;
          }
        }
        if (deadline !== Infinity)
          finish = finishAtCap;
      } finally {
        reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    ended = true;
    if (["refusal", "content_filter"].includes(finish))
      throw coded("渠道拒绝了此请求", "refused");
    if (!capped && snapshot().completion !== "complete")
      throw coded("输出未完整结束，本条不计入检测或入库", "incomplete");
    if (maxNumbers !== undefined && !capped) {
      const numbers = parseNumbers(text);
      if (numbers.length > maxNumbers) {
        text = numbers.slice(0, maxNumbers).join(", ");
        capped = true;
      }
    }
    if (!text)
      throw coded("输出未完整结束，本条不计入检测或入库", "incomplete");
    return snapshot();
  } catch (error) {
    ended = true;
    report();
    const failure = error instanceof Error ? error : new Error(String(error));
    Object.assign(failure, { completionDetails: { ...snapshot(), finish, terminal } });
    throw failure;
  }
}

// shared/api-url.ts
function isLocalApiUrl(url) {
  const hostname = url.hostname.replace(/\.$/, "");
  if (hostname.startsWith("[")) {
    const address = hostname.slice(1, -1);
    if (address.startsWith("::ffff:")) {
      const groups = address.slice(7).split(":");
      if (groups.length !== 2)
        return false;
      const high = Number.parseInt(groups[0], 16), low = Number.parseInt(groups[1], 16);
      return isLocalIpv4([high >> 8, high & 255, low >> 8, low & 255]);
    }
    return address === "::1" || /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(address);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname))
    return isLocalIpv4(hostname.split(".").map(Number));
  return !hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)$/.test(hostname);
}
function isLocalIpv4([a, b]) {
  return a === 127 || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}

// shared/detection.ts
var coded2 = (message, code, extra) => Object.assign(new Error(message), { code }, extra);
var directTransport = (url, config, body, signal) => {
  const headers = { "Content-Type": "application/json", Accept: body.stream ? "text/event-stream" : "application/json" };
  if (config.format === "anthropic") {
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    if (sendsSpeed(config))
      headers["anthropic-beta"] = SPEED_BETA;
  } else
    headers.Authorization = "Bearer " + config.apiKey;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error" });
};
function endpoint(config) {
  let u;
  try {
    u = new URL(config.baseUrl);
  } catch {
    throw coded2("请输入有效的 Base URL", "invalid_base_url");
  }
  if (!(u.protocol === "https:" || u.protocol === "http:" && isLocalApiUrl(u)) || u.username || u.password || u.search || u.hash)
    throw coded2("Base URL 格式不正确", "invalid_base_url");
  const base = u.href.replace(/\/$/, "");
  if (config.format === "responses")
    return base.endsWith("/responses") ? base : base + (base.endsWith("/v1") ? "/responses" : "/v1/responses");
  if (config.format === "anthropic")
    return base.endsWith("/messages") ? base : base + (base.endsWith("/v1") ? "/messages" : "/v1/messages");
  return base.endsWith("/chat/completions") ? base : base + (base.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions");
}

export { COMPLETION_TIMEOUT_MS, SPEED_BETA, sendsSpeed, completionBody, TOKENIZER_MODEL, tokenizerPosterior, nextProbes, tokenizerVerdict, probingDone, parseOptions, requestEndpoint, USAGE_GRACE_MS, readBefore, throughputMeter, readCompletion, directTransport, endpoint };
