#!/usr/bin/env node

// cli/fpd.ts
process.env.NODE_ENV = "production";
var [command, ...args] = process.argv.slice(2);
if (command === "sample" || command === "enroll") {
  const { runCollectionCommand } = await import("./collection-command-vd61mnn0.js");
  await runCollectionCommand(command, args);
} else if (command === "retrain") {
  const { runRetrainCommand } = await import("./retrain-command-4pm427ab.js");
  try {
    await runRetrainCommand(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  const { runDetectionCommand } = await import("./detect-0fjbqq67.js");
  await runDetectionCommand(command === "detect" ? args : process.argv.slice(2));
}
