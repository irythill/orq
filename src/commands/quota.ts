// orq quota [name...]   quota of each source in [quota] (default: all) — lines "<name> 5h=NN% week=NN% [note]"
import { getPath, loadConfig } from "../config.js";
import { collect, type Source } from "../quota.js";

export const USAGE = "orq quota [name...]                   quota per agent/account ([quota] in the config)";

export async function quota(argv: string[]): Promise<number> {
  const sources = (getPath(loadConfig().cfg, "quota") ?? {}) as Record<string, Source>;
  for (const l of await collect(sources, argv)) console.log(l);
  return 0;
}
