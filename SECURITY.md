# Security policy

## Supported versions
Only the latest release on npm (`@irythill/orq`) gets security fixes.

## Reporting a vulnerability
Please **don't open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository (a private security advisory).

Include what you found, how to reproduce it and the impact you see. You'll get an answer within 7 days. Once a fix is
released, the advisory is published with credit to you, unless you prefer otherwise.

## Scope
orq runs coding agents and shell commands on your machine, with your accounts. Things that are in scope:
- orq running a command, writing a file or reading a secret it wasn't asked to;
- a prompt, config file or tracker content that makes orq escalate beyond the agent's configured permissions;
- secrets (tokens, API keys) leaking into logs, `.orquestra/` files, notices or the dashboard.

Out of scope: what an agent CLI does on its own inside the permissions you gave it. Report that to the agent's vendor.
