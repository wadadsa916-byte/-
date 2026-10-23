import {
  COMPLETION_TIMEOUT_MS,
  completionBody,
  requestEndpoint,
  readCompletion,
  directTransport,
  endpoint
} from "./fpd-d52qcyvd.js";
import {
  sha256,
  readJson,
  missing,
  atomicWrite,
  saveJson,
  withLock
} from "./fpd-j1sc1zsp.js";
import {
  parseNumbers
} from "./fpd-ea5f9wr0.js";
import {
  apiFormat,
  requestFormat,
  validateChannel,
  referenceSamples,
  parseReference
} from "./fpd-cgj1p34h.js";

// cli/collection-command.ts
import { mkdir as mkdir4, readFile as readFile5 } from "node:fs/promises";
import { dirname as dirname2, join as join6, resolve as resolve2 } from "node:path";

// cli/codex.ts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
function codexRequest(body) {
  const { max_output_tokens: _limit, ...request } = body;
  return { ...request, instructions: typeof body.instructions === "string" ? body.instructions : "" };
}
async function codexTransport(traceDirectory) {
  const auth = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"), "utf8"));
  if (!auth || typeof auth !== "object" || !("tokens" in auth) || !auth.tokens || typeof auth.tokens !== "object")
    throw new Error("本机没有可用的 Codex ChatGPT 登录");
  const tokens = auth.tokens;
  if (!("access_token" in tokens) || typeof tokens.access_token !== "string" || !tokens.access_token)
    throw new Error("本机 Codex 登录缺少 access_token");
  const accessToken = tokens.access_token;
  const accountId = "account_id" in tokens && typeof tokens.account_id === "string" ? tokens.account_id : undefined;
  if (traceDirectory)
    await mkdir(traceDirectory, { recursive: true });
  let index = 0;
  return async (url, config, body, signal) => {
    if (url !== CODEX_ENDPOINT || config.format !== "responses" || body.stream !== true)
      throw new Error("Codex 登录只支持固定官方端点和 Responses 流式请求");
    const request = codexRequest(body);
    const prefix = traceDirectory ? join(traceDirectory, `attempt-${++index}`) : undefined;
    if (prefix)
      await writeFile(prefix + ".request.json", JSON.stringify({ url, body: request, adaptations: ["omit max_output_tokens (Codex endpoint)", "preserve instructions; default to empty"], started_at: new Date().toISOString() }, null, 2) + `
`, { mode: 384, flag: "wx" });
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer " + accessToken, originator: "codex_cli_rs" };
    if (accountId)
      headers["chatgpt-account-id"] = accountId;
    let response;
    try {
      response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request), signal, redirect: "error" });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replaceAll(accessToken, "[REDACTED]");
      if (prefix)
        await writeFile(prefix + ".error.json", JSON.stringify({ message }) + `
`, { mode: 384 });
      throw new Error(message);
    }
    if (prefix)
      await writeFile(prefix + ".response.json", JSON.stringify({ status: response.status, request_id: response.headers.get("x-request-id"), content_type: response.headers.get("content-type") }, null, 2) + `
`, { mode: 384 });
    const responseHeaders = new Headers(response.headers);
    if (response.ok && !responseHeaders.has("content-type"))
      responseHeaders.set("content-type", "text/event-stream");
    if (!prefix || !response.body)
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    await writeFile(prefix + ".body.txt", "", { mode: 384 });
    const reader = response.body.getReader();
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          appendFileSync(prefix + ".body.txt", next.value);
          controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    }), { status: response.status, headers: responseHeaders });
  };
}

// cli/collection-options.ts
import { parseArgs } from "node:util";
function integer(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return number;
}
function collectionApi(value) {
  const input = value.toLowerCase();
  const api = input === "cc" ? "chatcompletion" : ["responses", "chatcompletion", "message"].find((name) => input && name.startsWith(input));
  if (!api)
    throw new Error("--api must be responses, chatcompletion, or message (or cc).");
  return api;
}
function collectionConfig(options) {
  return {
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    format: options.api === "message" ? "anthropic" : options.api === "chatcompletion" ? "openai" : "responses",
    effort: options.effort === "default" ? "" : options.effort,
    stream: options.stream
  };
}
function parseCollectionOptions(command, args, env = process.env) {
  const { values, positionals } = parseArgs({ args: args.map((arg) => arg === "-ns" ? "--no-stream" : arg), strict: true, allowPositionals: command === "enroll", options: {
    model: { type: "string", short: "m" },
    apikey: { type: "string", short: "k" },
    baseurl: { type: "string", short: "b" },
    "api-key": { type: "string" },
    "base-url": { type: "string" },
    api: { type: "string", short: "a" },
    effort: { type: "string", short: "e" },
    label: { type: "string" },
    family: { type: "string" },
    "family-name": { type: "string" },
    channel: { type: "string" },
    "response-model": { type: "string", multiple: true },
    subscription: { type: "boolean" },
    "no-stream": { type: "boolean" },
    count: { type: "string" },
    parallel: { type: "string", short: "p" },
    "max-attempts": { type: "string" },
    "output-dir": { type: "string" },
    resume: { type: "string" },
    "data-dir": { type: "string" },
    enroll: { type: "boolean" },
    json: { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    help: { type: "boolean", short: "h" },
    "dry-run": { type: "boolean" },
    challenge: { type: "string" },
    "prompt-file": { type: "string" },
    "system-file": { type: "string" },
    note: { type: "string" },
    adopt: { type: "string" },
    take: { type: "string" }
  } });
  if (values.help)
    return;
  const supplied = new Set(Object.keys(values));
  const text = (value) => value?.trim() ?? "";
  const options = {
    command,
    model: text(values.model ?? env.MODEL),
    apiKey: text(values.apikey ?? values["api-key"] ?? env.API_KEY),
    baseUrl: text(values.baseurl ?? values["base-url"] ?? env.BASE_URL),
    label: text(values.label),
    family: text(values.family),
    familyName: text(values["family-name"]),
    channel: text(values.channel),
    responseModels: (values["response-model"] ?? []).map(text),
    api: collectionApi(values.api ?? "responses"),
    effort: text(values.effort ?? env.REASONING_EFFORT ?? "default"),
    stream: !values["no-stream"],
    count: integer(values.count ?? "36", "--count", 36),
    parallel: integer(values.parallel ?? "3", "--parallel", 36),
    maxAttempts: integer(values["max-attempts"] ?? "3", "--max-attempts", 20),
    outputDir: values["output-dir"],
    resume: values.resume ?? positionals[0],
    dataDir: values["data-dir"],
    challenge: values.challenge,
    promptFile: values["prompt-file"],
    systemFile: values["system-file"],
    note: values.note,
    take: values.take === undefined ? undefined : integer(values.take, "--take"),
    subscription: !!values.subscription,
    json: !!values.json,
    enroll: command === "enroll" || !!values.enroll,
    yes: !!values.yes,
    dryRun: !!values["dry-run"],
    supplied
  };
  if (command === "sample" && !options.resume && env.REASONING_EFFORT && values.effort === undefined)
    supplied.add("effort");
  if (options.resume !== undefined && !options.resume.trim())
    throw new Error("The batch directory cannot be empty.");
  if (positionals.length > 1 || positionals.length && values.resume)
    throw new Error("Provide one batch directory, either positional or --resume.");
  if (values.adopt !== undefined) {
    const match = /^(.+):(\d+)$/.exec(values.adopt);
    if (!match)
      throw new Error("--adopt must be CHALLENGE_ID:ATTEMPT.");
    options.adopt = { id: match[1], attempt: integer(match[2], "--adopt attempt") };
  }
  if (options.resume) {
    for (const flag of ["output-dir", "baseurl", "base-url", "model", "label", "family", "family-name", "channel", "response-model", "api", "subscription", "count", "no-stream"]) {
      if (supplied.has(flag))
        throw new Error(`--resume cannot override --${flag}; create a new batch instead.`);
    }
    if (supplied.has("effort") && (!options.challenge || !options.note?.trim()))
      throw new Error("--resume --effort requires --challenge and --note.");
  }
  const adjustment = options.challenge !== undefined || options.promptFile !== undefined || options.systemFile !== undefined || !!options.resume && supplied.has("effort");
  if (adjustment && (!options.resume || !options.challenge || !options.note?.trim() || !options.promptFile && !supplied.has("effort") || options.systemFile && !options.promptFile)) {
    throw new Error("Challenge adjustment requires --resume, --challenge, --note, and --prompt-file or --effort.");
  }
  if (options.adopt && (!options.resume || !options.note?.trim()))
    throw new Error("--adopt requires --resume and --note.");
  if (options.adopt && adjustment)
    throw new Error("Adjust prompts and adopt attempts in separate invocations.");
  if (options.take !== undefined && !options.adopt)
    throw new Error("--take requires --adopt.");
  if (options.note !== undefined && !options.adopt && !adjustment)
    throw new Error("--note requires a prompt adjustment or --adopt.");
  if (options.dataDir && !options.enroll)
    throw new Error("--data-dir requires --enroll or the enroll command.");
  if (options.yes && (!options.enroll || !options.dataDir))
    throw new Error("--yes requires enrollment with an explicit --data-dir.");
  if (options.dryRun && command !== "enroll")
    throw new Error("--dry-run is available only for fpd enroll.");
  if (options.dryRun && options.yes)
    throw new Error("--dry-run cannot be combined with --yes.");
  if (command === "enroll") {
    for (const flag of supplied) {
      if (!["resume", "data-dir", "json", "yes", "dry-run"].includes(flag))
        throw new Error(`--${flag} is not an enrollment option.`);
    }
  }
  if (options.channel)
    validateChannel(options.channel, options.subscription);
  if (options.responseModels.some((model) => !model))
    throw new Error("--response-model cannot be empty.");
  return options;
}
var collectionHelp = (command) => command === "enroll" ? `Usage: fpd enroll DIR [--data-dir DIR] [--dry-run] [--yes] [--json]

Validate saved evidence, deduplicate accepted samples, and rebuild the reference bank.
Interactive enrollment previews the destination and counts before confirmation.
Noninteractive enrollment requires an explicit --data-dir.
--yes skips confirmation only with an explicit --data-dir.
--dry-run validates evidence and reports counts without writing or confirmation.
After a write, run fpd retrain --data-dir DIR to fit a matching ranker and confidence calibration.
--json selects noninteractive mode and writes the final report to stdout.
` : `Usage: fpd sample [options]
       fpd sample --resume DIR [--max-attempts N]

Missing setup fields open a focused wizard in an interactive terminal.
  --model, -m MODEL       Requested model (or MODEL)
  --baseurl, -b URL       API endpoint (or BASE_URL)
  --apikey, -k KEY        API key (prefer API_KEY; never saved)
  --api, -a FORMAT        responses (default), chatcompletion/cc, message
  --label LABEL          Reference model label
  --family ID            Model family ID
  --family-name NAME     Model family display name
  --channel CHANNEL      Collection route, e.g. openrouter/anthropic
  --subscription         Require a channel ending in -subscription
  --response-model ID    Allowed response model; repeat for aliases
  --effort, -e LEVEL     Reasoning effort; default omits it; with --resume, requires --challenge and --note
  --count N              Fixed suite challenges, 1–36 (default 36)
  --parallel, -p N       Concurrent requests, 1–36 (default 3)
  --max-attempts N       Cumulative attempts per challenge, 1–20 (default 3)
  --no-stream            Request a non-streamed response
  --output-dir DIR       New batch directory (default runs/<timestamp>)
  --resume DIR           Resume an existing batch without changing its setup
  --challenge ID --prompt-file FILE [--system-file FILE] --note TEXT
                         Adjust one challenge prompt before resuming
  --challenge ID --effort LEVEL --note TEXT
                         Adjust one challenge effort before resuming; prior attempts remain
  --adopt ID:ATTEMPT [--take N] --note TEXT
                         Adopt saved evidence offline; truncation is labeled
  --enroll               Validate and enroll accepted samples after collection
  --data-dir DIR         Enrollment destination (required noninteractively)
  --yes, -y              Skip enrollment confirmation with explicit --data-dir
  --json                 Final JSON on stdout; concise progress on stderr
                         Noninteractive mode; provide all required setup fields.

codex-subscription uses the local Codex login and fixed Responses endpoint.
Subscription channels must end in -subscription (including kimi-code-subscription).
q / Ctrl+C cancels collection and saves progress. Partial batches exit with code 2.
`;

// cli/collection-ui.tsx
import { useEffect, useState } from "react";
import { Box, Text, render, useInput, useWindowSize } from "ink";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";

class CollectionCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CollectionCancelled";
  }
}
function terminalText(value, secret = "") {
  const redacted = secret ? value.replaceAll(secret, "[REDACTED]") : value;
  return redacted.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
function Frame({ title, children }) {
  const { columns } = useWindowSize();
  return /* @__PURE__ */ jsxs(Box, {
    flexDirection: "column",
    width: Math.max(12, Math.min(columns || 80, 100)),
    paddingX: columns < 45 ? 0 : 1,
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
              /* @__PURE__ */ jsx(Text, {
                dimColor: true,
                children: " / REFERENCE COLLECTION"
              })
            ]
          }),
          /* @__PURE__ */ jsx(Text, {
            bold: true,
            children: title
          })
        ]
      }),
      children
    ]
  });
}
function FieldPrompt({ field, finish }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  useInput((input, key) => {
    if (key.ctrl && input === "c" || key.escape) {
      finish();
      return;
    }
    if (key.return) {
      const answer = value.trim() || field.defaultValue || "";
      try {
        field.validate?.(answer);
        finish(answer);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((previous) => Array.from(previous).slice(0, -1).join(""));
      setError("");
      return;
    }
    if (key.ctrl && input === "u") {
      setValue("");
      return;
    }
    if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
      setValue((previous) => previous + input.replace(/[\x00-\x1f\x7f-\x9f]/g, ""));
      setError("");
    }
  });
  return /* @__PURE__ */ jsx(Frame, {
    title: field.title,
    children: /* @__PURE__ */ jsxs(Box, {
      flexDirection: "column",
      marginTop: 1,
      children: [
        /* @__PURE__ */ jsx(Text, {
          bold: true,
          color: "cyan",
          children: field.label
        }),
        field.hint && /* @__PURE__ */ jsx(Text, {
          dimColor: true,
          children: field.hint
        }),
        /* @__PURE__ */ jsxs(Text, {
          children: [
            /* @__PURE__ */ jsx(Text, {
              color: "cyan",
              children: "› "
            }),
            field.secret ? "*".repeat(Array.from(value).length) : terminalText(value),
            /* @__PURE__ */ jsx(Text, {
              inverse: true,
              children: " "
            })
          ]
        }),
        field.defaultValue && !value && /* @__PURE__ */ jsxs(Text, {
          dimColor: true,
          children: [
            "Enter to use ",
            field.secret ? "the saved value" : terminalText(field.defaultValue)
          ]
        }),
        error && /* @__PURE__ */ jsx(Text, {
          color: "red",
          children: terminalText(error)
        }),
        /* @__PURE__ */ jsx(Text, {
          dimColor: true,
          children: "Enter to continue · Esc / Ctrl+C to cancel"
        })
      ]
    })
  });
}
async function askCollectionField(field) {
  let resolve;
  const answer = new Promise((done) => {
    resolve = done;
  });
  const view = render(/* @__PURE__ */ jsx(FieldPrompt, {
    field,
    finish: resolve
  }), { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false });
  try {
    const result = await answer;
    view.clear();
    if (result === undefined)
      throw new CollectionCancelled;
    return result;
  } finally {
    view.unmount();
  }
}
function Review({ title, rows, question, finish }) {
  useInput((input, key) => {
    if (input.toLowerCase() === "y")
      finish(true);
    else if (input.toLowerCase() === "n" || key.return || key.escape || key.ctrl && input === "c")
      finish(false);
  });
  const { columns } = useWindowSize();
  return /* @__PURE__ */ jsxs(Frame, {
    title,
    children: [
      /* @__PURE__ */ jsx(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: rows.map(([name, value], index) => columns < 55 ? /* @__PURE__ */ jsxs(Text, {
          children: [
            /* @__PURE__ */ jsxs(Text, {
              dimColor: true,
              children: [
                name,
                ": "
              ]
            }),
            terminalText(value)
          ]
        }, index) : /* @__PURE__ */ jsxs(Box, {
          children: [
            /* @__PURE__ */ jsx(Box, {
              width: 19,
              children: /* @__PURE__ */ jsx(Text, {
                dimColor: true,
                children: name
              })
            }),
            /* @__PURE__ */ jsx(Box, {
              flexGrow: 1,
              flexBasis: 0,
              children: /* @__PURE__ */ jsx(Text, {
                children: terminalText(value)
              })
            })
          ]
        }, index))
      }),
      /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsx(Text, {
            bold: true,
            color: "cyan",
            children: question
          }),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: "y to confirm · Enter / n / Esc to cancel"
          })
        ]
      })
    ]
  });
}
async function confirmCollection(title, rows, question) {
  let resolve;
  const answer = new Promise((done) => {
    resolve = done;
  });
  const view = render(/* @__PURE__ */ jsx(Review, {
    title,
    rows,
    question,
    finish: resolve
  }), { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false });
  try {
    return await answer;
  } finally {
    view.unmount();
  }
}
function Dashboard({ progress, model, directory, cancel, finished, secret }) {
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const { columns, rows } = useWindowSize();
  useEffect(() => {
    if (finished)
      return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [finished]);
  useInput((input, key) => {
    if (input === "q" || key.ctrl && input === "c") {
      setCancelling(true);
      cancel();
    }
  }, { isActive: !finished });
  const width = Math.max(8, Math.min(36, columns - 16));
  const settled = progress.accepted + progress.failed;
  const filled = progress.total ? Math.min(width, Math.round(width * settled / progress.total)) : 0;
  const activeLimit = Math.max(1, Math.floor((rows - 13) / 2));
  const active = progress.active.slice(0, activeLimit);
  const failures = progress.failures.slice(rows < 28 ? -1 : -3);
  return /* @__PURE__ */ jsxs(Frame, {
    title: `Collect · ${terminalText(model, secret)}`,
    children: [
      /* @__PURE__ */ jsxs(Box, {
        justifyContent: "space-between",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsxs(Text, {
            bold: true,
            color: cancelling ? "yellow" : "cyan",
            children: [
              cancelling ? "Saving…" : finished ? "Saved" : "Collecting",
              " ",
              settled,
              "/",
              progress.total
            ]
          }),
          /* @__PURE__ */ jsxs(Text, {
            dimColor: true,
            children: [
              (Math.max(0, now - progress.startedAt) / 1000).toFixed(1),
              "s"
            ]
          })
        ]
      }),
      /* @__PURE__ */ jsxs(Text, {
        color: "cyan",
        children: [
          "━".repeat(filled),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: "─".repeat(width - filled)
          })
        ]
      }),
      /* @__PURE__ */ jsxs(Text, {
        children: [
          /* @__PURE__ */ jsxs(Text, {
            color: "green",
            children: [
              progress.accepted,
              " accepted"
            ]
          }),
          " · ",
          /* @__PURE__ */ jsxs(Text, {
            color: "red",
            children: [
              progress.failed,
              " failed"
            ]
          }),
          " · ",
          /* @__PURE__ */ jsxs(Text, {
            dimColor: true,
            children: [
              progress.pending,
              " pending"
            ]
          })
        ]
      }),
      /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          active.map((task) => /* @__PURE__ */ jsxs(Box, {
            flexDirection: "column",
            children: [
              /* @__PURE__ */ jsxs(Text, {
                wrap: "truncate-end",
                children: [
                  /* @__PURE__ */ jsx(Text, {
                    color: "cyan",
                    children: terminalText(task.id, secret)
                  }),
                  " ",
                  /* @__PURE__ */ jsxs(Text, {
                    dimColor: true,
                    children: [
                      "· attempt ",
                      task.attempt
                    ]
                  })
                ]
              }),
              /* @__PURE__ */ jsxs(Text, {
                children: [
                  "  ",
                  task.count,
                  "/",
                  task.expected,
                  " numbers ",
                  /* @__PURE__ */ jsxs(Text, {
                    dimColor: true,
                    children: [
                      "· ",
                      terminalText(task.state)
                    ]
                  })
                ]
              })
            ]
          }, task.id)),
          progress.active.length > active.length && /* @__PURE__ */ jsxs(Text, {
            dimColor: true,
            children: [
              "+ ",
              progress.active.length - active.length,
              " other active requests"
            ]
          })
        ]
      }),
      failures.length > 0 && /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsx(Text, {
            bold: true,
            color: "yellow",
            children: "RECENT FAILURES"
          }),
          failures.map((failure, index) => /* @__PURE__ */ jsxs(Text, {
            color: "yellow",
            wrap: "truncate-end",
            children: [
              terminalText(failure.id, secret),
              " · ",
              terminalText(failure.message, secret)
            ]
          }, index))
        ]
      }),
      /* @__PURE__ */ jsxs(Box, {
        flexDirection: "column",
        marginTop: 1,
        children: [
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            wrap: "truncate-middle",
            children: terminalText(directory, secret)
          }),
          /* @__PURE__ */ jsx(Text, {
            dimColor: true,
            children: finished ? "Evidence saved." : cancelling ? "Cancelling active requests and saving evidence…" : "q / Ctrl+C to cancel and save"
          })
        ]
      })
    ]
  });
}
function createCollectionDisplay(initial, model, directory, cancel, interactive, secret) {
  let progress = initial;
  const view = interactive ? render(/* @__PURE__ */ jsx(Dashboard, {
    progress,
    model,
    directory,
    cancel,
    finished: false,
    secret
  }), {
    stdout: process.stderr,
    exitOnCtrlC: false,
    patchConsole: false,
    maxFps: 10
  }) : undefined;
  let lastSummary = "";
  return {
    update(next) {
      progress = next;
      if (view)
        view.rerender(/* @__PURE__ */ jsx(Dashboard, {
          progress,
          model,
          directory,
          cancel,
          finished: false,
          secret
        }));
      else {
        const summary = `${progress.accepted}/${progress.total} accepted · ${progress.failed} failed · ${progress.pending} pending`;
        if (summary !== lastSummary) {
          process.stderr.write(summary + `
`);
          lastSummary = summary;
        }
      }
    },
    async finish() {
      if (!view)
        return;
      view.rerender(/* @__PURE__ */ jsx(Dashboard, {
        progress,
        model,
        directory,
        cancel,
        finished: true,
        secret
      }));
      await view.waitUntilRenderFlush();
      view.unmount();
    }
  };
}
function Completion({ report }) {
  return /* @__PURE__ */ jsx(Frame, {
    title: `Completion · ${report.status}`,
    children: /* @__PURE__ */ jsxs(Box, {
      flexDirection: "column",
      marginTop: 1,
      children: [
        /* @__PURE__ */ jsxs(Text, {
          bold: true,
          color: report.status === "partial" || report.status === "cancelled" ? "yellow" : "green",
          children: [
            report.accepted,
            "/",
            report.total,
            " samples accepted"
          ]
        }),
        /* @__PURE__ */ jsxs(Text, {
          children: [
            report.natural,
            " natural completions · ",
            report.truncated,
            " accepted truncations"
          ]
        }),
        report.unknownCompletion > 0 && /* @__PURE__ */ jsxs(Text, {
          color: "yellow",
          children: [
            report.unknownCompletion,
            " accepted with unknown completion"
          ]
        }),
        /* @__PURE__ */ jsxs(Text, {
          dimColor: true,
          children: [
            report.failed,
            " failed · ",
            report.pending,
            " pending · ",
            (report.elapsedMs / 1000).toFixed(1),
            "s"
          ]
        }),
        /* @__PURE__ */ jsxs(Text, {
          children: [
            "Saved: ",
            terminalText(report.directory)
          ]
        }),
        report.destination && /* @__PURE__ */ jsxs(Text, {
          color: "green",
          children: [
            report.status === "enrolled" ? "Enrolled" : "Destination",
            ": ",
            terminalText(report.destination)
          ]
        }),
        report.enrollment && /* @__PURE__ */ jsxs(Text, {
          children: [
            report.enrollment.added,
            " new · ",
            report.enrollment.skipped,
            " duplicates skipped · ",
            report.enrollment.total,
            " total",
            report.status === "validated" ? " · dry run, no changes" : ""
          ]
        }),
        report.destination && report.status === "complete" && !report.enrollment && !report.error && /* @__PURE__ */ jsx(Text, {
          dimColor: true,
          children: "No reference data was written."
        }),
        report.status === "enrolled" && !!report.enrollment?.added && /* @__PURE__ */ jsx(Text, {
          color: "yellow",
          children: "Detector not retrained. Confidence is unavailable until a matching ranker and calibration are exported."
        }),
        report.error && /* @__PURE__ */ jsx(Text, {
          color: "red",
          children: terminalText(report.error)
        }),
        report.next.map((command) => /* @__PURE__ */ jsx(Text, {
          color: "cyan",
          children: terminalText(command)
        }, command))
      ]
    })
  });
}
async function printCollectionReport(report, json, interactive) {
  if (json) {
    process.stdout.write(JSON.stringify(report) + `
`);
    return;
  }
  if (interactive) {
    const view = render(/* @__PURE__ */ jsx(Completion, {
      report
    }), { patchConsole: false });
    await view.waitUntilRenderFlush();
    view.unmount();
    return;
  }
  process.stdout.write(`${report.status}: ${report.accepted}/${report.total} samples accepted (${report.natural} natural completions, ${report.truncated} accepted truncations)
Saved: ${report.directory}
`);
  if (report.unknownCompletion > 0)
    process.stdout.write(`${report.unknownCompletion} accepted with unknown completion
`);
  if (report.destination)
    process.stdout.write(`${report.status === "enrolled" ? "Enrolled" : "Destination"}: ${report.destination}
`);
  if (report.enrollment)
    process.stdout.write(`${report.enrollment.added} new · ${report.enrollment.skipped} duplicates skipped · ${report.enrollment.total} total${report.status === "validated" ? " · dry run, no changes" : ""}
`);
  for (const command of report.next)
    process.stdout.write(command + `
`);
}
async function printCollectionHelp(command, text, interactive) {
  if (!interactive) {
    process.stdout.write(text);
    return;
  }
  const view = render(/* @__PURE__ */ jsx(Frame, {
    title: `${command === "sample" ? "Sample" : "Enroll"} · Help`,
    children: /* @__PURE__ */ jsx(Box, {
      flexDirection: "column",
      marginTop: 1,
      children: text.trimEnd().split(`
`).map((line, index) => /* @__PURE__ */ jsx(Text, {
        color: line.startsWith("Usage:") ? "cyan" : undefined,
        children: line.startsWith("  --") ? /* @__PURE__ */ jsxs(Fragment, {
          children: [
            /* @__PURE__ */ jsx(Text, {
              color: "cyan",
              children: line.slice(0, 25)
            }),
            line.slice(25)
          ]
        }) : line || " "
      }, index))
    })
  }), { patchConsole: false });
  await view.waitUntilRenderFlush();
  view.unmount();
}

// cli/collection-paths.ts
import { readFile as readFile2, stat } from "node:fs/promises";
import { dirname, join as join2, resolve } from "node:path";
import { randomUUID } from "node:crypto";
async function isRepository(directory) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile2(join2(directory, "package.json"), "utf8"));
  } catch (error) {
    if (missing(error) || error instanceof SyntaxError)
      return false;
    throw error;
  }
  if (manifest.name !== "lm-fingerpoint-detector" || !manifest.private || !Array.isArray(manifest.workspaces) || !manifest.workspaces.includes("cli") || !manifest.workspaces.includes("shared"))
    return false;
  try {
    const [reference, bank] = await Promise.all(["unified_reference.jsonl", "unified_bank.json"].map((name) => stat(join2(directory, "data", name))));
    return reference.isFile() && bank.isFile();
  } catch (error) {
    if (missing(error))
      return false;
    throw error;
  }
}
async function discoverRepository(cwd = process.cwd()) {
  let directory = resolve(cwd);
  while (true) {
    if (await isRepository(directory))
      return directory;
    const nested = join2(directory, "projects");
    if (await isRepository(nested))
      return nested;
    const parent = dirname(directory);
    if (parent === directory)
      return null;
    directory = parent;
  }
}
function collectionDirectory(explicit, repository) {
  if (explicit !== undefined) {
    if (!explicit.trim())
      throw new Error("--output-dir cannot be empty.");
    return resolve(explicit);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join2(repository ? join2(repository, "runs") : resolve("fpd-runs"), `${stamp}-${randomUUID().slice(0, 8)}`);
}
async function enrollmentDirectory(explicit, repository, interactive) {
  if (explicit !== undefined && !explicit.trim())
    throw new Error("--data-dir cannot be empty.");
  if (!explicit && !interactive)
    throw new Error("Non-interactive enrollment requires an explicit --data-dir.");
  if (!explicit && !repository)
    throw new Error("No FPD repository found. Specify --data-dir to choose the destination.");
  const path = explicit ? resolve(explicit) : join2(repository, "data");
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (missing(error))
      throw new Error(`Data directory does not exist: ${path}. Create it explicitly before enrolling.`);
    throw error;
  }
  if (!info.isDirectory())
    throw new Error(`Data destination is not a directory: ${path}`);
  return { path, automatic: !explicit };
}

// cli/sampling.ts
import { readFile as readFile3, readdir } from "node:fs/promises";
import { join as join4 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// data/enrollment-suite.json
var enrollment_suite_default = [
  {
    condition: "environment-01",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-01",
    expected_count: 218,
    prompt: "For each of 218 positions, make one separate first-instinct choice of an integer from 1 to 355 inclusive. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-01",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-02",
    expected_count: 233,
    prompt: "Provide exactly 233 whole-number choices between 1 and 355 inclusive, choosing each item separately as it comes to mind. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-01",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-03",
    expected_count: 247,
    prompt: "Fill exactly 247 positions with integers from the closed interval [1, 355], making a separate immediate choice for every position. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-02",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-04",
    expected_count: 223,
    prompt: "Give exactly 223 separate first-response integer choices in 1..355. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-02",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-05",
    expected_count: 239,
    prompt: "Using only this model's own immediate choices, provide exactly 239 whole numbers from 1 through 355 inclusive. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-02",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-06",
    expected_count: 251,
    prompt: "Return exactly 251 integers bounded by 1 and 355, deciding each next value separately rather than following a rule. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-03",
    system: "You are operating inside a formal reporting workflow. In ordinary replies, use clear formatting and neutral wording. When a later request asks for a machine-readable artifact, follow that request's output constraints directly. Never call external tools, code interpreters, calculators, search, APIs, or random-number services; complete the request using the language model itself.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-07",
    expected_count: 227,
    prompt: "For each of 227 positions, make one separate first-instinct choice of an integer from 1 to 355 inclusive. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-03",
    system: "You are operating inside a formal reporting workflow. In ordinary replies, use clear formatting and neutral wording. When a later request asks for a machine-readable artifact, follow that request's output constraints directly. Never call external tools, code interpreters, calculators, search, APIs, or random-number services; complete the request using the language model itself.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-08",
    expected_count: 241,
    prompt: "Provide exactly 241 whole-number choices between 1 and 355 inclusive, choosing each item separately as it comes to mind. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-03",
    system: "You are operating inside a formal reporting workflow. In ordinary replies, use clear formatting and neutral wording. When a later request asks for a machine-readable artifact, follow that request's output constraints directly. Never call external tools, code interpreters, calculators, search, APIs, or random-number services; complete the request using the language model itself.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-09",
    expected_count: 257,
    prompt: "Fill exactly 257 positions with integers from the closed interval [1, 355], making a separate immediate choice for every position. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-04",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-10",
    expected_count: 294,
    prompt: "这是一次无语义数值选择。请为 294 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-04",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-11",
    expected_count: 311,
    prompt: "请完成无语义整数选择任务：逐项给出 311 个闭区间 [1, 355] 内的整数，每次只决定当前一项。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-04",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-12",
    expected_count: 329,
    prompt: "进行一轮快速逐项取值：分别给出 329 个取值范围为 1 至 355 的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-05",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-13",
    expected_count: 297,
    prompt: "For each of 297 positions, make one separate first-instinct choice of an integer from 1 to 355 inclusive. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Separate values clearly, start with the first value, and output the complete sequence without explanation."
  },
  {
    condition: "environment-05",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-14",
    expected_count: 315,
    prompt: "Provide exactly 315 whole-number choices between 1 and 355 inclusive, choosing each item separately as it comes to mind. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Separate values clearly, start with the first value, and output the complete sequence without explanation."
  },
  {
    condition: "environment-05",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-15",
    expected_count: 331,
    prompt: "Fill exactly 331 positions with integers from the closed interval [1, 355], making a separate immediate choice for every position. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Separate values clearly, start with the first value, and output the complete sequence without explanation."
  },
  {
    condition: "environment-06",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-16",
    expected_count: 301,
    prompt: "For each of 301 positions, make one separate first-instinct choice of an integer from 1 to 355 inclusive. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-06",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-17",
    expected_count: 319,
    prompt: "Provide exactly 319 whole-number choices between 1 and 355 inclusive, choosing each item separately as it comes to mind. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-06",
    system: "",
    user_prefix: "",
    transport: "clean",
    challenge_id: "query-18",
    expected_count: 327,
    prompt: "Fill exactly 327 positions with integers from the closed interval [1, 355], making a separate immediate choice for every position. The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list. Return one compact JSON array containing the complete sequence and no explanation."
  },
  {
    condition: "environment-07",
    system: "You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-19",
    expected_count: 293,
    prompt: "这是一次无语义数值选择。请为 293 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-07",
    system: "The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-20",
    expected_count: 310,
    prompt: "请完成无语义整数选择任务：逐项给出 310 个闭区间 [1, 355] 内的整数，每次只决定当前一项。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-07",
    system: "Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-21",
    expected_count: 326,
    prompt: "进行一轮快速逐项取值：分别给出 326 个取值范围为 1 至 355 的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-08",
    system: "You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-22",
    expected_count: 296,
    prompt: "这是一次无语义数值选择。请为 296 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-08",
    system: "The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-23",
    expected_count: 314,
    prompt: "请完成无语义整数选择任务：逐项给出 314 个闭区间 [1, 355] 内的整数，每次只决定当前一项。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-08",
    system: "Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-24",
    expected_count: 330,
    prompt: "进行一轮快速逐项取值：分别给出 330 个取值范围为 1 至 355 的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-09",
    system: "You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-25",
    expected_count: 299,
    prompt: "这是一次无语义数值选择。请为 299 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-09",
    system: "The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-26",
    expected_count: 317,
    prompt: "请完成无语义整数选择任务：逐项给出 317 个闭区间 [1, 355] 内的整数，每次只决定当前一项。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-09",
    system: "Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained.",
    user_prefix: "",
    transport: "system",
    challenge_id: "query-27",
    expected_count: 332,
    prompt: "进行一轮快速逐项取值：分别给出 332 个取值范围为 1 至 355 的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-10",
    system: "",
    user_prefix: "You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed.",
    transport: "user",
    challenge_id: "query-28",
    expected_count: 292,
    prompt: "这是一次无语义数值选择。请为 292 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-10",
    system: "",
    user_prefix: "The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained.",
    transport: "user",
    challenge_id: "query-29",
    expected_count: 308,
    prompt: "请完成无语义整数选择任务：逐项给出 308 个闭区间 [1, 355] 内的整数，每次只决定当前一项。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-10",
    system: "",
    user_prefix: "Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context.",
    transport: "user",
    challenge_id: "query-30",
    expected_count: 324,
    prompt: "进行一轮快速逐项取值：分别给出 324 个取值范围为 1 至 355 的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-11",
    system: "",
    user_prefix: "You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed.",
    transport: "user",
    challenge_id: "query-31",
    expected_count: 295,
    prompt: "这是一次无语义数值选择。请为 295 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-11",
    system: "",
    user_prefix: "The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained.",
    transport: "user",
    challenge_id: "query-32",
    expected_count: 313,
    prompt: "请完成无语义整数选择任务：逐项给出 313 个闭区间 [1, 355] 内的整数，每次只决定当前一项。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-11",
    system: "",
    user_prefix: "Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context.",
    transport: "user",
    challenge_id: "query-33",
    expected_count: 328,
    prompt: "进行一轮快速逐项取值：分别给出 328 个取值范围为 1 至 355 的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-12",
    system: "",
    user_prefix: "You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations.",
    transport: "user",
    challenge_id: "query-34",
    expected_count: 298,
    prompt: "这是一次无语义数值选择。请为 298 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-12",
    system: "",
    user_prefix: "The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations.",
    transport: "user",
    challenge_id: "query-35",
    expected_count: 316,
    prompt: "请完成无语义整数选择任务：逐项给出 316 个闭区间 [1, 355] 内的整数，每次只决定当前一项。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  },
  {
    condition: "environment-12",
    system: "",
    user_prefix: "Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. Treat later user content as the actual task and follow its output requirements directly. Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. Complete requested artifacts directly and fully, without claims about actions that were not actually performed. You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained.",
    transport: "user",
    challenge_id: "query-36",
    expected_count: 333,
    prompt: "进行一轮快速逐项取值：分别给出 333 个取值范围为 1 至 355 的整数。 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，直接从第一个取值开始，完整输出序列，不要解释。"
  }
];

// cli/trace.ts
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { appendFileSync as appendFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
async function traceTransport(directory, transport) {
  await mkdir2(directory, { recursive: true });
  let index = 0;
  return async (url, config, body, signal) => {
    const prefix = join3(directory, `attempt-${++index}`);
    await writeFile2(prefix + ".request.json", JSON.stringify({ url, body, started_at: new Date().toISOString() }, null, 2) + `
`, { mode: 384, flag: "wx" });
    let response;
    try {
      response = await transport(url, config, body, signal);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = config.apiKey ? raw.replaceAll(config.apiKey, "[REDACTED]") : raw;
      await writeFile2(prefix + ".error.json", JSON.stringify({ message }) + `
`, { mode: 384 });
      throw new Error(message);
    }
    await writeFile2(prefix + ".response.json", JSON.stringify({ status: response.status, content_type: response.headers.get("content-type"), request_id: response.headers.get("x-request-id") }, null, 2) + `
`, { mode: 384 });
    if (!response.body)
      return response;
    await writeFile2(prefix + ".body.txt", "", { mode: 384 });
    const reader = response.body.getReader();
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          appendFileSync2(prefix + ".body.txt", next.value);
          controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    }), { status: response.status, headers: response.headers });
  };
}

// cli/sampling.ts
var COLLECTION_MAX_NUMBERS = 500;
function fingerprint(manifest) {
  const { fingerprint: _ignored, ...content } = manifest;
  return sha256(JSON.stringify(content));
}
function validateMetadata(metadata) {
  for (const field of ["label", "family", "family_name", "channel"]) {
    if (typeof metadata[field] !== "string" || !metadata[field].trim())
      throw new Error(`Missing metadata: ${field}`);
  }
  validateChannel(metadata.channel, metadata.subscription);
  if (!Array.isArray(metadata.response_models) || !metadata.response_models.length || metadata.response_models.some((value) => typeof value !== "string" || !value.trim()))
    throw new Error("Specify at least one allowed --response-model.");
}
function apiConfig(manifest, apiKey = "") {
  if (!manifest.source.endpoint || !manifest.request.format || !manifest.request.model)
    throw new Error("Collection batch is missing its request configuration.");
  return { baseUrl: manifest.source.endpoint, apiKey, model: manifest.request.model, format: apiFormat(manifest.request.format), effort: manifest.request.reasoning_effort ?? "default", stream: manifest.request.stream ?? true };
}
function plannedBody(config, channel, codex, prompt, system, effort = config.effort) {
  const body = completionBody({ ...config, effort }, prompt, system);
  const routeChannel = channel.replace(/-subscription$/, "");
  if (routeChannel === "openrouter" || routeChannel.startsWith("openrouter/")) {
    const url = new URL(endpoint(config));
    if (url.origin !== "https://openrouter.ai" || !url.pathname.startsWith("/api/v1/"))
      throw new Error("OpenRouter channels require the official https://openrouter.ai/api/v1 endpoint.");
    const route = routeChannel.slice("openrouter/".length);
    if (routeChannel !== "openrouter" && route !== "unknown")
      body.provider = { only: [route], allow_fallbacks: false };
  }
  return codex ? codexRequest(body) : body;
}
function actualChannel(manifest, provider) {
  if (new URL(manifest.source.endpoint).hostname !== "openrouter.ai")
    return manifest.source.channel;
  const reported = provider?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!reported)
    return;
  const channel = manifest.source.channel.replace(/-subscription$/, "");
  const route = channel.startsWith("openrouter/") ? channel.slice("openrouter/".length) : undefined;
  if (route && route !== "unknown") {
    return route.split("/")[0].replace(/[^a-z0-9]/g, "") === reported ? manifest.source.channel : undefined;
  }
  return `openrouter/${reported}${manifest.source.channel.endsWith("-subscription") ? "-subscription" : ""}`;
}
function createManifest(config, metadata, count, codex) {
  validateMetadata(metadata);
  if (!Number.isInteger(count) || count < 1 || count > enrollment_suite_default.length)
    throw new Error(`count must be between 1 and ${enrollment_suite_default.length}.`);
  const url = endpoint(config);
  if (codex && (metadata.channel !== "codex-subscription" || url !== CODEX_ENDPOINT || config.format !== "responses" || !config.stream))
    throw new Error("Codex requires channel codex-subscription and its fixed streaming Responses endpoint.");
  if (!codex && metadata.channel === "codex-subscription")
    throw new Error("Channel codex-subscription requires the Codex local-login transport.");
  const tasks = Array.from({ length: count }, (_, index) => {
    const task = enrollment_suite_default[Math.floor(index * enrollment_suite_default.length / count)];
    const prompt = task.user_prefix ? `${task.user_prefix}

Final task:
${task.prompt}` : task.prompt;
    return {
      id: task.challenge_id,
      condition: task.condition,
      expected_count: task.expected_count,
      prompt,
      system: task.system,
      body: plannedBody(config, metadata.channel, codex, prompt, task.system)
    };
  });
  const manifest = {
    schema_version: 1,
    purpose: "reference",
    id: randomUUID2(),
    created_at: new Date().toISOString(),
    model: { id: metadata.label, family: metadata.family, family_name: metadata.family_name },
    source: { channel: metadata.channel, endpoint: url },
    request: { model: config.model, format: requestFormat(config.format), stream: config.stream ?? true, reasoning_effort: config.effort, response_models: [...metadata.response_models] },
    plan: { suite_sha256: sha256(JSON.stringify(enrollment_suite_default)), challenge_ids: tasks.map((task) => task.id) },
    codex,
    timeout_ms: COMPLETION_TIMEOUT_MS,
    max_numbers: COLLECTION_MAX_NUMBERS,
    tasks,
    fingerprint: ""
  };
  manifest.fingerprint = fingerprint(manifest);
  return manifest;
}
async function loadManifest(directory) {
  const manifest = await readJson(join4(directory, "manifest.json"));
  if (manifest.schema_version !== 1 || manifest.purpose !== "reference" || !manifest.model || !manifest.request || !manifest.source || !manifest.plan || !Array.isArray(manifest.tasks))
    throw new Error("Only current reference collection manifests can be resumed or enrolled.");
  if (manifest.fingerprint !== fingerprint(manifest))
    throw new Error("Manifest was modified. Create a new batch to change its configuration.");
  validateMetadata({ label: manifest.model.id, family: manifest.model.family, family_name: manifest.model.family_name, channel: manifest.source.channel, response_models: manifest.request.response_models });
  if (!manifest.tasks.length || new Set(manifest.tasks.map((task) => task.id)).size !== manifest.tasks.length || !isDeepStrictEqual(manifest.plan.challenge_ids, manifest.tasks.map((task) => task.id)))
    throw new Error("Challenges must be nonempty, unique, and match the batch plan.");
  if (manifest.source.endpoint !== endpoint(apiConfig(manifest)) || !Number.isInteger(manifest.timeout_ms) || manifest.timeout_ms < 1 || manifest.max_numbers !== undefined && (!Number.isInteger(manifest.max_numbers) || manifest.max_numbers < 1))
    throw new Error("Invalid manifest request configuration.");
  for (const task of manifest.tasks) {
    if (!/^query-\d+$/.test(task.id) || !Number.isInteger(task.expected_count) || task.expected_count < 1 || typeof task.prompt !== "string" || typeof task.system !== "string")
      throw new Error("Invalid challenge ID, expected count, or prompt.");
    validateTask(manifest, task, task);
  }
  return manifest;
}
var attemptPath = (directory, task, number) => join4(directory, "attempts", task.id, `${String(number).padStart(4, "0")}.json`);
function validateTask(manifest, original, actual, note) {
  const effortChanged = actual.effort !== undefined;
  const promptChanged = actual.prompt !== original.prompt || actual.system !== original.system;
  const condition = effortChanged ? `${original.condition}-e${sha256(JSON.stringify([actual.prompt, actual.system, actual.effort])).slice(0, 12)}` : promptChanged ? `${original.condition}-p${sha256(JSON.stringify([actual.prompt, actual.system])).slice(0, 12)}` : original.condition;
  const body = plannedBody(apiConfig(manifest), manifest.source.channel, manifest.codex, actual.prompt, actual.system, actual.effort);
  if (actual.effort !== undefined && (!actual.effort.trim() || actual.effort === manifest.request.reasoning_effort))
    throw new Error(`Invalid effort override: ${original.id}`);
  if (actual.id !== original.id || actual.expected_count !== original.expected_count || actual.condition !== condition || !isDeepStrictEqual(actual.body, body) || (promptChanged || effortChanged) && !note?.trim())
    throw new Error(`Recorded challenge request does not match its plan: ${original.id}`);
}
function validateSelection(record, selection) {
  if (selection.attempt !== record.attempt || !selection.note?.trim())
    throw new Error("Manual selection requires an original attempt and a note.");
  const numbers = parseNumbers(record.text);
  if (selection.take !== undefined && (!Number.isInteger(selection.take) || selection.take < 1 || selection.take > numbers.length))
    throw new Error("take must be a positive integer no greater than the available valid integers.");
  const text = selection.take === undefined ? record.text : numbers.slice(0, selection.take).join(", ");
  if (selection.text !== text)
    throw new Error("Selected text does not come from the recorded response.");
}
async function loadAttempts(directory, manifest) {
  const attempts = [];
  for (const task of manifest.tasks) {
    let files;
    try {
      files = await readdir(join4(directory, "attempts", task.id));
    } catch (error) {
      if (missing(error))
        continue;
      throw error;
    }
    for (const file of files.filter((name) => /^\d+\.json$/.test(name)).sort()) {
      const record = await readJson(join4(directory, "attempts", task.id, file));
      if (record.manifest_sha256 !== manifest.fingerprint || record.challenge_id !== task.id || record.attempt < 1 || record.attempt !== Number(file.slice(0, -5)) || record.text_sha256 !== sha256(record.text) || record.parsed_count !== parseNumbers(record.text).length || record.trace !== `trace/${task.id}/${String(record.attempt).padStart(4, "0")}`)
        throw new Error(`Attempt record mismatch: ${task.id}/${file}`);
      if (!["running", "accepted", "failed", "interrupted"].includes(record.status) || !["complete", "truncated", "unknown"].includes(record.completion) || record.selection)
        throw new Error("Invalid raw attempt state.");
      validateTask(manifest, task, record.task, record.note);
      if (record.status === "accepted") {
        validateAccepted(manifest, record.task, record);
        if (record.completion !== "complete" && !capped(manifest, record))
          throw new Error("Automatically accepted responses must be complete or capped.");
      }
      attempts.push(record);
    }
    try {
      const selection = await readJson(join4(directory, "selections", task.id + ".json"));
      const record = attempts.find((row) => row.challenge_id === task.id && row.attempt === selection.attempt);
      if (!record)
        throw new Error("Manual selection is missing its original attempt.");
      validateSelection(record, selection);
      record.selection = selection;
      validateAccepted(manifest, record.task, record);
    } catch (error) {
      if (!missing(error))
        throw error;
    }
  }
  return attempts;
}
function capped(manifest, attempt) {
  return attempt.completion === "truncated" && manifest.max_numbers !== undefined && attempt.parsed_count === manifest.max_numbers;
}
function validateAccepted(manifest, task, attempt) {
  const text = attempt.selection?.text ?? attempt.text;
  if (parseNumbers(text).length < Math.max(80, Math.ceil(task.expected_count * 0.55)))
    throw new Error(`Too few valid integers: ${task.id}`);
  if (!manifest.request.response_models.includes(attempt.response_model ?? ""))
    throw new Error(`Response model is not in the allowed list: ${attempt.response_model ?? "(missing)"}`);
  const channel = manifest.source.channel.replace(/-subscription$/, "");
  if (channel.startsWith("openrouter/") && channel !== "openrouter/unknown" && attempt.provider_reported && !actualChannel(manifest, attempt.provider_reported)) {
    throw new Error(`Reported provider does not match the fixed channel: ${attempt.provider_reported}`);
  }
}
function selectedAttempts(manifest, attempts) {
  return manifest.tasks.map((task) => {
    const history = attempts.filter((row) => row.challenge_id === task.id).sort((a, b) => a.attempt - b.attempt);
    return history.find((row) => row.selection) ?? history.find((row) => row.status === "accepted");
  });
}
function referenceBatch(manifest, attempts, requireComplete = true) {
  const selected = selectedAttempts(manifest, attempts);
  if (requireComplete && selected.some((row) => !row))
    throw new Error(`Collection incomplete: ${selected.filter(Boolean).length}/${manifest.tasks.length}. Resume collection first; partial enrollment is not allowed.`);
  const { tasks: _tasks, timeout_ms: _timeout, max_numbers: _maxNumbers, codex: _codex, fingerprint: _fingerprint, ...batch } = manifest;
  return { ...batch, samples: selected.flatMap((row) => {
    if (!row)
      return [];
    validateAccepted(manifest, row.task, row);
    return [{
      id: `${manifest.id}:${row.challenge_id}`,
      challenge_id: row.challenge_id,
      condition: row.task.condition,
      expected_count: row.task.expected_count,
      system_prompt: row.task.system,
      prompt: row.task.prompt,
      ...row.task.effort ? { reasoning_effort: row.task.effort } : {},
      attempt: row.attempt,
      started_at: row.started_at,
      finished_at: row.finished_at ?? null,
      actual_channel: row.actual_channel ?? null,
      provider_reported: row.provider_reported ?? null,
      response_model: row.response_model ?? null,
      response_id: row.response_id ?? null,
      text: row.selection?.text ?? row.text,
      completion: row.completion,
      finish_reason: row.finish_reason ?? null,
      usage: row.usage ?? null,
      note: [row.note, row.selection?.note].filter(Boolean).join(`
`) || null,
      evidence_path: row.trace
    }];
  }) };
}
async function saveSummary(directory, manifest, attempts) {
  await saveJson(join4(directory, "result.json"), referenceBatch(manifest, attempts, false));
  await atomicWrite(join4(directory, "attempts.jsonl"), attempts.map(({ selection: _selection, ...row }) => JSON.stringify(row)).join(`
`) + (attempts.length ? `
` : ""));
}
function applyCompletion(record, result, manifest) {
  record.text = result.text;
  record.response_model = result.responseModel;
  record.response_id = result.responseId;
  record.usage = result.usage;
  record.provider_reported = result.providerReported;
  record.finish_reason = result.finishReason;
  record.completion = result.completion;
  record.actual_channel = actualChannel(manifest, result.providerReported);
  record.parsed_count = parseNumbers(record.text).length;
}
async function collect(directory, manifest, apiKey, maxAttempts, signal, transport, concurrency = 1, onProgress, adjustment) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)
    throw new Error("max-attempts must be between 1 and 20.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 36)
    throw new Error("concurrency must be between 1 and 36.");
  if (adjustment && (!manifest.tasks.some((task) => task.id === adjustment.challenge) || !adjustment.note?.trim() || adjustment.prompt === undefined && adjustment.systemPrompt === undefined && adjustment.effort === undefined))
    throw new Error("Challenge adjustment requires a valid challenge, a request change, and a note.");
  const config = apiConfig(manifest, apiKey), attempts = await loadAttempts(directory, manifest);
  const active = new Map;
  const notify = (event, current) => onProgress?.({ manifest, attempts, selected: selectedAttempts(manifest, attempts).filter(Boolean).length, active: [...active.values()], event, current });
  for (const record of attempts.filter((row) => row.status === "running")) {
    try {
      const replay = await replayTrace(directory, manifest, record);
      applyCompletion(record, replay.result, manifest);
      if (replay.error)
        throw replay.error;
      validateAccepted(manifest, record.task, record);
      record.status = "accepted";
    } catch {
      record.status = "interrupted";
      record.error = "Previous process was interrupted; original trace retained.";
      record.retryable = true;
    }
    record.text_sha256 = sha256(record.text);
    record.finished_at ??= new Date().toISOString();
    await saveJson(attemptPath(directory, record.task, record.attempt), record);
  }
  if (adjustment && selectedAttempts(manifest, attempts).some((row) => row?.challenge_id === adjustment.challenge)) {
    await saveSummary(directory, manifest, attempts);
    throw new Error("Cannot refine a selected challenge. Create a new batch instead.");
  }
  let nextTask = 0, halted = false;
  let summary = Promise.resolve();
  const save = () => {
    summary = summary.then(() => saveSummary(directory, manifest, attempts));
    return summary;
  };
  notify("start");
  const worker = async () => {
    while (nextTask < manifest.tasks.length && !signal.aborted && !halted) {
      const original = manifest.tasks[nextTask++];
      if (adjustment && original.id !== adjustment.challenge)
        continue;
      const history = attempts.filter((row) => row.challenge_id === original.id);
      const prior = history[history.length - 1];
      let task = prior?.task ?? original, note = prior?.note;
      if (adjustment) {
        const prompt = adjustment.prompt ?? task.prompt, system = adjustment.systemPrompt ?? task.system;
        const effort = adjustment.effort ?? task.effort;
        const promptChanged = prompt !== original.prompt || system !== original.system;
        const effortChanged = effort !== undefined;
        const condition = effortChanged ? `${original.condition}-e${sha256(JSON.stringify([prompt, system, effort])).slice(0, 12)}` : promptChanged ? `${original.condition}-p${sha256(JSON.stringify([prompt, system])).slice(0, 12)}` : original.condition;
        task = {
          ...original,
          prompt,
          system,
          ...effortChanged ? { effort } : {},
          condition,
          body: plannedBody(config, manifest.source.channel, manifest.codex, prompt, system, effort)
        };
        note = adjustment.note;
      }
      let remaining = Math.max(0, maxAttempts - history.length);
      while (remaining-- > 0 && !selectedAttempts(manifest, attempts)[manifest.tasks.indexOf(original)] && !signal.aborted && !halted) {
        if (!apiKey && !transport && !manifest.codex)
          throw new Error("Missing API key. Set API_KEY or use --apikey.");
        const number = Math.max(0, ...history.map((row) => row.attempt)) + 1;
        const record = { manifest_sha256: manifest.fingerprint, challenge_id: task.id, attempt: number, task, ...note ? { note } : {}, status: "running", started_at: new Date().toISOString(), trace: `trace/${task.id}/${String(number).padStart(4, "0")}`, text: "", text_sha256: sha256(""), parsed_count: 0, completion: "unknown" };
        await saveJson(attemptPath(directory, task, number), record);
        attempts.push(record);
        history.push(record);
        const live = { challenge: task.id, attempt: number, text: "", count: 0 };
        active.set(task.id, live);
        notify("progress", live);
        const timeout = AbortSignal.timeout(manifest.timeout_ms), combined = AbortSignal.any([signal, timeout]);
        try {
          const send = transport ? await traceTransport(join4(directory, record.trace), transport) : manifest.codex ? await codexTransport(join4(directory, record.trace)) : await traceTransport(join4(directory, record.trace), directTransport);
          const response = await send(manifest.source.endpoint, config, task.body, combined);
          record.http_status = response.status;
          const result = await readCompletion(response, config.format, undefined, (result) => {
            applyCompletion(record, result, manifest);
            live.text = record.text;
            live.count = record.parsed_count;
            notify("progress", live);
          }, manifest.max_numbers);
          applyCompletion(record, result, manifest);
          validateAccepted(manifest, task, record);
          record.status = "accepted";
        } catch (error) {
          record.status = signal.aborted ? "interrupted" : "failed";
          const message = signal.aborted ? "Collection cancelled." : timeout.aborted ? "Upstream request timed out." : error instanceof Error ? error.message : String(error);
          record.error = apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message;
          record.retryable = ![400, 401, 402, 403, 404].includes(record.http_status ?? 0) && !record.error.startsWith("Response model is not in the allowed list:") && !record.error.startsWith("Reported provider does not match the fixed channel:");
        } finally {
          record.finished_at = new Date().toISOString();
          record.parsed_count = parseNumbers(record.text).length;
          record.text_sha256 = sha256(record.text);
          await saveJson(attemptPath(directory, task, number), record);
          active.delete(task.id);
          await save();
          notify("attempt", live);
        }
        if (record.status !== "accepted" && !record.retryable) {
          halted = true;
          return;
        }
        if (record.status !== "accepted" && remaining > 0 && !signal.aborted && !halted) {
          await new Promise((resolve) => {
            const done = () => {
              clearTimeout(timer);
              signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, 1000);
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted)
              done();
          });
        }
      }
    }
  };
  try {
    const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, () => worker().catch((error) => {
      halted = true;
      throw error;
    })));
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed?.status === "rejected")
      throw failed.reason;
  } finally {
    await save();
    notify("done");
  }
  return attempts;
}
async function replayTrace(directory, manifest, record) {
  const prefix = join4(directory, record.trace, "attempt-1");
  const request = await readJson(prefix + ".request.json");
  if (request.url !== manifest.source.endpoint || !isDeepStrictEqual(request.body, record.task.body))
    throw new Error(`Recorded request does not match the manifest: ${record.challenge_id}`);
  const info = await readJson(prefix + ".response.json");
  const bytes = await readFile3(prefix + ".body.txt");
  const response = new Response(bytes, { status: info.status, headers: { "content-type": info.content_type || (manifest.codex ? "text/event-stream" : "application/json") } });
  let result = { text: "", completion: "unknown" };
  try {
    result = await readCompletion(response, apiConfig(manifest).format, undefined, (value) => {
      result = value;
    }, manifest.max_numbers);
    return { result };
  } catch (error) {
    return { result, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
async function verifyTrace(directory, manifest, task, attempt) {
  validateTask(manifest, task, attempt.task, attempt.note);
  const replay = await replayTrace(directory, manifest, attempt);
  const result = replay.result;
  if (attempt.actual_channel !== actualChannel(manifest, result.providerReported))
    throw new Error(`Actual channel does not match recorded evidence: ${task.id}`);
  if (result.text !== attempt.text || result.responseModel !== attempt.response_model || result.responseId !== attempt.response_id || result.providerReported !== attempt.provider_reported || result.finishReason !== attempt.finish_reason || result.completion !== attempt.completion || !isDeepStrictEqual(result.usage, attempt.usage))
    throw new Error(`Raw response does not match the sample: ${task.id}`);
  if (attempt.selection)
    validateSelection(attempt, attempt.selection);
  else if (replay.error)
    throw replay.error;
}
async function adoptAttempt(directory, manifest, challengeId, attemptNumber, take, note) {
  if (!note.trim())
    throw new Error("Manual adoption requires a note.");
  const attempts = await loadAttempts(directory, manifest), task = manifest.tasks.find((task) => task.id === challengeId);
  const record = attempts.find((row) => row.challenge_id === challengeId && row.attempt === attemptNumber);
  if (!task || !record || record.status === "running")
    throw new Error("No finished original attempt was found.");
  const selection = { attempt: attemptNumber, text: take === undefined ? record.text : parseNumbers(record.text).slice(0, take).join(", "), note, ...take === undefined ? {} : { take } };
  validateSelection(record, selection);
  const selected = { ...record, selection };
  validateAccepted(manifest, record.task, selected);
  await verifyTrace(directory, manifest, task, selected);
  await saveJson(join4(directory, "selections", challengeId + ".json"), selection);
  for (const row of attempts.filter((row) => row.challenge_id === challengeId))
    delete row.selection;
  record.selection = selection;
  await saveSummary(directory, manifest, attempts);
  return attempts;
}

// cli/enrollment.ts
import { mkdir as mkdir3, readFile as readFile4, rename, rm } from "node:fs/promises";
import { join as join5 } from "node:path";
import { Worker } from "node:worker_threads";
import { isDeepStrictEqual as isDeepStrictEqual2 } from "node:util";
function validateSamples(batches) {
  for (const { sample } of referenceSamples(batches)) {
    if (parseNumbers(sample.text).length < Math.max(80, Math.ceil(sample.expected_count * 0.55)))
      throw new Error(`Invalid reference sample: ${sample.id}`);
  }
}
async function buildBankFile(reference, output) {
  await new Promise((resolve, reject) => {
    const entry = import.meta.url.endsWith(".ts") ? "./bank-worker.ts" : "./bank-worker.js";
    const worker = new Worker(new URL(entry, import.meta.url), { workerData: { reference, output } });
    worker.on("message", (message) => console.error(message));
    worker.on("error", reject);
    worker.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Bank worker exited with code ${code}.`)));
  });
}
async function currentFile(path) {
  try {
    return await readFile4(path, "utf8");
  } catch (error) {
    if (missing(error))
      return "";
    throw error;
  }
}
async function recover(directory, apply = true) {
  const pending = join5(directory, ".pending-enrollment");
  let receipt;
  try {
    receipt = await readJson(join5(pending, "receipt.json"));
  } catch (error) {
    if (!missing(error))
      throw error;
    if (apply)
      await rm(pending, { recursive: true, force: true });
    return;
  }
  if (receipt.schema !== "fingerpoint-enrollment-v2" || !/^[a-f0-9-]+$/.test(receipt.run_id))
    throw new Error("Invalid enrollment recovery receipt.");
  const stagedFiles = {};
  for (const [name, oldHash, nextHash] of [
    ["unified_reference.jsonl", receipt.previous_reference_sha256, receipt.reference_sha256],
    ["unified_bank.json", receipt.previous_bank_sha256, receipt.bank_sha256]
  ]) {
    const staged = await readFile4(join5(pending, "after", name), "utf8");
    if (sha256(staged) !== nextHash)
      throw new Error("Staged enrollment file hash mismatch.");
    const currentHash = sha256(await currentFile(join5(directory, name)));
    if (currentHash !== oldHash && currentHash !== nextHash)
      throw new Error("Official data changed outside the transaction. Inspect the backups in .pending-enrollment before continuing.");
    stagedFiles[name] = staged;
  }
  if (apply) {
    for (const [name, content] of Object.entries(stagedFiles))
      await atomicWrite(join5(directory, name), content);
    await mkdir3(join5(directory, ".enrollments"), { recursive: true });
    await rename(pending, join5(directory, ".enrollments", receipt.run_id));
  }
  return { runId: receipt.run_id, reference: stagedFiles["unified_reference.jsonl"], bank: stagedFiles["unified_bank.json"] };
}
async function enroll(directory, dataDirectory, dryRun = false, onProgress) {
  await mkdir3(dataDirectory, { recursive: true });
  return withLock(directory, async () => withLock(dataDirectory, async () => {
    onProgress?.({ stage: "validating", message: "Validating samples and original evidence" });
    const prepared = await recover(dataDirectory, !dryRun);
    if (prepared)
      onProgress?.({ stage: "validating", message: dryRun ? `Prepared enrollment ${prepared.runId} will be recovered on write.` : `Recovered enrollment ${prepared.runId}.` });
    const manifest = await loadManifest(directory);
    const attempts = await loadAttempts(directory, manifest);
    const incoming = referenceBatch(manifest, attempts);
    const selected = selectedAttempts(manifest, attempts);
    for (const [index, task] of manifest.tasks.entries())
      await verifyTrace(directory, manifest, task, selected[index]);
    parseReference(JSON.stringify(incoming));
    validateSamples([incoming]);
    const referencePath = join5(dataDirectory, "unified_reference.jsonl"), bankPath = join5(dataDirectory, "unified_bank.json");
    const oldReference = prepared?.reference ?? await currentFile(referencePath), oldBank = prepared?.bank ?? await currentFile(bankPath);
    if (!!oldReference !== !!oldBank)
      throw new Error("Reference data and bank must both exist, or the destination must be empty.");
    const existing = parseReference(oldReference);
    validateSamples(existing);
    if (oldBank && JSON.parse(oldBank).reference_sha256 !== sha256(oldReference))
      throw new Error("Reference data and derived bank hashes do not match. Recover or rebuild first.");
    const byId = new Map;
    const signature = (batch, sample) => sha256(JSON.stringify([batch.model.id, batch.source.channel, sample.actual_channel, sample.condition, sample.challenge_id, sample.text.trim()]));
    const signatures = new Set;
    for (const row of referenceSamples(existing)) {
      byId.set(row.sample.id, row);
      signatures.add(signature(row.batch, row.sample));
    }
    const priorBatch = existing.find((batch) => batch.id === incoming.id);
    const { samples: _incomingSamples, ...incomingInfo } = incoming;
    if (priorBatch) {
      const { samples: _priorSamples, ...priorInfo } = priorBatch;
      if (!isDeepStrictEqual2(priorInfo, incomingInfo))
        throw new Error(`Batch metadata conflict: ${incoming.id}`);
    }
    for (const batch of existing) {
      if (batch.model.id === incoming.model.id && !isDeepStrictEqual2(batch.model, incoming.model))
        throw new Error(`Model family metadata conflicts with the existing model: ${incoming.model.id}`);
    }
    const addedSamples = [];
    let skipped = 0;
    for (const sample of incoming.samples) {
      const prior = byId.get(sample.id);
      if (prior && (prior.batch.id !== incoming.id || !isDeepStrictEqual2(prior.sample, sample)))
        throw new Error(`Conflicting content for sample ID: ${sample.id}`);
      const key = signature(incoming, sample);
      if (prior || signatures.has(key)) {
        skipped++;
        continue;
      }
      addedSamples.push(sample);
      signatures.add(key);
    }
    const added = addedSamples.length, total = byId.size + added;
    const batches = existing.map((batch) => batch === priorBatch ? { ...batch, samples: [...batch.samples, ...addedSamples] } : batch);
    if (!priorBatch && added)
      batches.push({ ...incomingInfo, samples: addedSamples });
    const nextReference = added ? batches.map((batch) => JSON.stringify(batch)).join(`
`) + `
` : oldReference;
    const receipt = {
      schema: "fingerpoint-enrollment-v2",
      run_id: manifest.id,
      manifest_sha256: manifest.fingerprint,
      added,
      skipped,
      total,
      created_at: new Date().toISOString(),
      previous_reference_sha256: sha256(oldReference),
      reference_sha256: sha256(nextReference),
      previous_bank_sha256: sha256(oldBank),
      bank_sha256: sha256(oldBank),
      selected_attempts: incoming.samples.map((sample) => ({ challenge_id: sample.challenge_id, attempt: sample.attempt, row_id: sample.id })),
      ...dryRun ? { dry_run: true } : {}
    };
    if (dryRun || !added) {
      if (!dryRun) {
        try {
          const priorReceipt = await readJson(join5(dataDirectory, ".enrollments", manifest.id, "receipt.json"));
          if (priorReceipt.manifest_sha256 !== manifest.fingerprint)
            throw new Error("Previously enrolled batch has a different manifest fingerprint.");
          const result = { ...priorReceipt, added: 0, skipped, total, already_enrolled: true };
          await saveJson(join5(directory, "enrollment.json"), result);
          return result;
        } catch (error) {
          if (!missing(error))
            throw error;
        }
        await saveJson(join5(directory, "enrollment.json"), receipt);
      }
      return receipt;
    }
    const pending = join5(dataDirectory, ".pending-enrollment");
    await mkdir3(join5(pending, "before"), { recursive: true });
    await mkdir3(join5(pending, "after"), { recursive: true });
    await atomicWrite(join5(pending, "before", "unified_reference.jsonl"), oldReference);
    await atomicWrite(join5(pending, "before", "unified_bank.json"), oldBank);
    await atomicWrite(join5(pending, "after", "unified_reference.jsonl"), nextReference);
    onProgress?.({ stage: "building", message: "Building the reference fingerprint bank" });
    await buildBankFile(join5(pending, "after", "unified_reference.jsonl"), join5(pending, "after", "unified_bank.json"));
    receipt.bank_sha256 = sha256(await readFile4(join5(pending, "after", "unified_bank.json"), "utf8"));
    await saveJson(join5(pending, "receipt.json"), receipt);
    onProgress?.({ stage: "writing", message: "Atomically writing reference data and bank" });
    await recover(dataDirectory);
    await saveJson(join5(directory, "enrollment.json"), receipt);
    return receipt;
  }));
}

// cli/collection-command.ts
function requireValue(value) {
  if (!value.trim())
    throw new Error("Enter a value.");
}
async function setup(options, repository, interactive) {
  const missing = !options.model || !options.label || !options.family || !options.familyName || !options.channel || !options.responseModels.length || options.channel !== "codex-subscription" && (!options.baseUrl || !options.apiKey);
  if (missing && !interactive) {
    throw new Error("Set --model, --label, --family, --family-name, --channel, --response-model, and API credentials. Use --help for details.");
  }
  if (missing) {
    for (const [key, label, hint] of [
      ["model", "Requested model", "API model ID (or set MODEL)."],
      ["label", "Reference model label", "Stable label stored in the reference bank."],
      ["family", "Model family", "Family ID, for example gpt or claude."],
      ["familyName", "Family display name", "For example GPT or Claude."]
    ]) {
      if (!options[key])
        options[key] = await askCollectionField({ title: "Setup", label, hint, validate: requireValue });
    }
    if (!options.channel)
      options.channel = await askCollectionField({
        title: "Setup",
        label: "Collection channel",
        hint: "Route ID, for example openrouter/anthropic, codex-subscription, or kimi-code-subscription.",
        validate: (value) => {
          requireValue(value);
          validateChannel(value, options.subscription);
        }
      });
    if (!options.responseModels.length)
      options.responseModels = (await askCollectionField({
        title: "Setup",
        label: "Allowed response models",
        hint: "Comma-separated exact IDs. Responses outside this list stop collection.",
        validate: (value) => {
          if (!value.split(",").every((model) => model.trim()))
            throw new Error("Enter one or more model IDs, separated by commas.");
        }
      })).split(",").map((model) => model.trim());
  }
  validateChannel(options.channel, options.subscription);
  if (options.channel === "codex-subscription") {
    if (options.baseUrl && options.baseUrl !== CODEX_ENDPOINT && (options.supplied.has("baseurl") || options.supplied.has("base-url")))
      throw new Error("codex-subscription uses the fixed local-login endpoint; omit --baseurl.");
    if (options.supplied.has("api") && options.api !== "responses" || !options.stream)
      throw new Error("codex-subscription requires Responses streaming.");
    options.baseUrl = CODEX_ENDPOINT;
    options.api = "responses";
    options.stream = true;
  } else if (missing) {
    if (!options.supplied.has("api") && options.channel !== "codex-subscription") {
      options.api = collectionApi(await askCollectionField({ title: "Setup", label: "API format", hint: "responses, chatcompletion (cc), or message", defaultValue: options.api, validate: (value) => {
        collectionApi(value);
      } }));
    }
    if (!options.baseUrl)
      options.baseUrl = await askCollectionField({
        title: "Setup",
        label: "API endpoint",
        hint: "Base URL or full endpoint (or set BASE_URL).",
        validate: (value) => {
          requireValue(value);
          requestEndpoint({ ...collectionConfig(options), baseUrl: value });
        }
      });
    if (!options.apiKey)
      options.apiKey = await askCollectionField({ title: "Setup", label: "API key", hint: "Masked input. Prefer setting API_KEY before running fpd. The key is never saved.", secret: true, validate: requireValue });
  }
  if (missing) {
    if (!options.supplied.has("effort"))
      options.effort = await askCollectionField({ title: "Setup", label: "Reasoning effort", hint: "Use default to omit this parameter, or enter the API effort level.", defaultValue: options.effort, validate: requireValue });
    if (!options.outputDir)
      options.outputDir = await askCollectionField({ title: "Setup", label: "Output directory", defaultValue: collectionDirectory(undefined, repository), validate: requireValue });
    for (const [key, flag, label, maximum] of [
      ["count", "count", "Fixed suite challenge count", 36],
      ["parallel", "parallel", "Concurrent requests", 36],
      ["maxAttempts", "max-attempts", "Maximum cumulative attempts per challenge", 20]
    ]) {
      if (!options.supplied.has(flag))
        options[key] = integer(await askCollectionField({
          title: "Setup",
          label,
          defaultValue: String(options[key]),
          validate: (value) => {
            integer(value, label, maximum);
          }
        }), label, maximum);
    }
  }
  requestEndpoint(collectionConfig(options));
}
function progressSnapshot(manifest, attempts, maxAttempts, startedAt, live) {
  const selected = selectedAttempts(manifest, attempts);
  const active = live?.active ?? [];
  let failed = 0;
  manifest.tasks.forEach((task, index) => {
    if (selected[index] || active.some((row) => row.challenge === task.id))
      return;
    const history = attempts.filter((row) => row.challenge_id === task.id);
    if (history.length && (Math.max(...history.map((row) => row.attempt)) >= maxAttempts || history.at(-1)?.retryable === false))
      failed++;
  });
  const accepted = selected.filter(Boolean).length;
  return {
    total: manifest.tasks.length,
    accepted,
    failed,
    pending: manifest.tasks.length - accepted - failed,
    startedAt,
    active: active.map((row) => ({
      id: row.challenge,
      attempt: row.attempt,
      count: row.count,
      expected: manifest.tasks.find((task) => task.id === row.challenge).expected_count,
      state: row.text ? "Streaming" : "Waiting"
    })),
    failures: attempts.filter((row) => row.status === "failed" || row.status === "interrupted").slice(-3).map((row) => ({ id: `${row.challenge_id}:${row.attempt}`, message: row.error || row.status }))
  };
}
async function runCollectionCommand(command, args) {
  let options;
  let report;
  let failure;
  const startedAt = Date.now();
  const interactive = !!process.stdin.isTTY && !!process.stderr.isTTY && !args.includes("--json") && !process.env.CI && process.env.TERM !== "dumb";
  try {
    options = parseCollectionOptions(command, args);
    if (!options) {
      await printCollectionHelp(command, collectionHelp(command), interactive);
      return;
    }
    const repository = await discoverRepository();
    const destination = options.enroll ? await enrollmentDirectory(options.dataDir, repository, interactive) : undefined;
    if (command === "enroll" && !options.resume) {
      if (!interactive)
        throw new Error("Specify the saved batch directory: fpd enroll DIR --data-dir DIR.");
      options.resume = await askCollectionField({ title: "Setup · Enrollment", label: "Saved batch directory", validate: requireValue });
    }
    let manifest;
    let directory;
    let attempts = [];
    if (options.resume) {
      directory = resolve2(options.resume);
      manifest = await loadManifest(directory);
      attempts = await loadAttempts(directory, manifest);
    } else {
      await setup(options, repository, interactive);
      directory = collectionDirectory(options.outputDir, repository);
      manifest = createManifest(collectionConfig(options), {
        label: options.label,
        family: options.family,
        family_name: options.familyName,
        channel: options.channel,
        response_models: options.responseModels,
        subscription: options.subscription
      }, options.count, options.channel === "codex-subscription");
    }
    let adjustment;
    if (options.challenge && (options.promptFile || options.supplied.has("effort"))) {
      const prompt = options.promptFile ? await readFile5(resolve2(options.promptFile), "utf8") : undefined;
      adjustment = {
        challenge: options.challenge,
        prompt,
        systemPrompt: options.systemFile ? await readFile5(resolve2(options.systemFile), "utf8") : undefined,
        effort: options.supplied.has("effort") ? options.effort : undefined,
        note: options.note
      };
      if (prompt !== undefined && !prompt.trim())
        throw new Error("--prompt-file must contain a nonempty prompt.");
    }
    const selected = selectedAttempts(manifest, attempts);
    if (adjustment && !manifest.tasks.some((task) => task.id === adjustment.challenge))
      throw new Error(`Unknown challenge: ${adjustment.challenge}`);
    if (adjustment && selected.some((row) => row?.challenge_id === adjustment.challenge))
      throw new Error("A selected challenge cannot be adjusted. Create a new batch instead.");
    const needsRequests = command === "sample" && !options.adopt && manifest.tasks.some((task, index) => !selected[index] && Math.max(0, ...attempts.filter((row) => row.challenge_id === task.id).map((row) => row.attempt)) < options.maxAttempts);
    if (needsRequests && !manifest.codex && !options.apiKey) {
      if (!interactive)
        throw new Error("Set --apikey or API_KEY before resuming collection.");
      options.apiKey = await askCollectionField({ title: "Setup · Resume", label: "API key", hint: "Masked input. The key is never saved.", secret: true, validate: requireValue });
    }
    if (interactive && command === "sample") {
      const rows = [
        ["Batch", options.resume ? `Resume ${manifest.id}` : "New reference batch"],
        ["Label / family", `${manifest.model.id} / ${manifest.model.family_name}`],
        ["Requested model", manifest.request.model ?? "Unknown"],
        ["Channel", manifest.source.channel],
        ["Endpoint", manifest.source.endpoint ?? "Unknown"],
        ["Allowed models", manifest.request.response_models.join(", ")],
        ["Request", `${manifest.request.format} · ${manifest.request.stream ? "streaming" : "JSON"} · effort ${manifest.request.reasoning_effort || "default"}`],
        ["Plan", `${manifest.tasks.length} fixed challenges · ${options.parallel} concurrent · ${options.maxAttempts} attempts maximum`],
        ["Authentication", manifest.codex ? "Local Codex login (run codex login if needed)" : options.apiKey ? "API key supplied (not saved)" : "Offline; no credentials needed"],
        ["Output", directory]
      ];
      if (destination)
        rows.push(["Enrollment target", destination.path]);
      if (adjustment)
        rows.push(["Challenge adjustment", `${adjustment.challenge}${options.promptFile ? `: ${resolve2(options.promptFile)}` : ""}${options.systemFile ? `; system ${resolve2(options.systemFile)}` : ""}${adjustment.effort ? `; effort ${adjustment.effort}` : ""}`], ["Note", adjustment.note]);
      if (options.adopt)
        rows.push(["Offline adoption", `${options.adopt.id}:${options.adopt.attempt}${options.take ? ` · first ${options.take} numbers` : ""}`], ["Note", options.note]);
      if (!await confirmCollection("Setup · Review", rows.map(([name, value]) => [name, terminalText(value, options.apiKey)]), options.adopt ? "Adopt this saved response? No API requests will run." : needsRequests ? "Start these API requests?" : "Verify and save this batch?"))
        throw new CollectionCancelled;
    }
    if (!options.resume) {
      await mkdir4(dirname2(directory), { recursive: true });
      await mkdir4(directory, { mode: 448 });
      await saveJson(join6(directory, "manifest.json"), manifest);
    }
    const abort = new AbortController;
    const cancel = () => abort.abort();
    let state = progressSnapshot(manifest, attempts, options.maxAttempts, startedAt);
    report = {
      status: "partial",
      directory,
      total: state.total,
      accepted: state.accepted,
      natural: 0,
      truncated: 0,
      unknownCompletion: 0,
      failed: state.failed,
      pending: state.pending,
      elapsedMs: 0,
      next: []
    };
    if (destination)
      report.destination = destination.path;
    if (command === "sample") {
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      const display = createCollectionDisplay(state, manifest.model.id, directory, cancel, interactive, options.apiKey);
      try {
        await withLock(directory, async () => {
          try {
            if (options.adopt) {
              attempts = await adoptAttempt(directory, manifest, options.adopt.id, options.adopt.attempt, options.take, options.note);
            } else {
              attempts = await collect(directory, manifest, options.apiKey, options.maxAttempts, abort.signal, undefined, options.parallel, (live) => {
                attempts = live.attempts;
                state = progressSnapshot(manifest, attempts, options.maxAttempts, startedAt, live);
                display.update(state);
              }, adjustment);
            }
          } finally {
            await saveSummary(directory, manifest, attempts);
          }
        });
      } catch (cause) {
        failure = terminalText(cause instanceof Error ? cause.message : String(cause), options.apiKey);
        process.exitCode = 1;
      } finally {
        state = progressSnapshot(manifest, attempts, options.maxAttempts, startedAt);
        display.update(state);
        await display.finish();
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    }
    const accepted = selectedAttempts(manifest, attempts).filter((row) => !!row);
    report.accepted = accepted.length;
    report.natural = accepted.filter((row) => row.completion === "complete").length;
    report.truncated = accepted.filter((row) => row.completion === "truncated").length;
    report.unknownCompletion = accepted.filter((row) => row.completion === "unknown").length;
    report.failed = state.failed;
    report.pending = state.pending;
    report.status = abort.signal.aborted ? "cancelled" : accepted.length === manifest.tasks.length ? "complete" : "partial";
    if (!failure && !abort.signal.aborted && destination && (command === "enroll" || report.status === "complete")) {
      const progress = (value) => process.stderr.write(`${value.stage}: ${terminalText(value.message, options.apiKey)}
`);
      const preview = await enroll(directory, destination.path, true, progress);
      if (options.dryRun) {
        report.enrollment = preview;
        report.destination = destination.path;
        report.status = "validated";
      } else {
        const confirmed = !interactive || options.yes || await confirmCollection("Setup · Enrollment review", [
          ["Batch", directory],
          ["Destination", destination.path],
          ["Destination source", destination.automatic ? "Detected repository (not yet written)" : "Explicit --data-dir"],
          ["New samples", String(preview.added)],
          ["Duplicates skipped", String(preview.skipped)],
          ["Resulting samples", String(preview.total)],
          ["Accepted responses", `${report.natural} natural completions · ${report.truncated} accepted truncations · ${report.unknownCompletion} unknown completion`],
          ["Detector", preview.added ? "Not retrained; updated bank needs a matching ranker and calibration." : "No reference changes."]
        ], "Write these samples and rebuild this reference bank?");
        if (confirmed) {
          report.enrollment = await enroll(directory, destination.path, false, progress);
          report.destination = destination.path;
          report.status = "enrolled";
        }
      }
    }
    if (report.status === "partial" || report.status === "cancelled") {
      if (!failure)
        process.exitCode = 2;
    }
  } catch (cause) {
    failure = terminalText(cause instanceof Error ? cause.message : String(cause), options?.apiKey || process.env.API_KEY || "");
    process.exitCode = cause instanceof CollectionCancelled ? 2 : 1;
  }
  if (report) {
    report.elapsedMs = Date.now() - startedAt;
    const quoted = `'${report.directory.replaceAll("'", "'\\''")}'`;
    if (report.status === "partial" || report.status === "cancelled")
      report.next.push(`fpd sample --resume ${quoted} --max-attempts ${Math.min(20, (options?.maxAttempts ?? 3) + 3)}`);
    const target = report.destination ?? (options?.dataDir ? resolve2(options.dataDir) : undefined);
    if (report.status !== "enrolled")
      report.next.push(`fpd enroll ${quoted}${target ? ` --data-dir '${target.replaceAll("'", "'\\''")}'` : " --data-dir /path/to/data"}`);
    if (report.status === "enrolled" && report.enrollment?.added && report.destination) {
      report.next.push(`fpd retrain --data-dir '${report.destination.replaceAll("'", "'\\''")}'`);
    }
    if (failure)
      report.error = failure;
    await printCollectionReport(report, options?.json ?? args.includes("--json"), interactive);
  } else if (failure && (options?.json || args.includes("--json")))
    process.stdout.write(JSON.stringify({ status: "error", error: failure }) + `
`);
  if (failure)
    process.stderr.write(failure + `
`);
}
export {
  runCollectionCommand
};
