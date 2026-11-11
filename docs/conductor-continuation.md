# Conductor continuation

`orq wait --strategy --json` is a read-only diagnosis of the current continuation contract. The default is
`foreground`: the conductor keeps its conversation turn active and uses `orq wait --any --timeout 30 <prefix>...`.
Timeout (124) means keep waiting, not dispatch again. A completed child (exit 0 or 1) is handled before waiting
for remaining prefixes. This applies to implementation, verify and review; failed children require attention too.
If the harness tool returns a running session id, resume that invocation before starting another wait.

Capabilities describe the harness running the conductor, separately from the worker agent, terminal and OS.
They are declarations, not a connectivity probe. Set them only after checking the session's actual capabilities.
Worker `AgentDef` capabilities and `roles.conductor.agent` do not change this contract.

| Mode | Required capabilities | May end the turn? |
| --- | --- | --- |
| `external` | `external_prompt = true` | After prompt delivery to this conversation is established |
| `native` | `background = true` and `completion_wakeup = true` | After a native completion task is armed |
| `foreground` | `foreground_wait = true` (default) | Keep the turn active until work is handled or user input is required |
| `manual` | No usable channel or foreground wait | Report the limit, pending prefixes and explicit resume command |

Resolution follows the table's order. Defaults are false except `foreground_wait`. No agent name, environment
marker such as `HERDR_PANE_ID`, tmux session or detached process implicitly enables automatic continuation.
Herdr can provide external delivery when its conductor pane is reachable; a harness can provide native completion
tasks when it resumes the same conversation on exit. Either must be established before ending a turn. If it fails,
declare the unavailable capabilities false and resolve again; foreground waiting is the default fallback.

Configuration belongs to the conductor's environment, for example in `.orq/workspace.toml`:

```toml
[conductor.capabilities]
background = true
completion_wakeup = false
external_prompt = false
foreground_wait = true
```

This example still resolves to `foreground`: background execution alone does not wake a conversation.
For a harness with confirmed native task wake-up, set both `background` and `completion_wakeup` true.
Shell `&` is insufficient. For a harness that cannot wait in its active turn, set `foreground_wait` false;
without another available channel the result is `manual`.

A per-session `ORQ_HARNESS_CAPABILITIES` JSON object overrides the corresponding configuration fields. For example,
set this environment variable for the conductor process to disable unavailable asynchronous channels:

```json
{"background":true,"completion_wakeup":false,"external_prompt":false,"foreground_wait":true}
```

Unknown keys, non-boolean values and malformed JSON fail visibly. Diagnostics include resolved capabilities,
source (`defaults`, `config`, `environment`), mode, `can_end_turn` and a reason. `can_end_turn` is conditional on
arming the declared channel, not proof of delivery. `orq wait --strategy` prints the same decision as readable text.
The diagnostic does not launch agents, register consumers or change child protocol files.

The shared `/issue` playbook and generated `AGENTS.md` describe all strategies and resolve them in the live session,
so moving a workspace to a different harness does not bake in a stale background-task assumption. Refresh generated
workspace instructions after upgrading with `orq setup --workspace <folder> --conductor <agent>`.

Foreground continuation works only while the turn remains active. It cannot revive a finished conversation, survive
a closed harness, or bypass an approval/stop request. If no channel is available, provide
`orq wait --any <pending-prefixes>` and the result paths for manual resumption. Durable inboxes, normalized progress
events and recovery across conductors are tracked separately in #120–#123.
