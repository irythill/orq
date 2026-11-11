import { ConfigError, getPath, type Obj } from "./config.js";

export interface HarnessCapabilities {
  background: boolean;
  completion_wakeup: boolean;
  external_prompt: boolean;
  foreground_wait: boolean;
}

export interface WaitStrategy {
  mode: "external" | "native" | "foreground" | "manual";
  capabilities: HarnessCapabilities;
  source: "defaults" | "config" | "environment";
  can_end_turn: boolean;
  reason: string;
}

const DEFAULTS: HarnessCapabilities = {
  background: false, completion_wakeup: false, external_prompt: false, foreground_wait: true,
};

function capabilities(value: unknown, label: string): Partial<HarnessCapabilities> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object of boolean capabilities`);
  for (const [key, v] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULTS, key) || typeof v !== "boolean") throw new ConfigError(`${label}.${key}: expected a known boolean capability`);
  }
  return value as Partial<HarnessCapabilities>;
}

/** Choose a continuation contract from declared harness capabilities, never from an agent or terminal name. */
export function waitStrategy(cfg: Obj, env: NodeJS.ProcessEnv = process.env): WaitStrategy {
  const configured = getPath(cfg, "conductor.capabilities");
  let runtime: unknown;
  if (env.ORQ_HARNESS_CAPABILITIES !== undefined) {
    try { runtime = JSON.parse(env.ORQ_HARNESS_CAPABILITIES); }
    catch { throw new ConfigError("ORQ_HARNESS_CAPABILITIES must be valid JSON"); }
  }
  const c = { ...DEFAULTS, ...capabilities(configured, "conductor.capabilities"), ...capabilities(runtime, "ORQ_HARNESS_CAPABILITIES") };
  const source = env.ORQ_HARNESS_CAPABILITIES !== undefined ? "environment" : configured !== undefined ? "config" : "defaults";
  const mode = c.external_prompt ? "external" : c.background && c.completion_wakeup ? "native" : c.foreground_wait ? "foreground" : "manual";
  const reasons = {
    external: "External prompt delivery is declared available; establish delivery before ending the turn.",
    native: "Background task completion is declared to resume the conductor; arm the native task before ending the turn.",
    foreground: "No automatic continuation channel is established. Keep the turn active with bounded waits; background execution alone cannot wake it.",
    manual: "No automatic continuation or foreground wait is available. Report the limitation and an explicit resume command; do not promise automatic progress.",
  };
  return { mode, capabilities: c, source, can_end_turn: mode === "external" || mode === "native", reason: reasons[mode] };
}
