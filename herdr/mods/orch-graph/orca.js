// Runs the Orca CLI from herdr. Native Linux and macOS have `orca-ide` (a bare
// `orca` there can be GNOME's screen reader); herdr in WSL reaches Orca on
// Windows through its `orca.exe`. Takes `exec` from the herdr module, so node can test it.

export const ORCA_ERROR_CODES = Object.freeze({
  notFound: "orca_cli_not_found",
  failed: "orca_cli_failed",
});

const CLI_TIMEOUT_MS = 20000;
// Prints the first CLI found: orca-ide on PATH or in its usual places, else Orca on Windows seen from WSL.
const FIND_CLI = [
  "command -v orca-ide && exit",
  "for c in /opt/Orca/resources/bin/orca-ide /Applications/Orca.app/Contents/Resources/bin/orca-ide; do [ -x \"$c\" ] && echo \"$c\" && exit; done",
  "grep -qi microsoft /proc/version 2>/dev/null || exit",
  "for c in /mnt/c/Users/*/AppData/Local/Programs/orca/resources/bin/orca.exe; do [ -x \"$c\" ] && echo \"$c\" && exit; done",
].join("\n");

const orcaError = (code, message) => Object.assign(new Error(message), { code });

export function createOrcaCli(exec) {
  let cli = null;

  async function cliPath() {
    if (!cli) {
      const found = (await exec("sh", ["-c", FIND_CLI])).stdout.trim().split("\n").at(-1);
      if (!found) throw orcaError(ORCA_ERROR_CODES.notFound, "Orca's CLI isn't installed: no orca-ide, nor orca.exe from WSL");
      cli = found;
    }
    return cli;
  }

  // Resolves with the command's `result`, as the Orca plugin's orcaCli does.
  async function orcaCli(args) {
    const result = await exec(await cliPath(), [...args, "--json"], { timeout: CLI_TIMEOUT_MS });
    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw orcaError(ORCA_ERROR_CODES.failed, result.stderr.trim() || "orca CLI returned no JSON");
    }
    if (!response.ok) throw orcaError(response.error?.code ?? ORCA_ERROR_CODES.failed, response.error?.message ?? "orca CLI failed");
    return response.result;
  }

  return { orchestration: (args) => orcaCli(["orchestration", ...args, "--full"]) };
}
