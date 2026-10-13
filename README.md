# Pi Subagent for Windows (no tmux)

Hidden, persistent Pi subagents for independent reviews, investigations, and delegated implementation — **without tmux**.

This is a Windows port of [badlogic/pi-subagent](https://github.com/badlogic/pi-subagent). The agent-facing workflow is unchanged: the main Pi agent spawns named subagents with the `subagent` CLI, waits for their final reports, steers them when needed, and stops them when done. Everything happens in the background — there is no attach screen.

## How it works

Upstream runs each subagent inside a tmux session and lets a human attach to its live TUI. Windows has no tmux, so this port replaces the tmux layer with a hidden process host:

- Each subagent is a detached, hidden **supervisor** process that owns a `pi --mode rpc` child.
- The supervisor holds the child's stdin pipe, drains its protocol output, writes `supervisor.log`, and auto-cancels extension dialogs (there is no interactive screen to answer them).
- Runs are tracked by pid, stopped with `taskkill /T /F`, and survive parent `/reload`, session switches, and parent crashes.
- Subagents are **status-only** on Windows. Use `subagent status`, `subagent wait`, and the run's `session.jsonl` for inspection.

On non-Windows platforms the upstream tmux behavior is kept, so the fork stays mergeable with upstream.

## Requirements

- Pi
- Node.js 22.19 or newer
- Windows (no tmux required)

## Install

```sh
pi install npm:pi-subagent-windows
```

Or install straight from GitHub:

```sh
pi install git:github.com/muntasimulhaque/pi-subagent-windows
```

Or clone it manually into Pi's global extension directory:

```sh
git clone https://github.com/muntasimulhaque/pi-subagent-windows.git ~/.pi/agent/extensions/pi-subagent-windows
```

Run `/reload` in an existing Pi session (or start a new one). On Windows the extension writes `subagent.cmd` and an extensionless `subagent` sh shim into `~/.pi/agent/bin`, so the CLI is on `PATH` from both PowerShell/cmd and Git Bash.

## Usage

Spawn with a descriptive name using the parent session's provider, model, and thinking level:

```sh
subagent spawn --name review --prompt "Review the current diff independently"
```

Override the model configuration when needed:

```sh
subagent spawn \
  --provider commandcode \
  --model deepseek/deepseek-v4.1-flash \
  --thinking low \
  --prompt "Find the relevant implementation"
```

Provide multiple prompt fragments and files:

```sh
subagent spawn \
  --file /tmp/spec.md \
  --prompt "Implement this specification" \
  --prompt "Run the targeted tests"
```

Restrict tools for a read-only investigation:

```sh
subagent spawn --tools read,grep,find,ls --prompt "Investigate the failure"
```

Manage a run by its generated handle:

```sh
subagent status a1b2c3
subagent rename a1b2c3 "error handling review"
subagent send a1b2c3 "Focus on error handling"
subagent send a1b2c3 --follow-up "Then summarize"
subagent wait a1b2c3
subagent stop a1b2c3
subagent list
```

Run `/subagent` to list active subagents spawned by the current session. On Windows, selecting one shows its status and session file.

## Run files

Each run lives in `~/.pi/agent/subagents/<handle>/`:

| File | Purpose |
|---|---|
| `metadata.json` | State, model, session pointers |
| `session.jsonl` | The child Pi session (full transcript) |
| `inbox/` | Queued messages (steering, follow-ups) |
| `supervisor.log` | Process host log, child stderr, auto-cancelled dialogs |
| `supervisor.pid` | Process tracking |

## Differences and limitations

- **No attach screen.** Subagents are observable through status, `wait`, and the session file, not a live TUI.
- **`--file` handling:** text file contents (up to 1 MB) are inlined into the first prompt; larger or binary files are referenced by path and can be read by the subagent's `read` tool.
- **Extension dialogs** (`select`, `confirm`, `input`, `editor`) are auto-cancelled inside hidden subagents, with a note in `supervisor.log`. Fire-and-forget notifications are ignored.
- **Suspension kills the current turn.** Resuming relaunches the run idle with its full history.
- Nested subagents remain disabled.

## Credits

Forked from [badlogic/pi-subagent](https://github.com/badlogic/pi-subagent) by Mario Zechner (MIT). See `LICENSE`.
