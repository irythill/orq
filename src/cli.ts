#!/usr/bin/env node
// orq — one CLI for the orchestration. Subcommands are being ported from setup/ one by one
// (docs/portability.md); the old names (orq-config, orq-set, orq-lang, orq-block) call into this.
import { ConfigError, getPath, loadConfig } from "./config.js";
import { detectLang, m, setLang } from "./i18n.js";
import { block, USAGE as BLOCK } from "./commands/block.js";
import { config, USAGE as CONFIG } from "./commands/config.js";
import { lang, USAGE as LANG } from "./commands/lang.js";
import { quota, USAGE as QUOTA } from "./commands/quota.js";
import { set, USAGE as SET } from "./commands/set.js";

const COMMANDS: Record<string, (argv: string[]) => number | Promise<number>> = { config, set, lang, block, quota };

const usage = () => `orq <command> [args]

${CONFIG}
${SET}
${LANG}
${QUOTA}
${BLOCK.split("\n")[0]}
  (orq block --help ${m("for more", "para mais")})`;

async function main(argv: string[]): Promise<number> {
  try {
    setLang(detectLang(getPath(loadConfig().cfg, "ui.lang")));
  } catch { /* a broken config is reported by the command itself */ }
  const [cmd, ...rest] = argv;
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
