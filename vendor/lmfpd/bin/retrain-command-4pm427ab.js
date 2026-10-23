import {
  missing,
  withLock
} from "./fpd-j1sc1zsp.js";

// cli/retrain-command.ts
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
var usage = `Usage: fpd retrain --data-dir DIR

Refit the ranker and closed-set confidence calibration from an enrolled
reference bank. Requires uv and Python; does not call a model API. The original
detector is preserved if fitting or calibration validation fails.
`;
async function runRetrainCommand(args) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "data-dir": { type: "string" },
    help: { type: "boolean", short: "h" }
  } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (!values["data-dir"]?.trim())
    throw new Error(`Specify an existing --data-dir.
` + usage);
  const directory = resolve(values["data-dir"]);
  const info = await stat(directory).catch((error) => {
    if (missing(error))
      throw new Error(`Data directory does not exist: ${directory}`);
    throw error;
  });
  if (!info.isDirectory())
    throw new Error(`Data destination is not a directory: ${directory}`);
  const script = fileURLToPath(new URL("../offline/retrain.py", import.meta.url));
  await withLock(directory, () => new Promise((done, reject) => {
    const child = spawn("uv", ["run", "--no-project", "--script", script, "--data-dir", directory], { stdio: "inherit" });
    child.once("error", (error) => reject(error.code === "ENOENT" ? new Error("Offline retraining requires uv. Install uv and rerun fpd retrain.") : error));
    child.once("close", (code, signal) => code === 0 ? done() : reject(new Error(`Offline retraining ${signal ? `was interrupted (${signal})` : `failed (exit ${code})`}. Inspect the destination before retrying.`)));
  }));
}
export {
  runRetrainCommand
};
