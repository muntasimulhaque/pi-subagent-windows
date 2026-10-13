#!/usr/bin/env node
/**
 * Hidden process host for a Windows subagent.
 *
 * It is spawned detached by `launchRun`, writes its own pid for liveness checks,
 * then owns a `pi --mode rpc` child. Because the supervisor is independent of the
 * parent Pi process, subagents survive parent `/reload`, session switches, and
 * parent crashes. Closing the child's stdin is Pi's documented orderly shutdown.
 */
import { appendFileSync, createWriteStream, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
	getAgentDir,
	readMetadata,
	resolvePiCliPath,
	supervisorPidPath,
	updateMetadata,
} from "./shared.ts";

const runDir = process.argv[2];
if (!runDir) {
	process.stderr.write("pi-subagent-windows supervisor: missing run directory\n");
	process.exit(1);
}

const metadata = readMetadata(runDir);
if (!metadata) {
	process.stderr.write(`pi-subagent-windows supervisor: no valid metadata in ${runDir}\n`);
	process.exit(1);
}

const logPath = join(runDir, "supervisor.log");
const log = (message: string): void => {
	try {
		appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, { encoding: "utf8" });
	} catch {
		// Logging is best effort; never fail the run over it.
	}
};

writeFileSync(supervisorPidPath(runDir), `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });

const installRoot = join(getAgentDir(), "install");
let cliPath: string;
try {
	cliPath = resolvePiCliPath();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	log(`could not resolve the Pi CLI: ${message}`);
	updateMetadata(runDir, { state: "error", error: message });
	process.exit(1);
}

const args = [
	cliPath,
	"--mode", "rpc",
	"--session", metadata.sessionFile,
	"--provider", metadata.provider,
	"--model", metadata.model,
	"--thinking", metadata.thinking,
	...(metadata.launchArgs ?? []),
];
log(`supervisor pid=${process.pid} starting child: ${JSON.stringify(args)}`);

const child = spawn(process.execPath, args, {
	cwd: metadata.cwd,
	windowsHide: true,
	stdio: ["pipe", "pipe", "pipe"],
	env: {
		...process.env,
		PI_SUBAGENT_RUN_DIR: runDir,
		PI_MANAGED_INSTALL_ROOT: installRoot,
	},
});

if (!child.pid || !child.stdin || !child.stdout) {
	log("failed to spawn the Pi RPC child");
	updateMetadata(runDir, { state: "error", error: "Failed to spawn the Pi RPC child" });
	process.exit(1);
}

log(`child pid=${child.pid}`);
child.stderr.pipe(createWriteStream(logPath, { flags: "a" }));

/** Answer dialogs that would otherwise block a hidden child forever. */
function respond(id: string, payload: Record<string, unknown>): void {
	try {
		child.stdin!.write(`${JSON.stringify({ type: "extension_ui_response", id, ...payload })}\n`);
	} catch {
		// The child may have exited between the request and the response.
	}
}

let stdoutBuffer = "";
child.stdout.on("data", (data: Buffer) => {
	stdoutBuffer += data.toString("utf8");
	let index: number;
	while ((index = stdoutBuffer.indexOf("\n")) !== -1) {
		const line = stdoutBuffer.slice(0, index).replace(/\r$/, "");
		stdoutBuffer = stdoutBuffer.slice(index + 1);
		if (!line.trim()) continue;
		let record: { type?: string; id?: string; method?: string };
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record.type !== "extension_ui_request" || typeof record.id !== "string") continue;
		switch (record.method) {
			case "confirm":
				log("auto-declined an extension confirm dialog (no interactive UI in hidden subagents)");
				respond(record.id, { confirmed: false });
				break;
			case "select":
			case "input":
			case "editor":
				log(`auto-cancelled an extension ${record.method} dialog (no interactive UI in hidden subagents)`);
				respond(record.id, { cancelled: true });
				break;
			default:
				// notify / setStatus / setWidget / setTitle / set_editor_text need no response.
				break;
		}
	}
});

child.on("error", (error) => {
	log(`child process error: ${error.message}`);
	updateMetadata(runDir, { state: "error", error: error.message });
	process.exit(1);
});

child.on("exit", (code, signal) => {
	log(`child exited code=${code} signal=${signal}`);
	const current = readMetadata(runDir);
	if (current && current.state !== "exited" && current.state !== "error") {
		updateMetadata(
			runDir,
			code === 0
				? { state: "exited" }
				: { state: "error", error: `Subagent process exited unexpectedly (code=${code}, signal=${signal})` },
		);
	}
	process.exit(0);
});

// A graceful shutdown request (process.kill) closes the child's stdin first.
process.on("SIGTERM", () => {
	try {
		child.stdin!.end();
	} catch {
		// Already closed.
	}
});
