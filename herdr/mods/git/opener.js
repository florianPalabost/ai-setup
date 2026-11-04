// The shared link opener, picked by platform. Free of the herdr runtime so it
// can be tested: links.js gives it herdr's functions, and sections use that.
const WSL_MARK = /microsoft/i;
const OPENABLE = /^https?:\/\//i;
const EXPLORER = "explorer.exe";
// xdg-open can start a browser in the foreground and wait for it to exit, and
// exec kills what outlives its 30 s limit. The URL stays out of the script.
const DETACHED_XDG_OPEN = 'setsid xdg-open "$1" >/dev/null 2>&1 & exit 0';

function commandFor(platform, wsl, url) {
  if (platform === "windows" || wsl) return [EXPLORER, [url]];
  if (platform === "macos") return ["open", [url]];
  return ["sh", ["-c", DETACHED_XDG_OPEN, "open-url", url]];
}

export function createOpener({ platform, readTextFile, exec, warn }) {
  let wsl = null;
  const isWsl = async () => {
    if (platform() !== "linux") return false;
    wsl ??= WSL_MARK.test((await readTextFile("/proc/version")) ?? "");
    return wsl;
  };

  return async function open(url) {
    if (!url) return;
    if (!OPENABLE.test(url)) return warn(`Not opening ${url}: not a web link`);
    try {
      const [command, args] = commandFor(platform(), await isWsl(), url);
      const result = await exec(command, args);
      // explorer.exe exits 1 even when it worked.
      if (result.code !== 0 && command !== EXPLORER) warn(`Couldn't open ${url}: ${result.stderr.trim()}`);
    } catch (error) {
      warn(`Couldn't open ${url}: ${error?.message ?? error}`);
    }
  };
}
