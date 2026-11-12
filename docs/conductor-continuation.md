**English** · [Português](pt-BR/conductor-continuation.md)

# Conductor continuation

After dispatching a child, the conductor has to find out when it finishes. Being able to start a background process is
not enough: the conversation only continues by itself if the harness starts a new turn when that process ends. orq picks
the waiting strategy from the conductor harness's capabilities, never from the agent's name or the terminal.

| Strategy | When | May end the turn? |
| --- | --- | --- |
| background task | `background` and `resume_on_completion` (built in: Claude Code) | Yes, after `orq wait --any` runs as a background task |
| foreground loop | `foreground_wait` (default for every other harness) | No: `orq wait --any --timeout <s>` in a loop until the work is done |
| manual | neither of the above | Only by telling the user it will not continue and how to resume it |

In herdr the done line is typed into the conductor's pane, which works as a wake-up in every strategy.

Foreground loop rules: exit 124 means nothing finished yet (one-line status, wait again, never dispatch the same child
again); exit 0/1 is a done line to act on. If the shell tool hands back a running session id instead of an exit code
(Codex does this for long commands), keep polling that same session instead of starting another `orq wait`. A foreground
loop cannot revive a conversation whose turn has already ended.

Check what applies with `orq instructions strategy [--conductor <agent>] [--json]`. Override the built-in values per
agent, only with capabilities you have verified in that harness:

```toml
[agents.codex.conductor.capabilities]
background = true            # starts detached processes...
resume_on_completion = false # ...but is not woken when they end → foreground loop
foreground_wait = true
foreground_timeout = 240     # longest foreground tool call, in seconds
```

After changing capabilities or upgrading orq, refresh the generated instructions with
`orq setup --workspace <folder> --conductor <agent>`.
