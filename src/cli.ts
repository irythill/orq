#!/usr/bin/env node
// orq — one CLI for the orchestration. Subcommands are being ported from setup/ one by one
// (docs/portability.md); the old names (orq-config, orq-set, orq-lang, orq-block) call into this.
import { ConfigError, getPath, loadConfig } from "./config.js";
import { banner, infoLines, version } from "./banner.js";
import { detectLang, m, setLang } from "./i18n.js";
import { block, USAGE as BLOCK } from "./commands/block.js";
import { claim, USAGE as CLAIM } from "./commands/claim.js";
import { config, USAGE as CONFIG } from "./commands/config.js";
import { deps, USAGE as DEPS } from "./commands/deps.js";
import { lang, USAGE as LANG } from "./commands/lang.js";
import { lock, USAGE as LOCK } from "./commands/lock.js";
import { pick, USAGE as PICK } from "./commands/pick.js";
import { quota, USAGE as QUOTA } from "./commands/quota.js";
import { run, USAGE as RUN } from "./commands/run.js";
import { set, USAGE as SET } from "./commands/set.js";
import { setup, USAGE as SETUP } from "./commands/setup.js";
import { stats, USAGE as STATS } from "./commands/stats.js";

const COMMANDS: Record<string, (argv: string[]) => number | Promise<number>> = { config, set, lang, block, quota, pick, stats, setup, lock, claim, deps, run };

const usage = () => `orq <command> [args]

${SETUP}
${CONFIG}
${SET}
${LANG}
${QUOTA}
${PICK}
${STATS}
${LOCK}
${RUN}
${CLAIM}
${DEPS}
${BLOCK.split("\n")[0]}
  (orq block --help ${m("for more", "para mais")})`;

async function main(argv: string[]): Promise<number> {
  try {
    setLang(detectLang(getPath(loadConfig().cfg, "ui.lang")));
  } catch { /* a broken config is reported by the command itself */ }
  const [cmd, ...rest] = argv;
  // The orc greets only a person at a terminal; scripts and conductors (no TTY) get the plain output.
  const hello = () => { try { process.stdout.write(banner(infoLines(loadConfig().cfg)) + (process.stdout.isTTY ? "\n" : "")); } catch { /* broken config: skip */ } };
  if (cmd === "-v" || cmd === "--version") { if (process.stdout.isTTY) hello(); else console.log(version()); return 0; }
  if (!cmd && process.stdout.isTTY) { hello(); console.log(usage()); return 0; }
  if (!cmd || cmd === "-h" || cmd === "--help") { console.log(usage()); return cmd ? 0 : 2; }
  const run = COMMANDS[cmd];
  if (!run) { console.error(`${m("unknown command", "comando desconhecido")}: ${cmd}\n\n${usage()}`); return 2; }
  try {
    return await run(rest);
  } catch (e) {
    console.error(e instanceof ConfigError ? e.message : `orq ${cmd}: ${(e as Error).message}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
