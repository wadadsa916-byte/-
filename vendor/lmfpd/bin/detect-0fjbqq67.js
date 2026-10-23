import {
  parseNumbers,
  countNumbers,
  hellingerFeature,
  orderedBlockFeature
} from "./fpd-ea5f9wr0.js";
import {
  SPEED_BETA,
  sendsSpeed,
  completionBody,
  TOKENIZER_MODEL,
  tokenizerPosterior,
  nextProbes,
  tokenizerVerdict,
  probingDone,
  parseOptions,
  requestEndpoint,
  USAGE_GRACE_MS,
  readBefore,
  throughputMeter,
  directTransport
} from "./fpd-d52qcyvd.js";

// cli/detect.ts
import { writeFile as writeFile2 } from "node:fs/promises";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// shared/positional.ts
var WEIGHTS = [0.6, 0.15, 0.125, 0.125];
var CENTRES = Array.from({ length: 24 }, (_, i) => 1 + i * 354 / 23);
var LAGS = [1, 2, 3, 5, 8, 13, 21, 34];
var mean = (values) => values.reduce((sum, x) => sum + x, 0) / values.length;
var fraction = (length, test) => {
  let hits = 0;
  for (let i = 0;i < length; i++)
    if (test(i))
      hits++;
  return hits / length;
};
function positionKernel(x) {
  const n = x.length, out = Array(34 * 3).fill(0);
  x.forEach((value, position) => {
    const t = (position + 0.5) * 2 / n - 1, basis = [t, 0.5 * (3 * t * t - 1), 0.5 * (5 * t ** 3 - 3 * t)];
    const features = [
      ...CENTRES.map((centre) => Math.exp(-0.5 * ((value - centre) / 20) ** 2)),
      ...Array.from({ length: 10 }, (_, digit) => digit === value % 10 ? 1 : 0)
    ];
    features.forEach((weight, k) => basis.forEach((b, j) => {
      out[k * 3 + j] += weight * b / n;
    }));
  });
  return out;
}
function centredTransitions(symbols, bins) {
  const joint = Array(bins * bins).fill(0.5), total = symbols.length - 1 + 0.5 * bins * bins;
  for (let i = 1;i < symbols.length; i++)
    joint[symbols[i - 1] * bins + symbols[i]] += 1;
  for (let i = 0;i < joint.length; i++)
    joint[i] /= total;
  const rows = Array.from({ length: bins }, (_, a) => joint.slice(a * bins, a * bins + bins).reduce((s, v) => s + v, 0));
  const columns = Array.from({ length: bins }, (_, b) => rows.reduce((s, _, a) => s + joint[a * bins + b], 0));
  return joint.map((value, i) => value - rows[Math.floor(i / bins)] * columns[i % bins]);
}
function sequenceFeatures(x) {
  const n = x.length, m = mean(x), sd = Math.max(Math.sqrt(mean(x.map((v) => (v - m) ** 2))), 1);
  const s = x.map((v) => (v - m) / sd), out = [];
  for (const lag of LAGS) {
    const count = n - lag, d = Array.from({ length: count }, (_, i) => x[i + lag] - x[i]);
    out.push(mean(d.map((_, i) => s[i + lag] * s[i])), mean(d.map(Math.abs)) / 355, fraction(count, (i) => d[i] > 0), fraction(count, (i) => d[i] === 0), fraction(count, (i) => Math.abs(d[i]) <= 5), fraction(count, (i) => Math.abs(d[i]) <= 20));
  }
  out.push(...centredTransitions(x.map((v) => Math.min(7, Math.floor((v - 1) * 8 / 355))), 8));
  out.push(...centredTransitions(x.map((v) => v % 10), 10));
  const difference = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i]);
  const zStep = Array.from({ length: n - 1 }, (_, i) => Math.abs(s[i + 1] - s[i]));
  out.push(fraction(n - 2, (i) => Math.sign(difference[i + 1]) === Math.sign(difference[i])), fraction(n - 2, (i) => difference[i + 1] === difference[i]), fraction(n - 1, (i) => x[i] % 10 === x[i + 1] % 10), fraction(n - 1, (i) => zStep[i] > 1), fraction(n - 1, (i) => zStep[i] > 2));
  const buckets = x.map((v) => Math.min(15, Math.floor((v - 1) * 16 / 355)));
  for (const width of [4, 8, 16]) {
    let sum = 0;
    for (let i = 0;i + width <= n; i++)
      sum += new Set(buckets.slice(i, i + width)).size / width;
    out.push(sum / (n - width + 1));
  }
  return out;
}
function positionalDecision(numbers, head) {
  const parts = [hellingerFeature(countNumbers(numbers)), orderedBlockFeature(numbers), positionKernel(numbers), sequenceFeatures(numbers)];
  const x = parts.flatMap((block, j) => {
    const p = head.params[j], scaled = block.map((v, i) => (v - p.mean[i]) / p.scale[i]);
    const length = Math.max(Math.sqrt(scaled.reduce((sum, v) => sum + v * v, 0)), 0.000000000001);
    return scaled.map((v) => v / length * Math.sqrt(WEIGHTS[j]));
  });
  return head.weights.map((row, k) => row.reduce((sum, w, i) => sum + w * x[i], head.bias[k]));
}

// shared/shared-detector.ts
var dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
var mean2 = (a) => a.reduce((sum, x) => sum + x, 0) / a.length;
var norm = (a) => {
  const n = Math.max(Math.sqrt(dot(a, a)), 0.000000000001);
  return a.map((x) => x / n);
};
var z = (a) => {
  const m = mean2(a), s = Math.max(Math.sqrt(mean2(a.map((x) => (x - m) ** 2))), 0.000000000001);
  return a.map((x) => (x - m) / s);
};
var columnMean = (a) => a[0].map((_, i) => mean2(a.map((r) => r[i])));
var median = (a) => {
  const v = [...a].sort((x, y) => x - y), i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
};
var blocks = (n) => [hellingerFeature(countNumbers(n)), orderedBlockFeature(n)];
var transform = (b, p) => b.flatMap((v, j) => norm(v.map((x, i) => (x - p[j].mean[i]) / p[j].scale[i])).map((x) => x * Math.sqrt(j === 0 ? 0.75 : 0.25)));
var centered = (v, p) => v.map((x, i) => (x - p.feature_mean[i]) / p.feature_scale[i]);
var subtract = (v, b) => {
  const coefficients = b.map((row) => dot(v, row));
  return v.map((x, i) => x - b.reduce((sum, row, j) => sum + coefficients[j] * row[i], 0));
};
var referenceNorms = new WeakMap;
function nearest(x, references) {
  let norms = referenceNorms.get(references);
  if (!norms) {
    norms = references.map((r) => dot(r, r));
    referenceNorms.set(references, norms);
  }
  const xx = dot(x, x);
  return mean2(references.map((r, i) => Math.max(0, xx + norms[i] - 2 * dot(x, r))).sort((a, b) => a - b).slice(0, 7));
}
function baseline(b, bank) {
  const { hellinger: h, ordered_blocks: o } = bank;
  const hUnit = norm(subtract(centered(b[0], h), h.nuisance_basis));
  const marginal = h.centroids.map((row) => dot(hUnit, row));
  const oCentered = centered(b[1], o), raw = norm(oCentered), projected = norm(subtract(oCentered, o.nuisance_basis));
  const templates = o.centroids.map((_, i) => Math.max(...o.environment_centroids.map((rows) => dot(raw, rows[i]))));
  const nuisance = o.centroids.map((row) => dot(projected, row));
  const tz = z(templates), nz = z(nuisance), ordered = z(tz.map((v, i) => 0.5 * v + 0.5 * nz[i])), mz = z(marginal);
  return mz.map((v, i) => 0.5 * v + 0.5 * ordered[i]);
}
function supportsSharedDetector(bank, artifact) {
  return artifact.schema === "shared-detector-v2" && bank.built_at === artifact.bank_built_at && bank.models.length === artifact.model_ids.length && bank.models.every((m, i) => m.id === artifact.model_ids[i] && m.response_count === artifact.response_counts[i]);
}
function calibrateRanking(ranking, artifact) {
  const head = artifact.calibration, binding = head?.binding;
  if (!head || !binding || head.schema !== "shared-confidence-v2" || head.method !== "ranking-temperature" || !Number.isFinite(head.tau) || head.tau < 0.001 || head.tau > 1000 || binding.base_sha256 !== artifact.base_sha256 || binding.reference_sha256 !== artifact.source_reference_sha256 || binding.model_ids.length !== ranking.length || ranking.length !== artifact.model_ids.length || !ranking.every(Number.isFinite) || !binding.model_ids.every((id, i) => id === artifact.model_ids[i]))
    return null;
  const logits = ranking.map((score) => head.tau * score);
  const maximum = Math.max(...logits), weights = logits.map((value) => Math.exp(value - maximum)), sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((value) => value / sum);
}
function rankSharedNumbers(numbers, artifact) {
  const a = artifact.ranker, full = numbers.map(blocks);
  const ax = full.map((b) => transform(b, a.full_params));
  const lda = numbers.map((n) => {
    const x = transform(blocks(n.slice(0, 128)), a.head_params);
    return z(a.lda_weights.map((row, i) => dot(row, x) + a.lda_bias[i]));
  });
  const l = z(columnMean(lda)), near = z(a.references.map((ref) => median(ax.map((x) => -nearest(x, ref)))));
  const base = z(columnMean(full.map((b) => baseline(b, a.bank))));
  const frequency = z(l.map((x, i) => 0.5 * x + 0.25 * near[i] + 0.25 * base[i]));
  const positional = z(columnMean(numbers.map((n) => z(positionalDecision(n, a.positional)))));
  const ranking = frequency.map((x, i) => a.blend.frequency * x + a.blend.positional * positional[i]);
  if (!ranking.every(Number.isFinite))
    throw new Error("排名计算产生无效数值，请刷新后重试");
  return ranking;
}
var SEQUENCE_LIMITS = { autocorrelation: -0.23, small_step_share: 0.05 };
function sequenceShape(numbers) {
  const shapes = numbers.map((n) => {
    const m = mean2(n), variance = mean2(n.map((x) => (x - m) ** 2)), steps = n.slice(1).map((x, i) => x - n[i]);
    return {
      autocorrelation: variance ? mean2(steps.map((_, i) => (n[i + 1] - m) * (n[i] - m))) / variance : 1,
      small_step_share: mean2(steps.map((d) => Math.abs(d) <= 20 ? 1 : 0))
    };
  });
  const autocorrelation = median(shapes.map((s) => s.autocorrelation)), small_step_share = median(shapes.map((s) => s.small_step_share));
  return {
    autocorrelation,
    small_step_share,
    model_like: autocorrelation <= SEQUENCE_LIMITS.autocorrelation && small_step_share <= SEQUENCE_LIMITS.small_step_share
  };
}
function analyzeSharedOutputs(outputs, bank, artifact, options = {}) {
  if (!supportsSharedDetector(bank, artifact))
    throw new Error("The reference bank does not match the detector. Run fpd retrain --data-dir DIR for this bank.");
  const parsed = outputs.map((o) => parseNumbers(o.text));
  const diagnostics = outputs.map((o, index) => {
    const minimum = Math.max(80, Math.ceil((o.expected_count || 0) * 0.55));
    const raw = Array.from(o.text.matchAll(/-?\d+/g), (m) => Number(m[0]));
    return {
      index,
      parsed_numbers: parsed[index].length,
      minimum_numbers: minimum,
      accepted: parsed[index].length >= minimum,
      raw_out_of_range_count: raw.filter((n) => n < 1 || n > 355).length
    };
  });
  const used = diagnostics.filter((d) => d.accepted).length;
  const accepted = parsed.filter((_, i) => diagnostics[i].accepted);
  const sequence = used ? sequenceShape(accepted) : null;
  const common = {
    probability: null,
    probability_status: "unavailable",
    used_outputs: used,
    diagnostics,
    sequence,
    method: "shared-detector-v2",
    model_version: { base_sha256: artifact.base_sha256 }
  };
  const notModel = {
    ...common,
    prediction: "",
    prediction_name: "不像语言模型回答",
    family_prediction_name: "",
    results: [],
    decision: "not_model",
    evidence: {
      insufficient: true,
      label: "不像语言模型回答",
      reason: "相邻数字的变化方式与参考库中的语言模型回答不同，常见于程序生成、排序或打乱顺序的数字。未生成排名。",
      threshold: null,
      method: "sequence-shape"
    }
  };
  if (options.allowPartial && used > 0 && used < 3 && outputs.length <= 3) {
    if (!sequence.model_like)
      return notModel;
    const ranking = rankSharedNumbers(accepted, artifact);
    const order = artifact.model_ids.map((_, i) => i).sort((i, j) => ranking[j] - ranking[i]);
    const results = order.map((i) => ({
      model: artifact.model_ids[i],
      display_name: bank.models[i].display_name,
      family: bank.models[i].family,
      family_name: bank.models[i].family_name,
      score: ranking[i],
      probability: null
    }));
    const first = order[0];
    return {
      ...common,
      method: "shared-ranker-partial-v1",
      decision: "partial",
      prediction: results[0].model,
      prediction_name: results[0].display_name,
      family_prediction: bank.models[first].family,
      family_prediction_name: bank.models[first].family_name,
      results,
      ranking_score: ranking[first],
      calibration: null,
      evidence: {
        insufficient: true,
        label: "部分样本排名",
        reason: `使用 ${used}/3 条有效回答生成排名。补齐三条有效回答后才能计算置信度。`,
        threshold: null,
        method: "partial-sample-ranking"
      }
    };
  }
  if (outputs.length !== 3 || used !== 3)
    return {
      ...common,
      prediction: "",
      prediction_name: "暂不可评分",
      family_prediction_name: "",
      results: [],
      decision: "unscorable",
      evidence: {
        insufficient: true,
        label: "需要三条完整回答",
        reason: `当前有 ${used}/${outputs.length} 条有效回答。请补齐原来的三条回答后重新检测。`,
        threshold: null,
        method: "complete-three-answers"
      }
    };
  if (!sequence.model_like)
    return notModel;
  const ranking = rankSharedNumbers(parsed, artifact);
  const probabilities = calibrateRanking(ranking, artifact);
  const order = artifact.model_ids.map((_, i) => i).sort((i, j) => ranking[j] - ranking[i]);
  const results = order.map((i) => ({
    model: artifact.model_ids[i],
    display_name: bank.models[i].display_name,
    family: bank.models[i].family,
    family_name: bank.models[i].family_name,
    score: ranking[i],
    probability: probabilities?.[i] ?? null
  }));
  const first = order[0];
  return {
    ...common,
    prediction: results[0].model,
    prediction_name: results[0].display_name,
    family_prediction: bank.models[first].family,
    family_prediction_name: bank.models[first].family_name,
    results,
    ranking_score: ranking[first],
    probability: results[0].probability,
    probability_status: probabilities ? "reference_calibrated" : "unavailable",
    probability_scope: probabilities ? "reference-closed-set" : null,
    calibration: probabilities ? {
      method: artifact.calibration.method,
      run: artifact.calibration.calibration_run,
      tau: artifact.calibration.tau,
      sha256: artifact.calibration_sha256 ?? null
    } : null,
    evidence: {
      insufficient: true,
      label: probabilities ? "库内校准排名" : "未校准排名",
      reason: probabilities ? "置信度是参考库内的闭集相对概率，不包含库外模型。" : "校准参数与当前检测器不匹配，置信度不可用。候选顺序由排名分数决定。",
      threshold: null,
      method: probabilities ? "reference-calibrated-ranking" : "uncalibrated-ranking"
    }
  };
}

// shared/tokenizer-bank.ts
function assertTokenizerBank(value) {
  const bank = value;
  if (bank?.schema !== "tokenizer-bank-v1")
    throw new Error("The tokenizer bank schema must be tokenizer-bank-v1.");
  if (!Array.isArray(bank.probes) || !bank.probes.length || !Array.isArray(bank.classes) || bank.classes.length < 2) {
    throw new Error("The tokenizer bank needs a nonempty probes array and a classes array with two or more classes.");
  }
  if (typeof bank.wrapper?.prefix !== "string" || typeof bank.wrapper?.suffix !== "string") {
    throw new Error("The tokenizer bank needs wrapper.prefix and wrapper.suffix strings.");
  }
  const ids = new Set;
  for (const item of bank.classes) {
    if (ids.has(item.id))
      throw new Error(`Tokenizer class ${item.id} occurs more than one time in the tokenizer bank.`);
    ids.add(item.id);
    if (item.counts.length !== bank.probes.length || !item.counts.every(Number.isSafeInteger)) {
      throw new Error(`Tokenizer class ${item.id} needs one integer count for each probe text.`);
    }
  }
  if (!Array.isArray(bank.api_models))
    throw new Error("The tokenizer bank needs an api_models array.");
  for (const model of bank.api_models) {
    if (model.class !== null && !ids.has(model.class))
      throw new Error(`API model pattern ${model.pattern} points to class ${model.class}, which is not in the tokenizer bank.`);
  }
  const patterns = [...bank.api_models.map((model) => model.pattern), ...bank.classes.flatMap((item) => Array.isArray(item.aliases) ? item.aliases : [null])];
  for (const pattern of patterns) {
    if (typeof pattern !== "string")
      throw new Error("Each tokenizer class needs an aliases array.");
    try {
      new RegExp(pattern, "i");
    } catch (error) {
      throw new Error(`Pattern ${pattern} in the tokenizer bank is not a valid regular expression: ${error.message}`);
    }
  }
}
var wrapProbe = (bank, text) => bank.wrapper.prefix + text + bank.wrapper.suffix;

// cli/detect-request.ts
import { stripVTControlCharacters } from "node:util";
var minimumNumbers = (expected) => Math.max(80, Math.ceil(expected * 0.55));
var acceptedSample = (sample) => sample.state === "complete" || sample.state === "truncated";
var cleanText = (value) => stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
function errorMessage(error, key = "") {
  const message = error instanceof Error ? error.message : String(error);
  return cleanText(key ? message.replaceAll(key, "[REDACTED]") : message).slice(0, 500);
}
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var items = (value) => Array.isArray(value) ? value.map(record) : [];
var string = (value) => typeof value === "string" ? value : "";
var responseText = (data) => items(data.output).filter((item) => item.type === "message").flatMap((item) => items(item.content)).filter((part) => part.type === "output_text").map((part) => string(part.text)).join("");
async function requestSample(options, challenge, signal, update) {
  const { config } = options;
  const controller = new AbortController;
  const combined = AbortSignal.any([signal, controller.signal]);
  const sample = {
    state: "waiting",
    text: "",
    rawText: "",
    count: 0,
    expectedCount: challenge.expected_count,
    startedAt: Date.now()
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  let reader;
  let finish = "", terminal = false, truncated = false, raw = "", usage;
  let meter;
  const report = () => update({ ...sample });
  const metadata = (data) => {
    if (typeof data.model === "string")
      sample.responseModel = data.model;
    if (typeof data.id === "string")
      sample.responseId = data.id;
    if (data.usage)
      usage = { ...usage, ...record(data.usage) };
  };
  const acceptText = (text, final = false) => {
    sample.rawText = text;
    const numbers = parseNumbers(final ? text : text.replace(/\d+$/, ""));
    sample.count = numbers.length;
    sample.text = text;
    if (!options.strict && numbers.length >= challenge.expected_count) {
      sample.text = numbers.slice(0, challenge.expected_count).join(", ");
      sample.count = challenge.expected_count;
      truncated = !final || numbers.length > challenge.expected_count;
    }
    report();
  };
  const appendText = (part) => {
    raw += part;
    meter?.update(raw);
    if (!truncated)
      acceptText(raw);
  };
  const upstreamError = (data) => {
    if (data.error || data.type === "error") {
      throw new Error(`Upstream error: ${string(data.error?.message) || string(data.message) || string(data.error) || "Request failed."}`);
    }
  };
  const event = (frame) => {
    const payload = frame.split(/\r\n|\r|\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join(`
`);
    if (!payload)
      return;
    if (payload.trim() === "[DONE]") {
      terminal = true;
      return;
    }
    let data;
    try {
      data = record(JSON.parse(payload));
    } catch {
      throw new Error("The SSE response contains invalid JSON.");
    }
    upstreamError(data);
    metadata(data);
    if (config.format === "openai") {
      const choice = items(data.choices).find((choice) => choice.index === 0) ?? items(data.choices)[0];
      if (choice?.delta?.refusal)
        throw new Error("The model refused the request.");
      if (choice?.delta?.reasoning_content || choice?.delta?.reasoning)
        meter?.reasoning();
      if (choice?.finish_reason)
        finish = string(choice.finish_reason);
      if (typeof choice?.delta?.content === "string")
        appendText(choice.delta.content);
    } else if (config.format === "anthropic") {
      if (data.type === "message_start")
        metadata(record(data.message));
      if (["thinking", "redacted_thinking"].includes(data.content_block?.type) || data.delta?.type === "thinking_delta")
        meter?.reasoning();
      if (data.type === "content_block_start" && data.content_block?.type === "text")
        appendText(string(data.content_block.text));
      if (data.type === "content_block_delta" && data.delta?.type === "text_delta")
        appendText(string(data.delta.text));
      if (data.type === "message_delta")
        finish = string(data.delta?.stop_reason) || finish;
      if (data.type === "message_stop")
        terminal = true;
    } else {
      if (data.type === "response.created" || data.type === "response.in_progress")
        metadata(record(data.response));
      if (string(data.type).startsWith("response.reasoning"))
        meter?.reasoning();
      if (data.type === "response.output_text.delta")
        appendText(string(data.delta));
      if (data.type === "response.output_text.done" && !sample.rawText)
        acceptText(string(data.text), true);
      if (data.type === "response.output_item.done" && !sample.rawText) {
        acceptText(responseText({ output: [data.item] }), true);
      }
      if (data.type === "response.refusal.delta")
        throw new Error("The model refused the request.");
      if (data.type === "response.completed") {
        const response = record(data.response);
        metadata(response);
        terminal = true;
        finish = string(response.status) || "completed";
        const full = responseText(response);
        if (full && !truncated)
          acceptText(full, true);
      }
      if (data.type === "response.failed" || data.type === "response.incomplete") {
        throw new Error(`Responses request did not complete: ${string(data.response?.error?.message) || string(data.response?.incomplete_details?.reason) || data.type}.`);
      }
    }
    if (["refusal", "content_filter"].includes(finish))
      throw new Error("The model refused the request.");
  };
  report();
  try {
    combined.throwIfAborted();
    const headers = {
      "Content-Type": "application/json",
      Accept: config.stream ? "text/event-stream" : "application/json"
    };
    if (config.format === "anthropic") {
      headers["x-api-key"] = config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      if (sendsSpeed(config))
        headers["anthropic-beta"] = SPEED_BETA;
    } else
      headers.Authorization = `Bearer ${config.apiKey}`;
    const body = completionBody(config, challenge.prompt);
    if (config.format === "responses")
      delete body.max_output_tokens;
    else if (config.format === "openai") {
      delete body.max_tokens;
      if (body.stream)
        body.stream_options = { include_usage: true };
    }
    const init = {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: combined,
      redirect: "error",
      timeout: false
    };
    const requestStartedAt = performance.now();
    const response = await fetch(requestEndpoint(config), init);
    if (!response.ok) {
      const body = await response.text();
      let detail = body;
      try {
        const data = record(JSON.parse(body));
        detail = string(data.error?.message) || string(data.message) || body;
      } catch {}
      throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`);
    }
    if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      if (!response.body)
        throw new Error("The server returned an empty SSE body.");
      reader = response.body.getReader();
      meter = throughputMeter(requestStartedAt);
      const decoder = new TextDecoder;
      let buffer = "", deadline = Infinity, draining = true;
      const reading = () => !terminal && (!truncated || draining);
      const handle = (frame) => {
        if (!truncated)
          return event(frame);
        try {
          event(frame);
        } catch {
          draining = false;
        }
      };
      while (reading()) {
        if (truncated && deadline === Infinity)
          deadline = performance.now() + USAGE_GRACE_MS;
        const chunk = await readBefore(reader, deadline);
        if (!chunk)
          break;
        const { done, value } = chunk;
        if (value?.length && sample.firstByteMs === undefined) {
          clearTimeout(timer);
          sample.firstByteMs = Date.now() - sample.startedAt;
          sample.state = "streaming";
          report();
        }
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let boundary;
        while (reading() && (boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
          handle(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (done) {
          if (reading() && buffer.trim())
            handle(buffer);
          break;
        }
      }
    } else {
      let data;
      try {
        data = record(await response.json());
      } catch (error) {
        if (combined.aborted)
          throw error;
        throw new Error("The server did not return valid JSON or SSE.");
      }
      clearTimeout(timer);
      sample.firstByteMs = Date.now() - sample.startedAt;
      upstreamError(data);
      metadata(data);
      let text;
      if (config.format === "responses") {
        text = responseText(data);
        finish = string(data.status);
        terminal = finish === "completed";
      } else if (config.format === "anthropic") {
        text = items(data.content).filter((part) => part.type === "text").map((part) => string(part.text)).join("");
        finish = string(data.stop_reason);
        terminal = true;
      } else {
        const choice = items(data.choices)[0];
        if (choice?.message?.refusal)
          throw new Error("The model refused the request.");
        text = string(choice?.message?.content);
        finish = string(choice?.finish_reason);
        terminal = true;
      }
      if (["refusal", "content_filter"].includes(finish))
        throw new Error("The model refused the request.");
      if (!terminal || !["stop", "end_turn", "completed"].includes(finish)) {
        throw new Error(`The response did not complete (${finish || "missing finish status"}).`);
      }
      acceptText(text, true);
    }
    combined.throwIfAborted();
    if (!truncated && (!terminal || !["stop", "end_turn", "completed"].includes(finish))) {
      throw new Error(`The response did not complete (${finish || "missing finish status"}).`);
    }
    if (!truncated)
      acceptText(sample.rawText, true);
    if (sample.count < minimumNumbers(challenge.expected_count)) {
      throw new Error(`Too few valid numbers: ${sample.count}; need at least ${minimumNumbers(challenge.expected_count)}.`);
    }
    sample.state = truncated ? "truncated" : "complete";
  } catch (error) {
    sample.state = signal.aborted ? "cancelled" : "failed";
    sample.error = signal.aborted ? "Cancelled." : timedOut ? `Timed out after ${options.timeoutMs / 1000}s waiting for ${config.stream ? "the first SSE byte" : "the JSON response"}.` : errorMessage(error, config.apiKey);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    sample.finishedAt = Date.now();
    sample.throughput = meter?.result(usage);
    report();
  }
  return { ...sample };
}

// cli/detect-run.ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// shared/challenge-browser.js
function randomIndex(length) {
  const limit = Math.floor(4294967296 / length) * length;
  const buffer = new Uint32Array(1);
  do
    crypto.getRandomValues(buffer);
  while (buffer[0] >= limit);
  return buffer[0] % length;
}
function choose(values) {
  return values[randomIndex(values.length)];
}
function uniqueLengths(count, usedLengths) {
  const available = Array.from({ length: 41 }, (_, index) => 292 + index).filter((length) => !usedLengths.includes(length));
  const output = [];
  while (output.length < count)
    output.push(available.splice(randomIndex(available.length), 1)[0]);
  return output;
}
var LANGUAGES = {
  zh: {
    space: "",
    openings: [
      "这是一次独立的数值选择记录。",
      "请完成下面的无语义整数选择任务。",
      "执行一次第一反应取值记录。",
      "生成一组不承载语义的整数选择。",
      "进行一轮快速逐项取值。"
    ],
    actions: [
      "为各个位置分别凭第一反应选择",
      "逐项选择",
      "每次只决定当前一项，共给出",
      "分别凭第一反应给出",
      "逐个直接选择"
    ],
    request: (action, count) => `${action} ${count} 个 1 到 355（含端点）的整数。`,
    rules: "每个位置都要单独选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。" + "本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器；也不要先编写或运行代码。",
    endings: [
      "允许某个数字再次出现；每项写出后不要回头排序、去重或替换。",
      "偶然重复是有效的；不要重新排列或修正已经写出的项目。",
      "相同值可以再次出现；输出过程中不要整理或改写前面的项目。",
      "重复值无需删除；不要筛选、重排或补成某种规律。",
      "不必赋予数字任何含义；已经给出的值保持不变。"
    ],
    separators: [
      "数字之间用逗号或空格分隔均可。",
      "使用一种一致的常见分隔符即可。",
      "可以用逗号、空格或换行分隔。",
      "只要每个整数边界清楚，格式可自行选择。"
    ],
    start: "直接从第一个取值开始输出，不要在序列前重复数量、范围或任务说明。"
  },
  en: {
    space: " ",
    openings: [
      "This is an independent record of numerical choices.",
      "Complete the following integer-choice task, which carries no semantic meaning.",
      "Record a round of first-instinct choices.",
      "Generate a set of integer choices that carry no meaning.",
      "Make a quick round of item-by-item choices."
    ],
    actions: [
      "For each position, choose separately by first instinct",
      "Choose, item by item,",
      "Decide only the current item each time, giving a total of",
      "Give, each by first instinct,",
      "Choose directly, one by one,"
    ],
    request: (action, count) => `${action} ${count} integers from 1 to 355, inclusive.`,
    rules: "Choose separately for every position; do not count up from 1, do not increase or decrease consecutively, and do not use arithmetic progressions, cycles, repeated blocks, or other systematic patterns. " + "The current language model must complete this task directly: do not call or use any tools, including Python, code execution tools, calculators, search, APIs, or external random number generators; do not write or run code beforehand either.",
    endings: [
      "A number may appear again; after writing each item, do not go back to sort, deduplicate, or replace it.",
      "Accidental repetitions are valid; do not rearrange or correct items already written.",
      "The same value may appear again; do not organize or rewrite earlier items while producing the output.",
      "Repeated values do not need to be removed; do not filter, reorder, or fill the sequence into a pattern.",
      "Do not assign meaning to the numbers; keep values already given unchanged."
    ],
    separators: [
      "Separate the numbers with commas or spaces.",
      "Use one consistent common separator.",
      "You may separate the numbers with commas, spaces, or line breaks.",
      "Choose any format that clearly separates each integer."
    ],
    start: "Start the output directly with the first chosen value; do not repeat the count, range, or task instructions before the sequence."
  },
  ja: {
    space: "",
    openings: [
      "これは独立した数値選択の記録です。",
      "意味を持たない次の整数選択課題を完了してください。",
      "直感で選んだ値を記録してください。",
      "意味を持たない整数の選択を一組生成してください。",
      "一項目ずつ素早く値を選んでください。"
    ],
    actions: [
      "各位置について個別に直感で、",
      "一項目ずつ、",
      "毎回その時点の一項目だけを決めて、",
      "それぞれ直感で、",
      "一つずつ直接、"
    ],
    request: (action, count) => `${action}1 から 355 まで（両端を含む）の整数を ${count} 個選んでください。`,
    rules: "各位置の値は個別に選んでください。1 から順に数えたり、連続して増加または減少させたりせず、等差数列、周期、同じブロックの繰り返し、その他の規則的なパターンも使わないでください。" + "この課題は現在の言語モデル自身が直接行ってください。Python、コード実行ツール、計算機、検索、API、外部の乱数生成器など、いかなるツールも呼び出したり利用したりしないでください。事前にコードを書いたり実行したりすることも禁止します。",
    endings: [
      "同じ数字が再び現れてもかまいません。各項目を書いた後に戻って、並べ替え、重複の削除、置き換えをしないでください。",
      "偶然の重複は有効です。すでに書いた項目を並べ替えたり修正したりしないでください。",
      "同じ値が再び出てもかまいません。出力の途中で前の項目を整理したり書き換えたりしないでください。",
      "重複した値を削除する必要はありません。選別、並べ替え、規則的なパターンへの補完をしないでください。",
      "数字に意味を持たせる必要はありません。すでに出した値は変えないでください。"
    ],
    separators: [
      "数字はコンマまたは空白で区切ってください。",
      "一般的な区切り文字を一種類、統一して使ってください。",
      "コンマ、空白、改行のいずれかで数字を区切ってください。",
      "各整数の区切りが明確であれば、形式は自由です。"
    ],
    start: "選んだ最初の値から直接出力を始め、数列の前に個数、範囲、課題の説明を繰り返さないでください。"
  },
  ko: {
    space: " ",
    openings: [
      "이것은 독립적인 수치 선택 기록입니다.",
      "다음의 의미 없는 정수 선택 과제를 완료하세요.",
      "첫 직감에 따른 값 선택을 한 번 기록하세요.",
      "의미를 담지 않은 정수 선택을 한 세트 생성하세요.",
      "항목별로 빠르게 값을 고르는 라운드를 진행하세요."
    ],
    actions: [
      "각 위치마다 첫 직감으로 따로",
      "항목별로",
      "매번 현재 항목 하나만 정하면서",
      "각각 첫 직감으로",
      "하나씩 바로"
    ],
    request: (action, count) => `${action} 1부터 355까지(양 끝 포함)의 정수 ${count}개를 고르세요.`,
    rules: "각 위치의 값은 따로 고르세요. 1부터 차례로 세지 말고, 연속으로 증가하거나 감소하지 말며, 등차수열, 순환, 반복되는 블록 또는 그 밖의 규칙적인 패턴도 사용하지 마세요. " + "이 과제는 현재 언어 모델이 직접 수행해야 합니다. Python, 코드 실행기, 계산기, 검색, API, 외부 난수 생성기를 포함한 어떤 도구도 호출하거나 이용하지 마세요. 미리 코드를 작성하거나 실행하지도 마세요.",
    endings: [
      "같은 숫자가 다시 나와도 됩니다. 각 항목을 쓴 뒤 되돌아가서 정렬하거나 중복을 제거하거나 바꾸지 마세요.",
      "우연한 중복도 유효합니다. 이미 쓴 항목을 다시 배열하거나 고치지 마세요.",
      "같은 값이 다시 나와도 됩니다. 출력하는 동안 앞의 항목을 정리하거나 고쳐 쓰지 마세요.",
      "중복된 값을 지울 필요는 없습니다. 걸러 내거나 다시 배열하거나 어떤 규칙에 맞춰 채우지 마세요.",
      "숫자에 어떤 의미도 부여할 필요가 없습니다. 이미 제시한 값은 그대로 두세요."
    ],
    separators: [
      "숫자는 쉼표나 공백으로 구분하면 됩니다.",
      "일반적인 구분 기호 하나를 일관되게 사용하세요.",
      "쉼표, 공백 또는 줄바꿈으로 구분할 수 있습니다.",
      "각 정수의 경계만 분명하면 형식은 자유롭게 정해도 됩니다."
    ],
    start: "고른 첫 번째 값부터 바로 출력하고, 수열 앞에 개수, 범위 또는 과제 설명을 반복하지 마세요."
  },
  fr: {
    space: " ",
    openings: [
      "Ceci est un relevé indépendant de choix numériques.",
      "Veuillez accomplir la tâche suivante de choix d’entiers sans signification sémantique.",
      "Consignez une série de choix faits au premier réflexe.",
      "Générez une série de choix d’entiers dépourvus de sens.",
      "Effectuez une série rapide de choix, élément par élément."
    ],
    actions: [
      "Pour chaque position, choisissez séparément au premier réflexe",
      "Choisissez, élément par élément,",
      "À chaque étape, décidez uniquement de la valeur actuelle, pour donner au total",
      "Donnez séparément au premier réflexe",
      "Choisissez directement, un par un,"
    ],
    request: (action, count) => `${action} ${count} entiers compris entre 1 et 355, bornes incluses.`,
    rules: "Choisissez séparément pour chaque position ; ne comptez pas à partir de 1, ne produisez pas de valeurs consécutives croissantes ou décroissantes, et ne suivez pas de progression arithmétique, de cycle, de blocs répétés ou d’autre motif systématique. " + "Le modèle de langage actuel doit accomplir cette tâche directement : n’appelez et n’utilisez aucun outil, notamment Python, un exécuteur de code, une calculatrice, une recherche, une API ou un générateur externe de nombres aléatoires ; n’écrivez et n’exécutez pas de code au préalable.",
    endings: [
      "Un nombre peut réapparaître ; après avoir écrit chaque élément, ne revenez pas en arrière pour le trier, supprimer les doublons ou le remplacer.",
      "Les répétitions accidentelles sont valides ; ne réorganisez et ne corrigez pas les éléments déjà écrits.",
      "Une même valeur peut réapparaître ; pendant la sortie, ne réorganisez et ne réécrivez pas les éléments précédents.",
      "Les valeurs répétées n’ont pas besoin d’être supprimées ; ne filtrez pas, ne réordonnez pas et ne complétez pas la séquence pour former un motif.",
      "N’attribuez aucune signification aux nombres ; gardez inchangées les valeurs déjà données."
    ],
    separators: [
      "Séparez les nombres par des virgules ou des espaces.",
      "Utilisez un séparateur courant et cohérent.",
      "Vous pouvez séparer les nombres par des virgules, des espaces ou des retours à la ligne.",
      "Choisissez librement le format, pourvu que la limite de chaque entier soit claire."
    ],
    start: "Commencez directement par la première valeur choisie, sans répéter le nombre d’éléments, l’intervalle ou les consignes avant la séquence."
  }
};
var TEMPLATES = Object.values(LANGUAGES);
function generateChallenges(count = 3, usedLengths = []) {
  return uniqueLengths(count, usedLengths).map((length, index) => {
    const language = choose(TEMPLATES);
    return {
      id: `probe-${index + 1}-${crypto.randomUUID()}`,
      expected_count: length,
      prompt: [
        choose(language.openings),
        language.request(choose(language.actions), length),
        language.rules,
        choose(language.endings),
        choose(language.separators),
        language.start
      ].join(language.space)
    };
  });
}

// shared/detector-codec.ts
function decodeDetector(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLength = view.getUint32(0, true), start = Math.ceil((4 + headerLength) / 4) * 4;
  const count = (data.length - start) / 4;
  const raw = new Uint8Array(count * 4);
  for (let i = 0;i < count; i++)
    for (let b = 0;b < 4; b++)
      raw[i * 4 + b] = data[start + b * count + i];
  const little = new DataView(raw.buffer), floats = new Float32Array(count);
  for (let i = 0;i < count; i++)
    floats[i] = little.getFloat32(i * 4, true);
  return JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + headerLength)), (_, value) => value && typeof value === "object" && ("$f32" in value) ? Array.from(floats.subarray(value.$f32, value.$f32 + value.n)) : value);
}

// shared/tokenizer-usage.ts
var coded = (message, code, extra) => Object.assign(new Error(message), { code }, extra);
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
var text = (value) => typeof value === "string" ? value : "";
function inputTokens(usage, format) {
  const value = object(usage);
  if (format === "openai")
    return count(value.prompt_tokens);
  const base = count(value.input_tokens);
  if (format === "responses" || base === undefined)
    return base;
  return base + (count(value.cache_creation_input_tokens) ?? 0) + (count(value.cache_read_input_tokens) ?? 0);
}
function parse(payload) {
  try {
    return object(JSON.parse(payload));
  } catch {
    throw coded("The API response is not valid JSON.", "bad_stream_json");
  }
}
function httpError(status, body) {
  const trimmed = body.trim();
  let data = {};
  if (trimmed.startsWith("{")) {
    try {
      data = object(JSON.parse(trimmed));
    } catch {
      data = {};
    }
  }
  const error = object(data.error);
  const detail = text(error.message) || text(data.message) || trimmed.slice(0, 300);
  return coded(`HTTP ${status}${detail ? `: ${detail}` : ""}`, error.code === "upstream_not_api" ? "upstream_not_api" : "http", { httpStatus: status });
}
async function readUsage(response, format) {
  if (!response.ok)
    throw httpError(response.status, await response.text());
  const usage = {};
  let responseModel, terminal = false;
  const merge = (value) => {
    for (const [key, field] of Object.entries(object(value)))
      if (count(field) !== undefined)
        usage[key] = field;
  };
  const accept = (data) => {
    if (data.error || data.type === "error")
      throw coded(text(object(data.error).message) || text(data.message) || "The API stream sent an error event.", "upstream_stream_error");
    const response = object(data.response), message = object(data.message);
    if (format === "responses" && (data.type === "response.failed" || response.status === "failed")) {
      throw coded(text(object(response.error).message) || "The API reported a failed response.", "upstream_stream_error");
    }
    responseModel = text(data.model) || text(response.model) || text(message.model) || responseModel;
    if (format === "anthropic") {
      merge(message.usage);
      if (data.type !== "message_start")
        merge(data.usage);
    } else if (format === "responses")
      merge(data.usage ?? response.usage);
    else if (data.usage)
      merge(data.usage);
    terminal ||= data.type === "message_stop" || data.type === "response.completed" || data.type === "response.incomplete";
  };
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    accept(parse(await response.text()));
  else {
    if (!response.body)
      throw coded("The API stream has no body.", "no_stream_body");
    const reader = response.body.getReader(), decoder = new TextDecoder;
    let buffer = "";
    const frame = (value) => {
      const payload = value.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join(`
`);
      if (payload.trim() === "[DONE]")
        terminal = true;
      else if (payload)
        accept(parse(payload));
    };
    const settled = () => terminal && inputTokens(usage, format) !== undefined;
    try {
      while (!settled()) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let match;
        while (!settled() && (match = /\r?\n\r?\n/.exec(buffer))) {
          frame(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
        if (done) {
          if (!settled() && buffer.trim())
            frame(buffer);
          break;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const tokens = inputTokens(usage, format);
  if (tokens === undefined)
    throw coded("The API response has no input token count in usage. The tokenizer probe needs this count.", "no_usage");
  return { inputTokens: tokens, responseModel };
}

// shared/tokenizer-probe.ts
var PROBE_OUTPUT_TOKENS = 16;
var PROBE_TIMEOUT_MS = 90000;
var coded2 = (message, code, extra) => Object.assign(new Error(message), { code }, extra);
function tokenizerReport(run, bank, meta) {
  return {
    schema: "fpd-tokenizer-v1",
    created_at: new Date(meta.createdAt).toISOString(),
    model: meta.model || undefined,
    bank: { generated_at: bank.generated_at, classes: bank.classes.length, probes: bank.probes.length, archive_manifest_sha256: bank.source.archive_manifest_sha256 },
    cancelled: run.error?.code === "aborted",
    error: run.error ? { code: run.error.code, message: run.error.message, http_status: run.error.httpStatus } : undefined,
    baseline_drift: run.baselineDrift,
    steps: run.steps,
    observations: run.observations,
    verdict: run.verdict,
    unknown: run.posterior?.unknown,
    labs: run.posterior?.labs.slice(0, 5),
    classes: run.posterior?.classes.slice(0, 10)
  };
}
function probeBody(config, bank, text) {
  const body = completionBody({ ...config, effort: config.format === "anthropic" ? "" : config.effort }, wrapProbe(bank, text));
  if (config.format === "anthropic")
    body.max_tokens = PROBE_OUTPUT_TOKENS;
  else
    delete body[config.format === "responses" ? "max_output_tokens" : "max_tokens"];
  if (config.format === "openai" && body.stream)
    body.stream_options = { include_usage: true };
  return body;
}
function failure(error, signal, timeout, timeoutMs, key) {
  if (signal?.aborted)
    return coded2("The probe request was stopped.", "aborted");
  if (timeout.aborted)
    return coded2(`The API did not answer within ${timeoutMs / 1000} seconds.`, "timeout");
  if (error instanceof TypeError)
    return coded2("Cannot connect to the API. Check the base URL and the network.", "network");
  const known = error instanceof Error ? error : coded2(String(error), "network");
  if (key)
    known.message = known.message.replaceAll(key, "[REDACTED]");
  return known;
}
async function probeTokenizer(config, bank, options) {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const maximum = options.maximumProbes ?? TOKENIZER_MODEL.maximumProbes;
  const run = { steps: [], observations: [], posterior: null, verdict: null, baselineDrift: false };
  const texts = new Map(bank.probes.map((probe) => [probe.id, probe.text]));
  const asked = new Set;
  const emit = () => options.onUpdate?.({ ...run, steps: run.steps.map((step) => ({ ...step })), observations: [...run.observations] });
  async function ask(probe) {
    const text = probe === null ? "" : texts.get(probe);
    if (text === undefined)
      throw new Error(`Probe text ${probe} is not in the tokenizer bank.`);
    const step = { probe, state: "requesting" };
    run.steps.push(step);
    if (probe !== null)
      asked.add(probe);
    emit();
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      const body = probeBody(config, bank, text);
      const usage = await readUsage(await options.transport(options.url, config, body, signal), config.format);
      Object.assign(step, { state: "done", tokens: usage.inputTokens, responseModel: usage.responseModel });
      run.observations.push({ probe, tokens: usage.inputTokens, responseModel: usage.responseModel });
      run.posterior = tokenizerPosterior(bank, run.observations);
    } catch (error) {
      const reason = failure(error, options.signal, timeout, timeoutMs, config.apiKey);
      Object.assign(step, { state: "failed", error: reason.message, errorCode: reason.code, httpStatus: reason.httpStatus });
      run.error ??= reason;
    }
    emit();
  }
  const batch = async (probes) => {
    await Promise.all(probes.map(ask));
    return !run.error;
  };
  if (await batch([null, ...nextProbes(bank, null, asked, Math.min(concurrency - 1, maximum))])) {
    while (run.posterior && !probingDone(run.posterior, maximum)) {
      const next = nextProbes(bank, run.posterior, asked, Math.min(concurrency, maximum - run.posterior.answered));
      if (!next.length || !await batch(next))
        break;
    }
    if (!run.error && await batch([null])) {
      const baselines = run.observations.filter((observation) => observation.probe === null).map((observation) => observation.tokens);
      run.baselineDrift = new Set(baselines).size > 1;
    }
  }
  if (run.posterior && run.posterior.answered > 0)
    run.verdict = tokenizerVerdict(bank, run.posterior, config.model);
  emit();
  return run;
}

// cli/detect-run.ts
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Cannot read valid JSON from ${path}.`);
  }
}
async function readDetector(bankPath) {
  const path = bankPath ? join(dirname(bankPath), "shared_detector.bin") : fileURLToPath(new URL("../data/shared_detector.bin", import.meta.url));
  try {
    return decodeDetector(await readFile(path));
  } catch {
    throw new Error(`Cannot read the detector from ${path}.${bankPath ? " Run fpd retrain --data-dir for this bank first." : ""}`);
  }
}
async function loadChallenges(path, count = 3) {
  if (!path)
    return;
  const data = await readJson(path);
  if (!Array.isArray(data) || data.length !== count || !data.every((item) => item && typeof item.id === "string" && typeof item.prompt === "string" && item.prompt.trim() && Number.isSafeInteger(item.expected_count) && item.expected_count > 0)) {
    throw new Error(`The challenge file must contain ${count} challenge object${count === 1 ? "" : "s"} matching --count, each with id, prompt, and a positive integer expected_count.`);
  }
  return data;
}
function englishAnalysis(analysis) {
  let label, reason;
  if (analysis.decision === "unscorable") {
    label = "Not enough valid samples";
    reason = `Received ${analysis.used_outputs}/3 valid samples. Three valid samples are required.`;
  } else if (analysis.decision === "not_model") {
    label = "Not like a language model reply";
    reason = "Consecutive numbers change differently from the language-model replies in the reference bank. Program-generated, sorted or shuffled numbers often do this. No ranking was produced.";
  } else if (analysis.decision === "partial") {
    label = "Partial sample ranking";
    reason = `Ranked ${analysis.used_outputs} valid sample${analysis.used_outputs === 1 ? "" : "s"}. Confidence requires three valid samples.`;
  } else if (analysis.probability_status === "reference_calibrated") {
    label = "Calibrated ranking";
    reason = "Confidence is a closed-set probability within the reference bank.";
  } else {
    label = "Uncalibrated ranking";
    reason = "The confidence calibration does not match this detector. Confidence is unavailable.";
  }
  return {
    ...analysis,
    prediction_name: analysis.decision === "unscorable" ? "Not scored" : analysis.decision === "not_model" ? "Not a model reply" : analysis.prediction_name,
    evidence: { ...analysis.evidence, label, reason }
  };
}
function scoreRound(round, options, bank, detector) {
  round.outputs = round.samples.map((sample) => ({
    text: acceptedSample(sample) ? sample.text : "",
    expected_count: sample.expectedCount
  }));
  const accepted = round.samples.filter(acceptedSample).length;
  if (!accepted || options.strict && accepted !== 3) {
    round.error = options.strict ? `Strict mode requires 3/3 successful samples; received ${accepted}/3.` : "No valid samples. This round cannot be scored.";
    return;
  }
  try {
    round.analysis = englishAnalysis(analyzeSharedOutputs(round.outputs, bank, detector, { allowPartial: !options.strict }));
    if (!round.analysis.results.length)
      round.error = round.analysis.evidence.reason;
  } catch {
    round.error = "Scoring failed. Check that the reference bank and detector files are valid.";
  }
}
async function runDetection(options, bank, detector, onUpdate, signal, fixedChallenges, tokenizerBank) {
  const state = { rounds: [], total: options.repeat, startedAt: Date.now(), cancelled: false };
  const report = () => onUpdate({ ...state, rounds: state.rounds.map((round) => ({ ...round, samples: [...round.samples] })) });
  const probing = options.tokenizer && tokenizerBank && probeTokenizer(options.config, tokenizerBank, {
    url: requestEndpoint(options.config),
    transport: directTransport,
    signal,
    maximumProbes: options.maxProbes,
    concurrency: options.parallel > 1 ? 4 : 1,
    onUpdate: (run) => {
      state.tokenizer = run;
      report();
    }
  }).then((run) => {
    state.tokenizer = run;
    state.tokenizerSettled = true;
    report();
  });
  if (probing) {
    state.tokenizerSettled = false;
    state.tokenizerModel = options.config.model;
  }
  report();
  for (let index = 0;index < options.repeat; index++) {
    if (signal.aborted)
      break;
    const challenges = fixedChallenges ?? generateChallenges(options.count);
    const round = {
      index: index + 1,
      challenges,
      outputs: [],
      startedAt: Date.now(),
      samples: challenges.map((challenge) => ({
        state: "queued",
        text: "",
        rawText: "",
        count: 0,
        expectedCount: challenge.expected_count
      }))
    };
    state.rounds.push(round);
    report();
    let next = 0;
    const worker = async () => {
      while (!signal.aborted && next < challenges.length) {
        const sampleIndex = next++;
        round.samples[sampleIndex] = await requestSample(options, challenges[sampleIndex], signal, (sample) => {
          round.samples[sampleIndex] = sample;
          report();
        });
      }
    };
    await Promise.all(Array.from({ length: options.parallel }, worker));
    if (signal.aborted) {
      for (const sample of round.samples) {
        if (sample.state === "queued") {
          sample.state = "cancelled";
          sample.error = "Cancelled before dispatch.";
        }
      }
      round.outputs = round.samples.map((sample) => ({ text: acceptedSample(sample) ? sample.text : "", expected_count: sample.expectedCount }));
      round.error = "Cancelled. This round was not scored.";
    } else
      scoreRound(round, options, bank, detector);
    round.finishedAt = Date.now();
    report();
  }
  state.cancelled = signal.aborted;
  state.roundsFinishedAt = Date.now();
  report();
  if (probing)
    await probing;
  state.finishedAt = Date.now();
  report();
  return state;
}
function savedProbe(source, tokenizerBank, model) {
  const saved = source?.tokenizer;
  if (!saved)
    return;
  const observations = saved.observations;
  if (!Array.isArray(observations) || !observations.every((item) => item && (item.probe === null || typeof item.probe === "string") && Number.isSafeInteger(item.tokens))) {
    throw new Error("The tokenizer object in the input file needs an observations array. Each item needs probe (a string or null) and tokens (an integer).");
  }
  const known = new Set(tokenizerBank.probes.map((probe) => probe.id));
  const usable = observations.filter((item) => item.probe === null || known.has(item.probe));
  const skipped = observations.length - usable.length;
  const missing = new Set(observations.flatMap((item) => item.probe === null || known.has(item.probe) ? [] : [item.probe]));
  const posterior = tokenizerPosterior(tokenizerBank, usable);
  const baselines = observations.filter((item) => item.probe === null).map((item) => item.tokens);
  const request = source?.request;
  const claimed = model || (typeof saved.model === "string" ? saved.model : typeof request?.model === "string" ? request.model : "");
  const warning = skipped ? `The tokenizer bank has no probe text with the ID${missing.size === 1 ? "" : "s"} ${[...missing].join(", ")}. FPD skipped ${skipped} saved count${skipped === 1 ? "" : "s"}.` + (posterior?.answered ? "" : " No probe text count remains, so there is no tokenizer result.") : undefined;
  return {
    model: claimed,
    warning,
    run: {
      steps: observations.map((item) => ({ probe: item.probe, state: "done", tokens: item.tokens, responseModel: item.responseModel })),
      observations,
      posterior,
      baselineDrift: new Set(baselines).size > 1,
      verdict: posterior && posterior.answered > 0 ? tokenizerVerdict(tokenizerBank, posterior, claimed) : null
    }
  };
}
async function analyzeInput(options, bank, detector, tokenizerBank) {
  const data = await readJson(options.input);
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
  const probe = tokenizerBank ? savedProbe(source, tokenizerBank, options.config.model) : undefined;
  let entries = Array.isArray(source?.rounds) ? source.rounds : [data];
  if (source?.schema_version === 1 && source.purpose === "reference" && Array.isArray(source.samples)) {
    const groups = new Map;
    for (const sample of source.samples) {
      if (!sample || typeof sample.condition !== "string" || !["complete", "truncated", "unknown"].includes(sample.completion)) {
        throw new Error("Collection samples must record their condition and completion status.");
      }
      const group = groups.get(sample.condition) ?? [];
      group.push(sample);
      groups.set(sample.condition, group);
    }
    entries = [];
    for (const group of groups.values()) {
      for (let index = 0;index < group.length; index += 3) {
        const samples = group.slice(index, index + 3);
        entries.push({ outputs: samples, samples });
      }
    }
  }
  if (!entries.length)
    throw new Error("The input file contains no rounds.");
  const state = {
    rounds: [],
    total: entries.length,
    startedAt: Date.now(),
    cancelled: false,
    tokenizer: probe?.run,
    tokenizerSettled: probe ? true : undefined,
    tokenizerModel: probe?.model,
    tokenizerWarning: probe?.warning
  };
  for (const entry of entries) {
    const outputs = Array.isArray(entry) ? entry : entry?.outputs;
    if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 3 || !outputs.every((item) => item && typeof item.text === "string" && Number.isSafeInteger(item.expected_count) && item.expected_count > 0)) {
      throw new Error("Each input round must contain one to three outputs with text and a positive integer expected_count.");
    }
    const round = {
      index: state.rounds.length + 1,
      challenges: [],
      outputs: [],
      startedAt: Date.now(),
      samples: outputs.map((output, index) => {
        const numbers = parseNumbers(output.text);
        const savedSample = Array.isArray(entry?.samples) ? entry.samples[index] : undefined;
        const wasTruncated = savedSample?.state === "truncated" || savedSample?.completion === "truncated";
        const strictRejection = options.strict && (wasTruncated || savedSample?.completion !== undefined && savedSample.completion !== "complete");
        const truncated = !options.strict && numbers.length > output.expected_count;
        return {
          state: strictRejection || numbers.length < minimumNumbers(output.expected_count) ? "failed" : truncated || wasTruncated ? "truncated" : "complete",
          text: truncated ? numbers.slice(0, output.expected_count).join(", ") : output.text,
          rawText: typeof savedSample?.rawText === "string" ? savedSample.rawText : output.text,
          count: truncated ? output.expected_count : numbers.length,
          expectedCount: output.expected_count,
          error: strictRejection ? "This saved sample has no confirmed complete response. Strict mode requires completion evidence." : numbers.length < minimumNumbers(output.expected_count) ? "Too few valid numbers." : undefined
        };
      })
    };
    scoreRound(round, options, bank, detector);
    round.finishedAt = Date.now();
    state.rounds.push(round);
  }
  state.finishedAt = Date.now();
  return state;
}
function serializeResult(state, options, bank, tokenizerBank) {
  const { apiKey, ...config } = options.config;
  const only = state.rounds.length === 1 ? state.rounds[0] : undefined;
  const result = {
    schema: "fpd-detection-v1",
    created_at: new Date(state.startedAt).toISOString(),
    request: options.input ? undefined : {
      ...config,
      api: options.api,
      count: options.count,
      parallel: options.parallel,
      repeat: options.repeat,
      strict: options.strict,
      timeout_seconds: options.timeoutMs / 1000,
      tokenizer: options.tokenizer,
      max_probes: options.tokenizer ? options.maxProbes : undefined
    },
    bank: { reference_sha256: bank.reference_sha256, models: bank.models.length },
    cancelled: state.cancelled,
    requested_rounds: state.total,
    completed_rounds: state.rounds.filter((round) => round.finishedAt).length,
    scored_rounds: state.rounds.filter((round) => round.analysis?.results.length).length,
    tokenizer: state.tokenizer && tokenizerBank ? tokenizerReport(state.tokenizer, tokenizerBank, { createdAt: state.startedAt, model: state.tokenizerModel ?? "" }) : undefined,
    rounds: state.rounds,
    challenges: only?.challenges,
    outputs: only?.outputs,
    analysis: only?.analysis
  };
  return JSON.stringify(result, (_name, value) => typeof value === "string" && apiKey ? value.replaceAll(apiKey, "[REDACTED]") : value, 2) + `
`;
}

// cli/detect-update.ts
import { mkdir, readFile as readFile3, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname2, join as join3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// cli/update-command.ts
import { access, readFile as readFile2, realpath } from "node:fs/promises";
import { join as join2, resolve } from "node:path";
var normalize = (path) => path.replaceAll("\\", "/");
var managerName = (value) => /^(bun|npm|pnpm|yarn)(?:[\/@]|$)/.exec(value)?.[1];
var available = async (path) => access(path).then(() => true, () => false);
function commandFor(manager, scope, root) {
  if (scope === "temporary") {
    const runner = { bun: "bunx --bun", npm: "npx", pnpm: "pnpm dlx", yarn: "yarn dlx" }[manager];
    return { command: `${runner} lmfpd@latest`, temporary: true };
  }
  const install = manager === "npm" ? "npm install" : `${manager} add`;
  const command = manager === "yarn" && scope === "global" ? "yarn global add" : `${install}${scope === "global" ? " -g" : ""}`;
  const quote = (value) => `'${value.replaceAll("'", process.platform === "win32" ? "''" : `'"'"'`)}'`;
  const directoryFlag = { npm: "--prefix", pnpm: "--dir", bun: "--cwd", yarn: "--cwd" }[manager];
  const directory = root && normalize(resolve(root)) !== normalize(process.cwd()) ? ` ${directoryFlag} ${quote(root)}` : "";
  return { command: `${command}${directory} lmfpd@latest`, temporary: false };
}
async function detectUpdateCommand(entry, env = process.env) {
  const resolved = await realpath(entry).catch(() => resolve(entry));
  const paths = [normalize(entry), normalize(resolved)];
  const agent = managerName(env.npm_config_user_agent ?? "");
  const executable = normalize(env.npm_execpath ?? "");
  const manager = agent ?? /(?:^|\/)(bun|npm|pnpm|yarn)(?:[.-]|$)/.exec(executable)?.[1];
  for (const path of paths) {
    if (/\/bunx-[^/]+\//.test(path))
      return commandFor("bun", "temporary");
    if (/\/_npx\//.test(path))
      return commandFor("npm", "temporary");
    if (/\/(?:pnpm[^/]*\/.*)?dlx\//.test(path) && (path.includes("/pnpm") || manager === "pnpm"))
      return commandFor("pnpm", "temporary");
    if (/\/(?:dlx-[^/]+|yarn\/.*\/dlx)\//.test(path))
      return commandFor("yarn", "temporary");
  }
  for (const path of paths) {
    const bunRoot = normalize(env.BUN_INSTALL ?? "");
    if (/\/(?:\.bun|bun)\/install\/global\//.test(path) || bunRoot && path.startsWith(`${bunRoot}/install/global/`))
      return commandFor("bun", "global");
    if (/\/pnpm\/global\//i.test(path) || /\/global\/\d+\/(?:\.pnpm\/|node_modules\/)/.test(path))
      return commandFor("pnpm", "global");
    if (/\/yarn\/global\//i.test(path))
      return commandFor("yarn", "global");
    if (/\/lib\/node_modules\/lmfpd\//.test(path) || /\/AppData\/Roaming\/npm\/node_modules\/lmfpd\//i.test(path))
      return commandFor("npm", "global");
  }
  const modules = normalize(resolved).indexOf("/node_modules/");
  if (modules >= 0) {
    const root = normalize(resolved).slice(0, modules);
    let declared;
    try {
      declared = managerName(JSON.parse(await readFile2(join2(root, "package.json"), "utf8")).packageManager ?? "");
    } catch {}
    const locks = [["bun", "bun.lock"], ["bun", "bun.lockb"], ["pnpm", "pnpm-lock.yaml"], ["yarn", "yarn.lock"], ["npm", "package-lock.json"]];
    const found = await Promise.all(locks.map(async ([name, lock]) => await available(join2(root, lock)) ? name : undefined));
    const markers = [["pnpm", ".modules.yaml"], ["bun", ".bun"], ["npm", ".package-lock.json"], ["yarn", ".yarn-state.yml"], ["yarn", ".yarn-integrity"]];
    const installedBy = await Promise.all(markers.map(async ([name, marker]) => await available(join2(root, "node_modules", marker)) ? name : undefined));
    const installed = installedBy.find(Boolean) ?? (normalize(resolved).includes("/node_modules/.pnpm/") ? "pnpm" : undefined) ?? declared ?? found.find(Boolean) ?? manager;
    if (installed)
      return commandFor(installed, "local", root);
  }
  if (manager)
    return commandFor(manager, "temporary");
  return commandFor("bun", "temporary");
}

// cli/detect-update.ts
var currentVersion = "0.0.1792416845676";
var registries = [
  "https://registry.npmjs.org",
  "https://registry.npmmirror.com",
  "https://mirrors.cloud.tencent.com/npm"
];
var hour = 60 * 60 * 1000;
var maxBytes = 32 * 1024;
function stableVersion(value) {
  return typeof value === "string" && value.length < 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split(".").every((part) => Number.isSafeInteger(Number(part)));
}
function newer(candidate, current) {
  const a = candidate.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0;i < 3; i++)
    if (a[i] !== b[i])
      return a[i] > b[i];
  return false;
}
function cachePath() {
  const home = homedir();
  const root = process.env.XDG_CACHE_HOME || (process.platform === "darwin" ? join3(home, "Library/Caches") : process.platform === "win32" ? process.env.LOCALAPPDATA || join3(home, "AppData/Local") : join3(home, ".cache"));
  return join3(root, "lmfpd", "update.json");
}
async function registryVersion(registry, signal) {
  const response = await fetch(`${registry}/lmfpd/latest`, { signal, redirect: "error", headers: { accept: "application/json" } });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder;
  let text = "", size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        break;
      size += value.byteLength;
      if (size > maxBytes)
        return;
      text += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(text + decoder.decode());
    if (data.name === "lmfpd" && stableVersion(data.version))
      return data.version;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function startUpdateCheck() {
  if (!stableVersion(currentVersion))
    return () => {
      return;
    };
  const version = currentVersion;
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), 3000);
  timer.unref();
  let stopped = false, latest, command;
  (async () => {
    const path = cachePath();
    command = await detectUpdateCommand(process.argv[1] || fileURLToPath2(import.meta.url));
    let cache;
    try {
      const text = await readFile3(path, "utf8");
      if (text.length <= maxBytes)
        cache = JSON.parse(text);
    } catch {}
    const age = Date.now() - (cache?.checkedAt ?? NaN);
    if (cache?.checkedFor === version && age >= 0) {
      if (stableVersion(cache.latest))
        latest = cache.latest;
      if (age < (cache.success === true ? 6 * hour : hour))
        return;
    }
    if (controller.signal.aborted)
      return;
    let successes = 0;
    await Promise.allSettled(registries.map(async (registry) => {
      const candidate = await registryVersion(registry, controller.signal);
      if (!candidate)
        return;
      successes++;
      if (!latest || newer(candidate, latest))
        latest = candidate;
    }));
    if (stopped && successes === 0)
      return;
    await mkdir(dirname2(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ checkedAt: Date.now(), checkedFor: version, latest, success: successes > 0 }), { mode: 384 });
    await rename(temporary, path);
  })().catch(() => {}).finally(() => clearTimeout(timer));
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    if (!latest || !command || !newer(latest, version))
      return;
    return { current: version, latest, ...command, command: command.temporary ? command.command.replace("@latest", `@${latest}`) : command.command };
  };
}

// cli/detect-ui.tsx
import { useEffect, useState } from "react";
import { Box as Box2, Text as Text2, render as render2, useInput, useWindowSize as useWindowSize2 } from "ink";
import terminalLink2 from "terminal-link";

// shared/sample-distribution.ts
var ANOMALOUS_MINIMUM = 200;
function anomalousSamples(texts) {
  return texts.flatMap((text, index) => {
    const numbers = parseNumbers(text);
    return numbers.length && Math.min(...numbers) >= ANOMALOUS_MINIMUM ? [index] : [];
  });
}

// cli/detect-help.tsx
import { Box, Text, render, useWindowSize } from "ink";
import terminalLink from "terminal-link";
import { jsx, jsxs } from "react/jsx-runtime";
var sections = [
  { title: "CONNECTION", options: [
    ["-b, --baseurl URL", "Base URL or complete endpoint. Env: BASE_URL."],
    ["-m, --model MODEL", "Model to request. Env: MODEL."],
    ["-k, --apikey KEY", "API key. Env: API_KEY. Flags override environment variables."],
    ["-a, --api TYPE", "responses (default), chatcompletion, or message; any prefix or cc."],
    ["-e, --effort LEVEL", "Omitted by default. none/minimal/low/medium/high/xhigh/max, or any provider value."],
    ["-t, --service-tier TIER", "flex, default, fast, or ultrafast. Default sends nothing. Aliases: slow (flex), f (fast), uf (ultrafast). Messages sends speed; other APIs send service_tier."],
    ["-ns, --no-stream", "Use JSON instead of SSE. SSE is enabled by default."],
    ["--timeout SECONDS", "First SSE byte deadline. Default: 120. No deadline after SSE starts; JSON must finish within this time."]
  ] },
  { title: "DETECTION", options: [
    ["--count NUMBER", "Samples per round: 1–3. Default: 3. One or two samples rank without confidence."],
    ["-p, --parallel NUMBER", "Concurrent samples within each round: 1–3. Default: 3, capped at --count."],
    ["-n, --repeat NUMBER", "Sequential detection rounds. Default: 1."],
    ["-s, --strict", "Disable automatic truncation. Require --count 3 and all three complete, valid responses."],
    ["--challenges FILE", "Reuse saved challenges for every round. Array length must match --count."],
    ["--bank FILE", "Use a custom reference bank."]
  ] },
  { title: "TOKENIZER PROBE", options: [
    ["--tokenizer", "Also run the tokenizer probe. Off by default. Sends about 12 more requests, at most --max-probes + 2."],
    ["--max-probes NUMBER", `Probe text limit: ${TOKENIZER_MODEL.minimumProbes}–60. Default: ${TOKENIZER_MODEL.maximumProbes}. At the limit, the probe stops, also below ${TOKENIZER_MODEL.stopAt * 100}% confidence. Two baseline requests are extra. Needs --tokenizer.`],
    ["--tokenizer-bank FILE", "Use a custom tokenizer bank. Needs --tokenizer or --input."]
  ] },
  { title: "OUTPUT", options: [
    ["--input FILE", "Analyze saved outputs offline. No API requests."],
    ["--output FILE", "Save all rounds, samples, and results as JSON. Credentials are excluded."],
    ["--json", "Write JSON to stdout instead of the TUI."],
    ["--no-update-check", "Disable background update checks. Env: FPD_NO_UPDATE_CHECK=1."],
    ["-h, --help", "Show this help."]
  ] }
];
var examples = [
  ["Detect a model with explicit credentials", "npx lmfpd@latest -b https://api.example.com/v1 \\\n  -k sk-xxx -m gpt-6-astra"],
  ["Repeat five rounds with three concurrent samples per round", "npx lmfpd@latest -b https://api.example.com/v1 \\\n  -k sk-xxx -m gpt-6-astra -p 3 -n 5"],
  ["Use API_KEY, MODEL, and BASE_URL from your environment", "npx lmfpd@latest -a chatcompletion -e high"],
  ["Rank with a single API request using environment credentials", "npx lmfpd@latest --count 1"],
  ["Require complete responses and disable streaming", "npx lmfpd@latest -s -ns --timeout 180 --output result.json"],
  ["Analyze a saved report without calling a model", "npx lmfpd@latest --input result.json --json"],
  ["Add the tokenizer probe (about 12 more requests)", "npx lmfpd@latest -a cc --tokenizer"]
];
function StarNote() {
  return /* @__PURE__ */ jsxs(Text, {
    dimColor: true,
    children: [
      /* @__PURE__ */ jsx(Text, {
        color: "yellow",
        children: "★"
      }),
      " Like FPD? Star it on GitHub: ",
      terminalLink("github.com/Ikaleio/lm-detector", "https://github.com/Ikaleio/lm-detector", { fallback: false })
    ]
  });
}
function Help() {
  const { columns } = useWindowSize();
  const width = Math.max(32, Math.min(columns || 80, 100));
  const narrow = width < 65;
  return /* @__PURE__ */ jsxs(Box, {
    flexDirection: "column",
    width,
    paddingX: 1,
    children: [
      /* @__PURE__ */ jsxs(Box, {
        borderStyle: "round",
        borderColor: "cyan",
        paddingX: 1,
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxs(Text, {
            children: [
              /* @__PURE__ */ jsx(Text, {
                bold: true,
                color: "cyan",
                children: "FPD"
              }),
              " / MODEL FINGERPOINT DETECTOR (",
              /* @__PURE__ */ jsx(Text, {
                color: "cyan",
                children: terminalLink("lm.ikale.io", "https://lm.ikale.io", { fallback: false })
              }),
              ")"
            ]
          }),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: "One to three samples per round. Live progress. Ranked candidates."
          })
        ]
      }),
      /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsx(Text, {
            bold: true,
            color: "cyan",
            children: "USAGE"
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "npx lmfpd@latest -b URL -k KEY -m MODEL [options]"
          }),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: "With Bun only: bunx --bun lmfpd@latest [options]"
          }),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: "Defaults: Responses · SSE · relaxed · count 3 · parallel 3 · one round"
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "fpd sample [options] · collect a portable reference batch"
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "fpd enroll RUN [options] · validate and enroll a batch"
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "fpd retrain --data-dir DIR · fit ranker and confidence offline"
          }),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: "Use the subcommand --help for its options."
          })
        ]
      }),
      sections.map((section) => /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsx(Text, {
            bold: true,
            color: "cyan",
            children: section.title
          }),
          section.options.map(([flag, description]) => /* @__PURE__ */ jsxs(Box, {
            flexDirection: narrow ? "column" : "row",
            marginBottom: narrow ? 1 : 0,
            children: [
              /* @__PURE__ */ jsx(Box, {
                width: narrow ? undefined : 25,
                flexShrink: 0,
                children: /* @__PURE__ */ jsx(Text, {
                  bold: true,
                  children: flag
                })
              }),
              /* @__PURE__ */ jsx(Box, {
                flexGrow: 1,
                flexBasis: narrow ? undefined : 0,
                paddingLeft: narrow ? 2 : 0,
                children: /* @__PURE__ */ jsx(Text, {
                  children: description
                })
              })
            ]
          }, flag))
        ]
      }, section.title)),
      /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsx(Text, {
            bold: true,
            color: "cyan",
            children: "HOW ROUNDS WORK"
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "Relaxed mode caps each sample at its requested number count. One or two valid samples can produce a ranking without confidence scores."
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "Each round waits for all requested samples to settle before the next round starts. No automatic retries. Detection never enrolls samples."
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "With --tokenizer, FPD also sends short requests beside the first round. It reads the input token count from each usage report, identifies the upstream tokenizer, and checks it against --model. APIs that bill per request bill these requests."
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "The tokenizer result is reference only. The ranking never uses it and never waits for it. Many models share one tokenizer, so a match does not identify the model."
          }),
          /* @__PURE__ */ jsx(Text, {
            children: "If the rounds finish first, FPD waits for the probe before it exits. q or Ctrl+C then stops the probe and keeps the round results."
          }),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: "Use q or Ctrl+C to cancel. --base-url and --api-key are also accepted."
          })
        ]
      }),
      /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsx(Text, {
            bold: true,
            color: "cyan",
            children: "EXAMPLES"
          }),
          examples.map(([label, command]) => /* @__PURE__ */ jsxs(Box, {
            flexDirection: "column",
            marginTop: 1,
            children: [
              /* @__PURE__ */ jsx(Text, {
                dimColor: true,
                children: label
              }),
              /* @__PURE__ */ jsx(Text, {
                color: "green",
                children: command
              })
            ]
          }, label))
        ]
      }),
      /* @__PURE__ */ jsx(Box, {
        marginTop: 1,
        children: /* @__PURE__ */ jsx(Text, {
          dimColor: true,
          children: "API examples without -b, -k, and -m require BASE_URL, API_KEY, and MODEL."
        })
      }),
      /* @__PURE__ */ jsx(Box, {
        marginTop: 1,
        children: /* @__PURE__ */ jsx(StarNote, {})
      })
    ]
  });
}
async function printHelp() {
  const view = render(/* @__PURE__ */ jsx(Help, {}), { interactive: false, patchConsole: false });
  await view.waitUntilRenderFlush();
  view.unmount();
}

// cli/detect-ui.tsx
import { jsx as jsx2, jsxs as jsxs2, Fragment } from "react/jsx-runtime";
var seconds = (milliseconds) => `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
function speed({ throughput }, wide) {
  if (!throughput)
    return "";
  const rate = throughput.tokensPerSecond === undefined ? "" : `${throughput.estimated ? "≈" : ""}${Math.round(throughput.tokensPerSecond)} tok/s`;
  const ttft = `TTFT ${seconds(throughput.ttftMs)}`;
  return wide || !rate ? [ttft, rate].filter(Boolean).join(" · ") : rate;
}
var percentage = (value) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
var labels = {
  queued: "Queued",
  waiting: "Waiting",
  streaming: "Streaming",
  complete: "Complete",
  truncated: "Capped",
  failed: "Failed",
  cancelled: "Cancelled"
};
var colors = {
  queued: "gray",
  waiting: "yellow",
  streaming: "cyan",
  complete: "green",
  truncated: "green",
  failed: "red",
  cancelled: "yellow"
};
function verdictLine(bank, verdict) {
  const item = bank.classes.find((entry) => entry.id === verdict.top.id);
  const name = item ? `${item.series} (${item.lab_name})` : verdict.top.id;
  if (verdict.kind === "exact")
    return `${name} · exact match · ${percentage(verdict.confidence)}`;
  if (verdict.kind === "related")
    return `Unlisted relative of ${name} · ${percentage(verdict.confidence)}`;
  return `Unlisted tokenizer · ${percentage(verdict.confidence)} · nearest class: ${name}`;
}
var claimWords = { consistent: "match", inconsistent: "no match", uncertain: "unclear" };
function claimLine(bank, verdict, model) {
  const claim = verdict.claim;
  if (!claim)
    return `The tokenizer bank has no data for "${model}". FPD cannot check the tokenizer of this model.`;
  const expected = claim.expected.length ? claim.expected.map((id) => bank.classes.find((item) => item.id === id)?.series ?? id).join(" or ") : `an unpublished ${claim.vendor} tokenizer`;
  return `"${model}" uses ${expected} · ${claimWords[claim.status]} (${percentage(claim.probability)} probability)`;
}
var estimatedUsageClasses = new Set(["o200k", "cl100k"]);
function Ranking({ analysis, compact, safe }) {
  const calibrated = analysis.probability_status === "reference_calibrated";
  return /* @__PURE__ */ jsxs2(Box2, {
    flexDirection: "column",
    marginTop: 1,
    children: [
      /* @__PURE__ */ jsx2(Text2, {
        bold: true,
        color: "cyan",
        children: "LEADING CANDIDATES"
      }),
      /* @__PURE__ */ jsxs2(Box2, {
        children: [
          /* @__PURE__ */ jsx2(Box2, {
            width: 4,
            children: /* @__PURE__ */ jsx2(Text2, {
              dimColor: true,
              children: "#"
            })
          }),
          /* @__PURE__ */ jsx2(Box2, {
            flexGrow: 1,
            children: /* @__PURE__ */ jsx2(Text2, {
              dimColor: true,
              children: "Model"
            })
          }),
          /* @__PURE__ */ jsx2(Box2, {
            width: 9,
            justifyContent: "flex-end",
            children: /* @__PURE__ */ jsx2(Text2, {
              dimColor: true,
              children: "Score"
            })
          }),
          /* @__PURE__ */ jsx2(Box2, {
            width: 12,
            justifyContent: "flex-end",
            children: /* @__PURE__ */ jsx2(Text2, {
              dimColor: true,
              children: "Confidence"
            })
          })
        ]
      }),
      analysis.results.slice(0, compact ? 3 : 5).map((row, index) => /* @__PURE__ */ jsxs2(Box2, {
        children: [
          /* @__PURE__ */ jsx2(Box2, {
            width: 4,
            children: /* @__PURE__ */ jsx2(Text2, {
              color: index === 0 ? "cyan" : undefined,
              children: index + 1
            })
          }),
          /* @__PURE__ */ jsx2(Box2, {
            flexGrow: 1,
            flexBasis: 0,
            children: /* @__PURE__ */ jsx2(Text2, {
              wrap: "truncate-end",
              bold: index === 0,
              children: safe(row.display_name)
            })
          }),
          /* @__PURE__ */ jsx2(Box2, {
            width: 9,
            justifyContent: "flex-end",
            children: /* @__PURE__ */ jsx2(Text2, {
              children: row.score.toFixed(3)
            })
          }),
          /* @__PURE__ */ jsx2(Box2, {
            width: 12,
            justifyContent: "flex-end",
            children: /* @__PURE__ */ jsx2(Text2, {
              color: index === 0 ? "cyan" : undefined,
              children: percentage(row.probability)
            })
          })
        ]
      }, row.model)),
      /* @__PURE__ */ jsx2(Text2, {
        dimColor: true,
        children: analysis.decision === "partial" ? "Partial ranking · confidence unavailable" : calibrated ? "Confidence is relative to the reference bank; it does not prove identity." : "Confidence unavailable for this detector."
      }),
      !compact && /* @__PURE__ */ jsx2(Text2, {
        dimColor: true,
        children: safe(analysis.evidence.label)
      })
    ]
  });
}
function Tokenizer({ state, bank, options, spinner, safe }) {
  const run = state.tokenizer;
  if (!run)
    return null;
  const settled = state.tokenizerSettled !== false;
  const answered = run.steps.filter((step) => step.state === "done").length;
  const verdict = run.verdict ?? (!settled && run.posterior && run.posterior.answered > 0 ? tokenizerVerdict(bank, run.posterior, options.config.model) : null);
  const error = run.error && run.error.code !== "aborted" ? run.error : undefined;
  const stopped = settled && run.error?.code === "aborted";
  const model = state.tokenizerModel ?? options.config.model;
  return /* @__PURE__ */ jsxs2(Box2, {
    flexDirection: "column",
    marginTop: 1,
    children: [
      /* @__PURE__ */ jsxs2(Text2, {
        bold: true,
        color: "cyan",
        children: [
          "TOKENIZER PROBE ",
          /* @__PURE__ */ jsxs2(Text2, {
            dimColor: true,
            children: [
              " · ",
              answered,
              " request",
              answered === 1 ? "" : "s",
              " answered"
            ]
          })
        ]
      }),
      /* @__PURE__ */ jsx2(Text2, {
        dimColor: true,
        children: "Reference only. The ranking and the confidence do not use it."
      }),
      state.tokenizerWarning && /* @__PURE__ */ jsx2(Text2, {
        color: "yellow",
        children: safe(state.tokenizerWarning)
      }),
      !settled && /* @__PURE__ */ jsxs2(Text2, {
        children: [
          spinner,
          " ",
          verdict ? `Current leader: ${verdictLine(bank, verdict)}` : "Waiting for the first counts"
        ]
      }),
      settled && verdict && /* @__PURE__ */ jsxs2(Fragment, {
        children: [
          /* @__PURE__ */ jsx2(Text2, {
            bold: true,
            children: verdictLine(bank, verdict)
          }),
          model && /* @__PURE__ */ jsx2(Text2, {
            color: verdict.claim?.status === "inconsistent" ? "red" : verdict.claim?.status === "consistent" ? "green" : "yellow",
            children: safe(claimLine(bank, verdict, model))
          }),
          verdict.kind === "exact" && estimatedUsageClasses.has(verdict.top.id) && verdict.claim?.status !== "consistent" && /* @__PURE__ */ jsx2(Text2, {
            color: "yellow",
            children: "A relay that counts usage locally with tiktoken also gives this result. The count can come from the relay and not from the model."
          }),
          verdict.kind === "exact" && verdict.claim?.status === "consistent" && /* @__PURE__ */ jsx2(Text2, {
            dimColor: true,
            children: "Many models share one tokenizer. A match does not identify the model."
          })
        ]
      }),
      settled && !verdict && /* @__PURE__ */ jsxs2(Text2, {
        color: "yellow",
        children: [
          "No tokenizer result",
          error ? `: ${safe(error.message)}` : ". No probe text got a count."
        ]
      }),
      settled && verdict && error && /* @__PURE__ */ jsxs2(Text2, {
        color: "yellow",
        children: [
          "Partial result from the counts before a failed request: ",
          safe(error.message)
        ]
      }),
      stopped && /* @__PURE__ */ jsxs2(Text2, {
        color: "yellow",
        children: [
          "The probe stopped after ",
          answered,
          " answered request",
          answered === 1 ? "" : "s",
          ".",
          verdict ? " The result uses these counts." : ""
        ]
      }),
      run.baselineDrift && /* @__PURE__ */ jsx2(Text2, {
        color: "yellow",
        children: "The two baseline requests gave different counts. The API adds hidden input of varying length, so the result can be wrong. Run the command again and compare."
      })
    ]
  });
}
function Dashboard({ state, options, bankSize, tokenizerBank, cancel, saved, fatal, updateNotice }) {
  const [now, setNow] = useState(Date.now());
  const { columns, rows } = useWindowSize2();
  const compact = rows < 32;
  useEffect(() => {
    if (state.finishedAt)
      return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [state.finishedAt]);
  useInput((input, key) => {
    if (input === "q" || key.ctrl && input === "c")
      cancel();
  }, {
    isActive: !!process.stdin.isTTY && !state.finishedAt
  });
  const safe = (value) => cleanText(options.config.apiKey ? value.replaceAll(options.config.apiKey, "[REDACTED]") : value);
  const latest = state.rounds.at(-1);
  const completed = state.rounds.filter((round) => round.finishedAt).length;
  const scored = state.rounds.filter((round) => round.analysis?.results.length).length;
  const elapsed = seconds((state.finishedAt ?? now) - state.startedAt);
  const final = state.roundsFinishedAt ?? state.finishedAt;
  const phase = state.cancelled ? "Cancelled" : state.finishedAt ? "Finished" : final ? "Ranking final · tokenizer probe running" : "Detecting";
  const spinner = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(now / 100) % 10];
  const history = state.rounds.filter((round) => round.finishedAt);
  const visibleHistory = history.slice(compact ? -3 : -5);
  const anomalous = latest?.analysis?.results.length || latest?.analysis?.decision === "not_model" ? anomalousSamples(latest.outputs.map((output) => output.text)) : [];
  const winnerCounts = new Map;
  for (const round of history) {
    if (round.analysis?.results.length) {
      const name = round.analysis.prediction_name;
      winnerCounts.set(name, (winnerCounts.get(name) ?? 0) + 1);
    }
  }
  const consensus = [...winnerCounts].sort((a, b) => b[1] - a[1])[0];
  const tied = consensus ? [...winnerCounts].filter(([, count]) => count === consensus[1]).length > 1 : false;
  return /* @__PURE__ */ jsxs2(Box2, {
    flexDirection: "column",
    width: Math.max(30, Math.min(columns || 80, 100)),
    paddingX: 1,
    children: [
      /* @__PURE__ */ jsxs2(Box2, {
        borderStyle: "round",
        borderColor: "cyan",
        paddingX: 1,
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxs2(Text2, {
            children: [
              /* @__PURE__ */ jsx2(Text2, {
                bold: true,
                color: "cyan",
                children: "FPD"
              }),
              /* @__PURE__ */ jsx2(Text2, {
                dimColor: true,
                children: " / MODEL FINGERPOINT DETECTOR ("
              }),
              /* @__PURE__ */ jsx2(Text2, {
                color: "cyan",
                children: terminalLink2("lm.ikale.io", "https://lm.ikale.io", { fallback: false })
              }),
              /* @__PURE__ */ jsx2(Text2, {
                dimColor: true,
                children: ")"
              })
            ]
          }),
          /* @__PURE__ */ jsx2(Text2, {
            wrap: "truncate-end",
            bold: true,
            children: options.input ? `Offline · ${safe(options.input)}` : safe(options.config.model)
          }),
          !compact && !options.input && /* @__PURE__ */ jsx2(Text2, {
            dimColor: true,
            wrap: "truncate-middle",
            children: safe(options.config.baseUrl)
          }),
          /* @__PURE__ */ jsxs2(Text2, {
            dimColor: true,
            children: [
              options.input ? "Saved outputs" : `${options.api}${options.config.serviceTier === "default" ? "" : ` · ${options.config.serviceTier}`} · ${options.config.stream ? "SSE" : "JSON"} · count ${options.count} · parallel ${options.parallel}`,
              " · ",
              options.strict ? "strict" : "relaxed",
              " · ",
              bankSize,
              " models",
              options.tokenizer ? " · tokenizer probe" : ""
            ]
          })
        ]
      }),
      /* @__PURE__ */ jsxs2(Box2, {
        justifyContent: "space-between",
        children: [
          /* @__PURE__ */ jsxs2(Text2, {
            bold: true,
            children: [
              state.finishedAt ? "●" : spinner,
              " ",
              phase,
              " · round ",
              latest?.index ?? 1,
              "/",
              state.total
            ]
          }),
          /* @__PURE__ */ jsx2(Text2, {
            dimColor: true,
            children: elapsed
          })
        ]
      }),
      !options.input && /* @__PURE__ */ jsxs2(Text2, {
        dimColor: true,
        children: [
          "First byte ",
          options.timeoutMs / 1000,
          "s",
          options.config.stream ? " · no deadline after SSE starts" : " · deadline covers the full JSON response"
        ]
      }),
      latest && /* @__PURE__ */ jsx2(Box2, {
        flexDirection: "column",
        marginTop: 1,
        children: latest.samples.map((sample, index) => {
          const active = sample.state === "waiting" || sample.state === "streaming";
          const time = sample.startedAt ? seconds((sample.finishedAt ?? now) - sample.startedAt) : "—";
          const filled = Math.min(12, Math.round(12 * sample.count / sample.expectedCount));
          const warning = anomalous.includes(index);
          const color = warning ? "yellow" : colors[sample.state];
          return /* @__PURE__ */ jsxs2(Box2, {
            flexDirection: "column",
            children: [
              /* @__PURE__ */ jsxs2(Box2, {
                children: [
                  /* @__PURE__ */ jsx2(Box2, {
                    width: 5,
                    children: /* @__PURE__ */ jsxs2(Text2, {
                      dimColor: true,
                      children: [
                        "#",
                        index + 1
                      ]
                    })
                  }),
                  /* @__PURE__ */ jsx2(Box2, {
                    width: 12,
                    children: /* @__PURE__ */ jsxs2(Text2, {
                      color,
                      children: [
                        active ? spinner : warning ? "!" : acceptedSample(sample) ? "✓" : sample.state === "failed" ? "×" : "·",
                        " ",
                        labels[sample.state]
                      ]
                    })
                  }),
                  columns >= 75 && /* @__PURE__ */ jsx2(Box2, {
                    width: 15,
                    children: /* @__PURE__ */ jsxs2(Text2, {
                      color,
                      children: [
                        "━".repeat(filled),
                        /* @__PURE__ */ jsx2(Text2, {
                          dimColor: true,
                          children: "─".repeat(12 - filled)
                        })
                      ]
                    })
                  }),
                  /* @__PURE__ */ jsx2(Box2, {
                    flexGrow: 1,
                    children: /* @__PURE__ */ jsxs2(Text2, {
                      children: [
                        sample.count,
                        "/",
                        sample.expectedCount
                      ]
                    })
                  }),
                  !active && sample.throughput && /* @__PURE__ */ jsxs2(Text2, {
                    dimColor: true,
                    children: [
                      speed(sample, columns >= 75),
                      " · "
                    ]
                  }),
                  /* @__PURE__ */ jsx2(Text2, {
                    dimColor: true,
                    children: time
                  })
                ]
              }),
              sample.error && /* @__PURE__ */ jsxs2(Text2, {
                color: "red",
                wrap: "truncate-end",
                children: [
                  "   ",
                  safe(sample.error)
                ]
              }),
              warning && /* @__PURE__ */ jsx2(Text2, {
                color: "yellow",
                wrap: "truncate-end",
                children: "   Abnormal distribution · every number is 200 or higher"
              })
            ]
          }, index);
        })
      }),
      latest?.error && /* @__PURE__ */ jsx2(Text2, {
        color: "yellow",
        children: safe(latest.error)
      }),
      anomalous.length > 0 && /* @__PURE__ */ jsxs2(Text2, {
        color: "yellow",
        children: [
          "Sample ",
          anomalous.map((index) => index + 1).join(", "),
          ": abnormal distribution. This result is unreliable. The prompt causes it, so ",
          options.challenges ? "replace these prompts in the --challenges file" : "rerun to draw new prompts",
          "."
        ]
      }),
      latest?.analysis && latest.analysis.results.length > 0 && /* @__PURE__ */ jsx2(Ranking, {
        analysis: latest.analysis,
        compact,
        safe
      }),
      tokenizerBank && /* @__PURE__ */ jsx2(Tokenizer, {
        state,
        bank: tokenizerBank,
        options,
        spinner,
        safe
      }),
      state.total > 1 && history.length > 0 && /* @__PURE__ */ jsxs2(Box2, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsxs2(Text2, {
            bold: true,
            color: "cyan",
            children: [
              "ROUNDS ",
              /* @__PURE__ */ jsxs2(Text2, {
                dimColor: true,
                children: [
                  " · ",
                  completed,
                  "/",
                  state.total,
                  " settled · ",
                  scored,
                  " scored"
                ]
              })
            ]
          }),
          visibleHistory.map((round) => /* @__PURE__ */ jsxs2(Box2, {
            children: [
              /* @__PURE__ */ jsx2(Box2, {
                width: 5,
                children: /* @__PURE__ */ jsxs2(Text2, {
                  dimColor: true,
                  children: [
                    "#",
                    round.index
                  ]
                })
              }),
              /* @__PURE__ */ jsx2(Box2, {
                flexGrow: 1,
                flexBasis: 0,
                children: /* @__PURE__ */ jsx2(Text2, {
                  wrap: "truncate-end",
                  color: round.error ? "yellow" : undefined,
                  children: safe(round.analysis?.prediction_name || "Not scored")
                })
              }),
              /* @__PURE__ */ jsx2(Box2, {
                width: 7,
                justifyContent: "flex-end",
                children: /* @__PURE__ */ jsxs2(Text2, {
                  dimColor: true,
                  children: [
                    round.samples.filter(acceptedSample).length,
                    "/",
                    round.samples.length
                  ]
                })
              }),
              /* @__PURE__ */ jsx2(Box2, {
                width: 10,
                justifyContent: "flex-end",
                children: /* @__PURE__ */ jsx2(Text2, {
                  children: percentage(round.analysis?.probability)
                })
              })
            ]
          }, round.index)),
          history.length > visibleHistory.length && /* @__PURE__ */ jsxs2(Text2, {
            dimColor: true,
            children: [
              "Showing the last ",
              visibleHistory.length,
              " rounds. Use --output to save every round."
            ]
          }),
          final && consensus && /* @__PURE__ */ jsxs2(Text2, {
            children: [
              tied ? "Tied lead" : "Most frequent",
              ": ",
              /* @__PURE__ */ jsx2(Text2, {
                bold: true,
                children: safe(consensus[0])
              }),
              tied ? " and others" : "",
              " · ",
              consensus[1],
              "/",
              scored,
              " scored rounds"
            ]
          })
        ]
      }),
      /* @__PURE__ */ jsxs2(Box2, {
        marginTop: 1,
        flexDirection: "column",
        children: [
          fatal && /* @__PURE__ */ jsx2(Text2, {
            color: "red",
            children: safe(fatal)
          }),
          saved && /* @__PURE__ */ jsxs2(Text2, {
            color: "green",
            children: [
              "Saved ",
              safe(saved)
            ]
          }),
          /* @__PURE__ */ jsx2(Text2, {
            dimColor: true,
            children: state.finishedAt ? `${scored}/${state.total} rounds scored · ${elapsed}` : final && !state.cancelled ? "q / Ctrl+C stops the tokenizer probe and exits · the ranking stays" : "q / Ctrl+C to cancel · each round waits for all requested samples"
          }),
          state.finishedAt && scored > 0 && !fatal && /* @__PURE__ */ jsx2(StarNote, {})
        ]
      }),
      updateNotice && /* @__PURE__ */ jsxs2(Box2, {
        marginTop: 1,
        flexDirection: "column",
        children: [
          /* @__PURE__ */ jsxs2(Text2, {
            color: "yellow",
            children: [
              "Update available: ",
              updateNotice.current,
              " → ",
              updateNotice.latest
            ]
          }),
          /* @__PURE__ */ jsxs2(Text2, {
            children: [
              updateNotice.temporary ? "Run the latest version" : "Update",
              ": ",
              /* @__PURE__ */ jsx2(Text2, {
                color: "cyan",
                children: updateNotice.command
              })
            ]
          })
        ]
      })
    ]
  });
}
function createDisplay(options, bankSize, cancel, tokenizerBank) {
  let state = { rounds: [], total: options.repeat, startedAt: Date.now(), cancelled: false };
  const terminal = !!process.stdout.isTTY && !process.env.CI && process.env.TERM !== "dumb";
  const view = render2(/* @__PURE__ */ jsx2(Dashboard, {
    state,
    options,
    bankSize,
    tokenizerBank,
    cancel
  }), {
    exitOnCtrlC: false,
    patchConsole: false,
    maxFps: 10,
    interactive: terminal
  });
  const settled = new Set;
  const clean = (text) => cleanText(options.config.apiKey ? text.replaceAll(options.config.apiKey, "[REDACTED]") : text);
  return {
    update(next) {
      state = next;
      if (!terminal && !options.input) {
        const round = state.rounds.at(-1);
        round?.samples.forEach((sample, index) => {
          const id = `${round.index}:${index}`;
          if (!sample.finishedAt || settled.has(id))
            return;
          settled.add(id);
          process.stderr.write(`[${round.index}/${state.total}] Sample ${index + 1}: ${labels[sample.state]} (${sample.count}/${sample.expectedCount})${sample.throughput ? ` · ${speed(sample, true)}` : ""}${sample.error ? ` · ${sample.error}` : ""}
`);
        });
        if (round?.finishedAt && !settled.has(`${round.index}`)) {
          settled.add(`${round.index}`);
          const analysis = round.analysis?.results.length ? round.analysis : undefined;
          process.stderr.write(`[${round.index}/${state.total}] ${analysis ? `Leading: ${clean(analysis.prediction_name)} · ${percentage(analysis.probability)}` : `Not scored: ${clean(round.error ?? "")}`}
`);
        }
        if (state.roundsFinishedAt && state.tokenizerSettled === false && !state.cancelled && !settled.has("final")) {
          settled.add("final");
          process.stderr.write(`All rounds finished. The tokenizer probe is still running. Ctrl+C stops the probe and keeps the round results.
`);
        }
        const run = state.tokenizer;
        if (run && tokenizerBank && state.tokenizerSettled && !settled.has("tokenizer")) {
          settled.add("tokenizer");
          const answered = run.steps.filter((step) => step.state === "done").length;
          const outcome = run.verdict ? verdictLine(tokenizerBank, run.verdict) : `no result${run.error ? ` (${clean(run.error.message)})` : ""}`;
          process.stderr.write(`Tokenizer probe, reference only, ${answered} request${answered === 1 ? "" : "s"} answered: ${outcome}
`);
        }
      }
      view.rerender(/* @__PURE__ */ jsx2(Dashboard, {
        state,
        options,
        bankSize,
        tokenizerBank,
        cancel
      }));
    },
    async finish(saved, fatal, updateNotice) {
      state = { ...state, finishedAt: state.finishedAt ?? Date.now() };
      view.rerender(/* @__PURE__ */ jsx2(Dashboard, {
        state,
        options,
        bankSize,
        tokenizerBank,
        cancel,
        saved,
        fatal,
        updateNotice
      }));
      await view.waitUntilRenderFlush();
      view.unmount();
    }
  };
}

// cli/detect.ts
async function runDetectionCommand(args) {
  let key = "";
  let display;
  let stopUpdateCheck;
  const abort = new AbortController;
  const cancel = () => abort.abort();
  const terminate = () => {
    process.exitCode = 143;
    abort.abort();
  };
  try {
    for (let index = 0;index < args.length; index++) {
      const argument = args[index];
      if (["--apikey", "--api-key", "-k"].includes(argument))
        key = args[++index] ?? "";
      else if (/^--(apikey|api-key)=/.test(argument))
        key = argument.slice(argument.indexOf("=") + 1);
      else if (argument.startsWith("-k") && argument.length > 2)
        key = argument.slice(2);
    }
    key ||= process.env.API_KEY ?? "";
    const options = parseOptions(args);
    if (!options) {
      await printHelp();
    } else {
      key = options.config.apiKey;
      if (!options.input)
        requestEndpoint(options.config);
      if (options.updateCheck && !options.input && !options.json && process.stdout.isTTY && !process.env.CI && process.env.TERM !== "dumb") {
        stopUpdateCheck = startUpdateCheck();
      }
      const [bankData, detector, challenges, tokenizerData] = await Promise.all([
        readJson(options.bank ?? fileURLToPath3(new URL("../data/unified_bank.json", import.meta.url))),
        readDetector(options.bank),
        loadChallenges(options.challenges, options.count),
        options.tokenizer || options.input ? readJson(options.tokenizerBank ?? fileURLToPath3(new URL("../data/tokenizer_bank.json", import.meta.url))) : undefined
      ]);
      const bank = bankData;
      if (!Array.isArray(bank?.models) || !bank.models.length)
        throw new Error("The reference bank must contain a nonempty models array.");
      if (detector.schema !== "shared-detector-v2")
        throw new Error("The detector artifact has an unsupported schema.");
      if (!supportsSharedDetector(bank, detector))
        throw new Error("The reference bank does not match its detector. Run fpd retrain --data-dir DIR for this bank.");
      let tokenizerBank;
      if (tokenizerData !== undefined) {
        assertTokenizerBank(tokenizerData);
        tokenizerBank = tokenizerData;
      }
      process.on("SIGINT", cancel);
      process.on("SIGTERM", terminate);
      if (!options.json)
        display = createDisplay(options, bank.models.length, cancel, tokenizerBank);
      const state = options.input ? await analyzeInput(options, bank, detector, tokenizerBank) : await runDetection(options, bank, detector, (state) => display?.update(state), abort.signal, challenges, tokenizerBank);
      if (display)
        display.update(state);
      else if (state.tokenizerWarning)
        process.stderr.write(`Warning: ${state.tokenizerWarning}
`);
      const serialized = serializeResult(state, options, bank, tokenizerBank);
      if (options.output)
        await writeFile2(options.output, serialized, { mode: 384 });
      if (options.json)
        process.stdout.write(serialized);
      const updateNotice = stopUpdateCheck?.();
      await display?.finish(options.output, undefined, state.cancelled ? undefined : updateNotice);
      display = undefined;
      if (state.cancelled || abort.signal.aborted)
        process.exitCode = process.exitCode || 130;
      else if (state.rounds.some((round) => round.error))
        process.exitCode = 1;
    }
  } catch (error) {
    stopUpdateCheck?.();
    const message = errorMessage(error, key);
    if (display)
      await display.finish(undefined, message);
    else
      process.stderr.write(`Error: ${message}
Use --help for usage.
`);
    process.exitCode = 1;
  } finally {
    stopUpdateCheck?.();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", terminate);
  }
}
export {
  runDetectionCommand
};
