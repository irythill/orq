// Where orq keeps its files, per OS. Linux/macOS keep the XDG paths the bash/Python scripts always used, so an
// existing ~/.config/orq and ~/.local/state/orq keep working; Windows uses %APPDATA% / %LOCALAPPDATA%.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const env = process.env;
const win = process.platform === "win32";

export function configDir(): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "orq");
  if (win) return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "orq");
  return join(homedir(), ".config", "orq");
}

export function stateDir(): string {
  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, "orq");
  if (win) return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "orq", "state");
  return join(homedir(), ".local", "state", "orq");
}

/** The personal config file to write: $ORQ_CONFIG, else config.json if only that exists, else config.toml. */
export function userConfigFile(): string {
  if (env.ORQ_CONFIG) return env.ORQ_CONFIG;
  const toml = join(configDir(), "config.toml"), json = join(configDir(), "config.json");
  return existsSync(json) && !existsSync(toml) ? json : toml;
}

/** Expand a leading ~ and $VAR / ${VAR} (unknown variables are left as they are, like Python's expandvars). */
export function expand(s: string): string {
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = homedir() + s.slice(1);
  return s.replace(/\$(\w+)|\$\{(\w+)\}/g, (all, a, b) => env[a ?? b] ?? all);
}
