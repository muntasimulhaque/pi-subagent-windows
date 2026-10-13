#!/usr/bin/env node
/**
 * npm/npx bin entry. Node cannot link a `.ts` file as a global command, so this
 * thin wrapper forwards to the real CLI, which runs under Node's type stripping.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "subagent.ts");
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) {
	process.stderr.write(`${result.error.message}\n`);
	process.exit(1);
}
process.exit(result.status ?? 1);
