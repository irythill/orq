// orq completion bash|zsh|fish|powershell — prints a completion script for that shell: subcommands, then each one's
// fixed words (orq lang pt|en|…, orq lock wait|…); anything else falls back to file names. Turn it on:
//   bash        eval "$(orq completion bash)"                               in ~/.bashrc
//   zsh         eval "$(orq completion zsh)"                                in ~/.zshrc, after compinit
//   fish        orq completion fish > ~/.config/fish/completions/orq.fish
//   PowerShell  orq completion powershell | Out-String | Invoke-Expression  in $PROFILE
// cmd.exe has no programmable completion.
export const USAGE = "orq completion bash|zsh|fish|powershell   print the shell completion script (see docs)";

const DESC: Record<string, string> = {
  setup: "guided first configuration", config: "show the merged config", set: "write one config value", lang: "language of orq's messages",
  quota: "quota per agent/account", pick: "pick agent, model and account for a role", stats: "scoreboard per agent",
  board: "live board", lock: "test queue", run: "run a command under a memory cap", agent: "run a child agent",
  wait: "wait for child agents", verify: "tests of a diff", baseline: "tests already failing on the base",
  instructions: "write the /issue playbook", claim: "issue owner among conductors", deps: "link node_modules into a worktree", gc: "remove merged issue worktrees", ci: "CI/CD status per claimed issue", handoff: "move a conductor low on quota to another account",
  block: "block an agent or account", completion: "shell completion script",
};

/** Fixed words after a subcommand. */
export const WORDS: Record<string, string[]> = {
  setup: ["--preset", "--detect", "--answers", "--write", "--install", "--workspace"],
  config: ["get", "files", "-w"], lang: ["pt", "en", "auto", "toggle"], lock: ["wait", "release", "run", "status"],
  pick: ["impl", "fix", "worker", "review", "opinion"], instructions: ["claude", "agents"], board: ["--once", "--json", "-w"],
  completion: ["bash", "zsh", "fish", "powershell"], stats: ["--days", "--json", "-w"], wait: ["--any", "--timeout", "--answer"],
  ci: ["--json", "-w"],
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`; // PowerShell single quotes
const qf = (s: string) => `'${s.replace(/[\\']/g, "\\$&")}'`; // fish single quotes

export function script(shell: string, cmds: string[]): string | undefined {
  const all = cmds.join(" ");
  const cases = (fmt: (c: string, w: string) => string) => Object.entries(WORDS).filter(([c]) => cmds.includes(c)).map(([c, w]) => fmt(c, w.join(" "))).join("\n");
  switch (shell) {
    case "bash": return `# orq completion (bash): eval "$(orq completion bash)" in ~/.bashrc
_orq() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${all}" -- "$cur")); return; fi
  [ "$COMP_CWORD" -eq 2 ] || return
  case \${COMP_WORDS[1]} in
${cases((c, w) => `    ${c}) COMPREPLY=($(compgen -W "${w}" -- "$cur")) ;;`)}
  esac
}
complete -o default -F _orq orq
`;
    case "zsh": return `# orq completion (zsh): eval "$(orq completion zsh)" in ~/.zshrc, after compinit
_orq() {
  if (( CURRENT == 2 )); then compadd -- ${all}; return; fi
  if (( CURRENT == 3 )); then
    case $words[2] in
${cases((c, w) => `      ${c}) compadd -- ${w}; return ;;`)}
    esac
  fi
  _files
}
compdef _orq orq
`;
    case "fish": return `# orq completion (fish): orq completion fish > ~/.config/fish/completions/orq.fish
complete -c orq -f -n __fish_use_subcommand
${cmds.map((c) => `complete -c orq -n __fish_use_subcommand -a ${c}${DESC[c] ? ` -d ${qf(DESC[c])}` : ""}`).join("\n")}
${cases((c, w) => `complete -c orq -n "__fish_seen_subcommand_from ${c}" -a ${qf(w)}`)}
`;
    case "powershell": case "pwsh": return `# orq completion (PowerShell): add to $PROFILE:  orq completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName orq -ScriptBlock {
  param($word, $ast, $cursor)
  $w = @($ast.CommandElements | ForEach-Object { $_.ToString() })
  $n = $w.Count; if ($word -ne '') { $n-- }
  $words = @{
${Object.entries(WORDS).filter(([c]) => cmds.includes(c)).map(([c, w]) => `    ${q(c)} = @(${w.map(q).join(", ")})`).join("\n")}
  }
  $desc = @{
${cmds.map((c) => `    ${q(c)} = ${q(DESC[c] ?? c)}`).join("\n")}
  }
  if ($n -eq 1) { $list = @(${cmds.map(q).join(", ")}) } elseif ($n -eq 2 -and $words.ContainsKey($w[1])) { $list = $words[$w[1]] } else { return }
  $list | Where-Object { $_ -like "$word*" } | ForEach-Object {
    $tip = if ($n -eq 1) { $desc[$_] } else { $_ }
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $tip)
  }
}
`;
    default: return undefined;
  }
}

export function completion(argv: string[], cmds: string[]): number {
  const s = argv.length === 1 ? script(argv[0], cmds) : undefined;
  if (!s) { console.error(USAGE); return 2; }
  process.stdout.write(s);
  return 0;
}
