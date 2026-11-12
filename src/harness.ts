// Conductor harness capabilities and the wait/resume strategy they allow (#119).
// A harness is where the conductor talks to the user (Claude Code, Codex, OpenCode...). Being able to start a process in
// the background is not the same as being woken up when it ends: only `resume_on_completion` lets the conductor end its
// turn after dispatching. Everything else keeps an active, bounded `orq wait --timeout` loop.
// Config (any field optional, overrides the built-in): agents.<agent>.conductor.capabilities =
//   { background, resume_on_completion, foreground_wait, foreground_timeout, prompt_delivery }
import { getPath, type Obj } from "./config.js";

export interface Capabilities {
  /** Can run a command detached from the current tool call. */
  background: boolean;
  /** A background task that finishes starts a new conductor turn by itself (no user message needed). */
  resumeOnCompletion: boolean;
  /** Can block in a foreground tool call while the turn stays open; without it and without a wake-up: manual. */
  foregroundWait: boolean;
  /** Longest foreground tool call the harness allows, in seconds (the `orq wait --timeout` of the loop). */
  foregroundTimeout: number;
  /** Something outside the harness can type a prompt into the conductor's session (herdr pane). */
  promptDelivery: boolean;
}

export type Strategy = "background-task" | "foreground-loop" | "manual";

const LOOP: Capabilities = { background: false, resumeOnCompletion: false, foregroundWait: true, foregroundTimeout: 240, promptDelivery: false };

/** Built-in knowledge. Unknown harnesses get the conservative loop: never promise a wake-up nobody verified. */
export const BUILTIN_CAPABILITIES: Record<string, Capabilities> = {
  claude: { background: true, resumeOnCompletion: true, foregroundWait: true, foregroundTimeout: 540, promptDelivery: false },
  codex: { ...LOOP },
  opencode: { ...LOOP },
  copilot: { ...LOOP },
  antigravity: { ...LOOP },
};

const bool = (v: unknown, d: boolean) => typeof v === "boolean" ? v : d;

/** Capabilities of `agent` as conductor: built-in, then agents.<agent>.conductor.capabilities, then the environment. */
export function capabilities(agent: string, cfg: Obj = {}, env: NodeJS.ProcessEnv = {}): Capabilities {
  const base = BUILTIN_CAPABILITIES[agent] ?? LOOP;
  const u = (getPath(cfg, `agents.${agent}.conductor.capabilities`) ?? {}) as Obj;
  const t = Number(u.foreground_timeout);
  return {
    background: bool(u.background, base.background),
    resumeOnCompletion: bool(u.resume_on_completion, base.resumeOnCompletion),
    foregroundWait: bool(u.foreground_wait, base.foregroundWait),
    foregroundTimeout: Number.isFinite(t) && t > 0 ? Math.floor(t) : base.foregroundTimeout,
    promptDelivery: bool(u.prompt_delivery, base.promptDelivery || env.HERDR_ENV === "1"),
  };
}

/** Ending the turn after dispatch is only allowed with a channel that wakes the conductor. */
export function strategy(c: Capabilities): Strategy {
  if (c.background && c.resumeOnCompletion) return "background-task";
  return c.foregroundWait ? "foreground-loop" : "manual";
}

/** Timeout for `orq wait` inside one foreground call: leave a margin under the harness limit. */
export const loopTimeout = (c: Capabilities) => Math.max(30, c.foregroundTimeout - 30);

/** The "Waiting strategy" section embedded in the generated conductor instructions. */
export function strategyText(agent: string, c: Capabilities): string {
  const herdr = "In herdr (`HERDR_ENV=1`) the done line is typed into your pane by herdr: that is your wake-up; dispatch, report in one line and end your turn.";
  if (strategy(c) === "background-task") return `## Waiting strategy: background task (${agent})
${herdr}
Elsewhere: after dispatching, run \`orq wait --any <prefix>...\` as a **background task** of your harness and end your
turn. Its exit starts your next turn; its output is the done line. Wait again for the prefixes still pending.`;
  if (strategy(c) === "manual") return `## Waiting strategy: manual (${agent})
${herdr}
Elsewhere your harness can neither wake you when a child ends nor keep a foreground wait open, so you cannot continue
by yourself. After dispatching, tell the user plainly: which prefixes are pending, that you will **not** continue on
your own, and that they resume you by messaging you (e.g. "status") once \`orq wait --any <pending prefixes>\` has
returned. On that message, check \`<prefix>.done\` and act; never dispatch a child again just because it is still running.`;
  const t = loopTimeout(c);
  return `## Waiting strategy: foreground loop (${agent})
${herdr}
Elsewhere your harness does **not** resume you when a background process ends, so never end your turn expecting a
wake-up. After dispatching, report in one line, then loop:
1. Run \`orq wait --any --timeout ${t} <every pending prefix>\` in the **foreground** (if your shell tool has a timeout
   setting, give it more than ${t} s; if the tool still kills the command, use a shorter \`--timeout\`). If the tool
   returns a running session/process id instead of an exit code, keep polling **that same** session until it exits;
   don't start another \`orq wait\` while it runs.
2. Exit 0/1 = a done line: act on it (verify, review, fix) and keep looping over what is still pending.
3. Exit 124 = nothing finished yet: give the user a one-line status and go back to 1. A timeout is not a failure:
   never dispatch the same child again because of it (\`<prefix>.done\` missing = still running).
The loop is the one allowed blocking wait. If the user writes in between, answer, then resume the loop. If you must end
your turn with children still pending, say plainly that you will **not** continue by yourself and that the user has to
message you (e.g. "status") to resume.`;
}
