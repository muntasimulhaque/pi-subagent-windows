// Packs the package, installs it globally into a throwaway prefix, and runs the
// installed `subagent` shim. Catches packaging problems `npm publish --dry-run`
// cannot see: missing files, a broken bin wrapper, or an unbootable bundle.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

// Files that must reach the published package for it to work at install time.
const required = [
	"dist/subagent.js",
	"dist/supervisor.js",
	"index.ts",
	"shared.ts",
	"subagent.ts",
	"supervisor.ts",
	"skills/subagent/SKILL.md",
	"package.json",
];

function run(command, args, options = {}) {
	return spawnSync(command, args, { cwd: root, encoding: "utf8", shell: false, ...options });
}

function npm(args) {
	// npm on Windows is a .cmd shim, which needs a shell to spawn.
	return run("npm", args, { shell: isWindows });
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function step(label, fn) {
	try {
		const detail = fn();
		process.stdout.write(`ok   ${label}${detail ? ` - ${detail}` : ""}\n`);
		return detail;
	} catch (error) {
		failures.push(label);
		process.stdout.write(`FAIL ${label} - ${error instanceof Error ? error.message : String(error)}\n`);
		return undefined;
	}
}

const workDir = mkdtempSync(join(tmpdir(), "pi-subagent-smoke-"));
const prefix = join(workDir, "prefix");
const installDir = join(prefix, "node_modules", "pi-subagent-windows");
const bin = isWindows ? join(prefix, "subagent.cmd") : join(prefix, "bin", "subagent");

try {
	const packDir = join(workDir, "pack");
	mkdirSync(packDir, { recursive: true });
	mkdirSync(prefix, { recursive: true });

	const tarball = step("npm pack (runs prepare)", () => {
		const result = npm(["pack", "--pack-destination", packDir, "--loglevel=error"]);
		assert(result.status === 0, `exit ${result.status}: ${(result.stderr || "").trim()}`);
		const [file] = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
		assert(file, `no tarball in ${packDir}: ${(result.stdout || "").trim()}`);
		return join(packDir, file);
	});

	if (tarball) {
		step("global install into temp prefix", () => {
			const result = npm(["install", "-g", "--prefix", prefix, tarball, "--no-audit", "--no-fund", "--loglevel=error"]);
			assert(result.status === 0, `exit ${result.status}: ${(result.stderr || "").trim()}`);
			assert(existsSync(bin), `no subagent shim at ${bin}`);
			return bin;
		});

		step("file list is complete", () => {
			const missing = required.filter((file) => !existsSync(join(installDir, file)));
			assert(missing.length === 0, `missing ${missing.join(", ")}`);
			return `${required.length} required files present`;
		});

		step("installed shim runs (subagent list)", () => {
			const result = spawnSync(bin, ["list"], {
				cwd: workDir,
				encoding: "utf8",
				shell: isWindows,
				env: {
					...process.env,
					PI_SESSION_ID: `smoke-${process.pid}`,
					PATH: `${isWindows ? prefix : join(prefix, "bin")}${delimiter}${process.env.PATH ?? ""}`,
				},
			});
			assert(result.status === 0, `exit ${result.status}: ${(result.stderr || result.stdout || "").trim()}`);
			const stdout = (result.stdout ?? "").trim();
			assert(/No subagents/.test(stdout), `unexpected output: ${stdout}`);
			return stdout;
		});
	}
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
	process.stderr.write(`smoke failed: ${failures.join(", ")}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write("smoke passed\n");
}
