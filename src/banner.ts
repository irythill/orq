// The orc conductor: ASCII art shown when orq starts in a real terminal (`orq`, `orq --version`, `orq setup`).
// Never printed when stdout is not a TTY, so conductors and scripts reading orq's output never see it.
// Colors are painted over the ASCII (24-bit when COLORTERM says so, else the 16 basic colors); NO_COLOR turns them off.
import { readFileSync } from "node:fs";
import type { Obj } from "./config.js";
import { m } from "./i18n.js";

export const ORC = [
  "            (@)                      *",
  "        .-'''''''-.                 /",
  "       /  /==^==\\  \\               /",
  "  /\\  | [ (o) (o) ] |  /\\       _/",
  "  \\ '-|     (_)     |-' /      (_)",
  "   '-.| ^         ^ |.-'       | |",
  "      \\ '-._____.-' /         / /",
  "   _.--'-._______.-'--.______/ /",
  "  /    /|  \\>o</  |\\    \\    /",
  " |    / |   \\|/   | \\       |",
];

type Tone = "skin" | "brow" | "eye" | "white" | "coat" | "hair" | "wood" | "tip";
const RGB: Record<Tone, [number, number, number]> = {
  skin: [155, 209, 74], brow: [106, 165, 49], eye: [214, 52, 40], white: [240, 236, 224],
  coat: [150, 146, 170], hair: [120, 116, 140], wood: [190, 120, 60], tip: [226, 178, 70],
};
const BASIC: Record<Tone, number> = { skin: 92, brow: 32, eye: 91, white: 97, coat: 37, hair: 90, wood: 33, tip: 93 };

/** Which part of the orc a character belongs to (row, column). */
export function tone(y: number, x: number, ch: string): Tone | undefined {
  if (ch === " ") return undefined;
  if (y === 0 && x < 20) return "hair";
  if (x >= 29) return y <= 3 ? (ch === "*" ? "tip" : "wood") : y >= 8 ? "coat" : "skin";
  if (y === 3 && ch === "o") return "eye";
  if (y === 5 && ch === "^") return "white";
  if (y === 2 && (ch === "=" || ch === "^")) return "brow";
  if (y >= 7) return y >= 8 && x >= 10 && x <= 16 ? (">o<".includes(ch) ? "eye" : "white") : "coat";
  return "skin";
}

export type ColorMode = "none" | "basic" | "true";
export function colorMode(env = process.env, tty = Boolean(process.stdout.isTTY)): ColorMode {
  if (!tty || env.NO_COLOR) return "none";
  return /truecolor|24bit/i.test(env.COLORTERM ?? "") || env.WT_SESSION ? "true" : "basic";
}

const paint = (t: Tone, s: string, mode: ColorMode) => mode === "none" ? s
  : mode === "true" ? `\x1b[38;2;${RGB[t].join(";")}m${s}\x1b[0m` : `\x1b[${BASIC[t]}m${s}\x1b[0m`;

export function version(): string {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch { return "?"; }
}

/** Lines shown next to the orc: version and who plays which role. */
export function infoLines(cfg: Obj): string[] {
  const roles = (cfg.roles ?? {}) as Record<string, Obj>;
  const agents = Object.keys((cfg.agents ?? {}) as Obj);
  const who = (r?: Obj) => r?.agent ? String(r.agent) : r?.pool ? `auto (${(r.pool as string[]).join(", ")})` : undefined;
  const lines = [`orq ${version()}`, m("orchestrate coding agents", "orquestrando agentes de código"), ""];
  if (!agents.length) return [...lines, m("no agents yet — run `orq setup`", "nenhum agente ainda — rode `orq setup`")];
  const conductor = who(roles.conductor), primary = who(roles.primary), reviewer = who(roles.reviewer);
  if (conductor) lines.push(`${m("conductor", "conductor")}  ${conductor}`);
  if (primary) lines.push(`${m("primary", "principal")}  ${primary}`);
  if (reviewer) lines.push(`${m("reviewer", "revisor")}    ${reviewer}`);
  if (!primary && !reviewer) lines.push(`${m("agents", "agentes")}    ${agents.join(", ")}`);
  return [...lines, "", "orq setup · orq pick · orq --help"];
}

/** The orc with `info` beside it, or "" when stdout is not a terminal. */
export function banner(info: string[], mode = colorMode(), tty = Boolean(process.stdout.isTTY)): string {
  if (!tty) return "";
  const w = Math.max(...ORC.map((l) => l.length)) + 4;
  const top = Math.max(0, Math.floor((ORC.length - info.length) / 2));
  return ORC.map((line, y) => {
    const art = [...line].map((ch, x) => { const t = tone(y, x, ch); return t ? paint(t, ch, mode) : ch; }).join("");
    const i = info[y - top];
    const text = i === undefined ? "" : y === top && mode !== "none" ? `\x1b[1m${i}\x1b[0m` : i;
    return (art + " ".repeat(w - line.length) + text).trimEnd();
  }).join("\n") + "\n";
}
