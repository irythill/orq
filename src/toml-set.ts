// Writes `key = "value"` into [section] of a TOML text, keeping everything else (comments, order, blank lines).
// Replaces the key if present, adds it at the end of the section, or adds the section at the end of the file.
// Same behaviour as the awk in the old setup/orq-set.
export function setTomlString(text: string, section: string, key: string, value: string): string {
  const header = `[${section}]`;
  const line = `${key} = ${JSON.stringify(value)}`;
  const keyRe = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const out: string[] = [];
  let inSec = false, done = false, blanks = 0;
  const flush = () => { for (; blanks > 0; blanks--) out.push(""); };
  for (const l of lines) {
    if (l.startsWith("[")) {
      if (inSec && !done) { out.push(line); done = true; }
      flush(); inSec = l.trim() === header; out.push(l); continue;
    }
    if (inSec && l.trim() === "") { blanks++; continue; } // hold blank lines inside the section
    if (inSec && keyRe.test(l)) { flush(); out.push(line); done = true; continue; }
    flush(); out.push(l);
  }
  if (!done) {
    if (!inSec) { flush(); out.push("", header); }
    out.push(line);
  }
  flush();
  return out.join("\n") + "\n";
}
