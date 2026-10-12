// orq config [-w <workspace>]                 everything, as JSON
// orq config [-w <workspace>] get <a.b.c>     one value (plain text if scalar; JSON if object/list)
// orq config [-w <workspace>] files           which files were read
// Exit 1 = missing key in `get`; 2 = configuration error.
import { getPath, loadConfig } from "../config.js";
import { expand } from "../paths.js";
import { m } from "../i18n.js";

export const USAGE = `orq config [-w <workspace>]                 everything, as JSON
orq config [-w <workspace>] get <a.b.c>     one value (plain text if scalar; JSON if object/list)
orq config [-w <workspace>] files           which files were read`;

export function config(argv: string[]): number {
  let ws: string | undefined;
  if (argv[0] === "-w" && argv.length >= 2) { ws = expand(argv[1]); argv = argv.slice(2); }
  const { cfg, files } = loadConfig(ws);
  if (argv.length === 0) {
    console.log(JSON.stringify(cfg, null, 2));
  } else if (argv[0] === "files" && argv.length === 1) {
    console.log(files.length ? files.join("\n") : m("(no file; defaults only)", "(nenhum arquivo; só os padrões)"));
  } else if (argv[0] === "get" && argv.length === 2) {
    const v = getPath(cfg, argv[1]);
    if (v === undefined) return 1;
    console.log(typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v));
  } else {
    console.error(USAGE);
    return 2;
  }
  return 0;
}
