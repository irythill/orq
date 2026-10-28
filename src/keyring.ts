// Keyring — read a secret another tool keeps in the OS keyring (Secret Service on Linux, Keychain on macOS, Credential
// Manager on Windows) through @napi-rs/keyring. orq only reads; it never writes or refreshes someone else's login.
// The native module may not load (a platform without a prebuilt binary, a broken install): then the OS's own CLI where
// there is one (Linux secret-tool, macOS security), else nothing. $ORQ_KEYRING = native | cli | off forces a backend.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

export type Backend = "native" | "cli" | "none";
interface Entry { getPassword(): string | null }
interface Native { Entry: { new(service: string, account: string): Entry; withTarget(target: string, service: string, account: string): Entry } }

let native: Native | null | undefined;
function load(): Native | null {
  if (native === undefined) {
    try { native = createRequire(import.meta.url)("@napi-rs/keyring") as Native; } catch { native = null; }
  }
  return native;
}

const cli = () => process.platform === "linux" ? "secret-tool" : process.platform === "darwin" ? "security" : undefined;

/** Which backend reads secrets here. */
export function backend(): Backend {
  const want = process.env.ORQ_KEYRING;
  if (want === "off") return "none";
  if (want !== "cli" && load()) return "native";
  return cli() && spawnSync(cli()!, ["--help"], { stdio: "ignore", timeout: 5000 }).error === undefined ? "cli" : "none";
}

/**
 * The secret stored for (service, account), or undefined. `target` is the Windows credential name when the tool that
 * wrote it doesn't use the keyring-rs default ("<account>.<service>"), e.g. go-keyring's "<service>:<account>".
 */
export function readSecret(service: string, account: string, target?: string): string | undefined {
  const b = backend();
  if (b === "native") {
    try {
      const e = target && process.platform === "win32" ? load()!.Entry.withTarget(target, service, account) : new (load()!.Entry)(service, account);
      return e.getPassword() ?? undefined;
    } catch { return undefined; } // no keyring service (headless Linux without D-Bus), locked, denied
  }
  if (b === "cli") {
    const args = process.platform === "linux" ? ["lookup", "service", service, "username", account]
      : ["find-generic-password", "-s", service, "-a", account, "-w"];
    const r = spawnSync(cli()!, args, { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
  }
  return undefined;
}
