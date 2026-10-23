// shared/reference.ts
function apiFormat(format) {
  return format === "chat_completions" ? "openai" : format === "messages" ? "anthropic" : "responses";
}
function requestFormat(format) {
  return format === "openai" ? "chat_completions" : format === "anthropic" ? "messages" : "responses";
}
function validateChannel(channel, subscription = false) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(channel) || channel.includes("..") || channel.endsWith("/")) {
    throw new Error("Channel must be a lowercase identifier such as openrouter/anthropic or codex-subscription.");
  }
  if ((subscription || /^(codex|kimi-code)(?:\/|$|-)/.test(channel)) && !channel.endsWith("-subscription")) {
    throw new Error("Subscription channels must end with -subscription (for example codex-subscription).");
  }
}
function* referenceSamples(batches) {
  for (const batch of batches)
    for (const sample of batch.samples)
      yield { batch, sample };
}
function parseReference(content) {
  const batches = content.split(`
`).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const ids = new Set;
  const batchIds = new Set;
  for (const batch of batches) {
    if (!batch || batch.schema_version !== 1 || batch.purpose !== "reference" || typeof batch.id !== "string" || !batch.id || batchIds.has(batch.id) || !batch.model?.id || !batch.model.family || !batch.model.family_name || !batch.source?.channel || !batch.request || !Array.isArray(batch.request.response_models) || !Array.isArray(batch.plan?.challenge_ids) || !Array.isArray(batch.samples) || !batch.samples.length) {
      throw new Error("Reference data must contain version 1 reference batches; evaluation data is not supported.");
    }
    if ("test_set_id" in batch)
      throw new Error("Evaluation batches cannot be used as reference data.");
    validateChannel(batch.source.channel);
    batchIds.add(batch.id);
    if (batch.source.endpoint !== null && typeof batch.source.endpoint !== "string" || batch.request.format !== null && !["chat_completions", "responses", "messages"].includes(batch.request.format)) {
      throw new Error(`Invalid request configuration in batch ${batch.id}.`);
    }
    const planned = new Set(batch.plan.challenge_ids);
    for (const sample of batch.samples) {
      if (!sample || typeof sample.id !== "string" || !sample.id || ids.has(sample.id) || !planned.has(sample.challenge_id) || !sample.condition || typeof sample.prompt !== "string" || typeof sample.system_prompt !== "string" || typeof sample.text !== "string" || !Number.isInteger(sample.expected_count) || sample.expected_count < 1 || !["complete", "truncated", "unknown"].includes(sample.completion) || sample.attempt !== null && (!Number.isInteger(sample.attempt) || sample.attempt < 1) || sample.note !== null && typeof sample.note !== "string" || sample.reasoning_effort !== undefined && (typeof sample.reasoning_effort !== "string" || !sample.reasoning_effort)) {
        throw new Error(`Invalid or duplicate reference sample in batch ${batch.id}.`);
      }
      if ("test_set_id" in sample || "purpose" in sample)
        throw new Error("Evaluation records cannot be used as reference samples.");
      if (sample.actual_channel !== null)
        validateChannel(sample.actual_channel);
      ids.add(sample.id);
    }
  }
  return batches;
}

export { apiFormat, requestFormat, validateChannel, referenceSamples, parseReference };
