import { spawn } from "node:child_process";
import path from "node:path";
import { rimraf } from "rimraf";

const root = process.cwd();
const rootNodeModules = path.join(root, "node_modules");

if (process.argv.includes("--remove-root-node-modules")) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rimraf(rootNodeModules);
} else {
  const targets = [
    "apps/desktop/node_modules",
    "packages/*/node_modules",
    "target",
    "apps/desktop/src-tauri/target",
    "examples/*/target",
    "pkg",
    "dist",
    "apps/desktop/dist",
    "coverage",
    ".venv",
    "venv",
    "**/__pycache__",
    "**/*.egg-info",
    "**/*.tsbuildinfo",
  ];

  await rimraf(targets, { glob: true });

  const cleanup = spawn(
    process.execPath,
    [path.resolve("scripts/clean.mjs"), "--remove-root-node-modules"],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  cleanup.unref();
}
