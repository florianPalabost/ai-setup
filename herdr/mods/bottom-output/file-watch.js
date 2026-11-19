// A copy of viewer/file-watch.js: herdr loads no module from outside a mod's folder.
// Calls onChange(cx) when a file changes: a watch on its folder, or a slow poll
// when herdr refuses or reclaims the watch. Takes the herdr module as `herdr`.
const POLL_MS = 5000;

const folderOf = (file) => file.slice(0, Math.max(1, file.lastIndexOf("/")));

export function watchFile(herdr, cx, file, onChange) {
  const folder = folderOf(file);
  let stopped = false;
  let watch = null;
  let poll = null;
  const fallBack = (cx) => { if (!stopped) poll = cx.timer.every(POLL_MS, (cx) => onChange(cx)); };

  cx.spawn(async (cx) => {
    try {
      while (!stopped) {
        watch = herdr.watchFolder(folder);
        const paths = await watch;
        if (stopped) return;
        // An empty batch means herdr released the watch; asking again at once would spin.
        if (paths.length === 0) return fallBack(cx);
        if (paths.some((path) => path === file || path === folder)) onChange(cx);
      }
    } catch {
      fallBack(cx);
    }
  });

  return function stop() {
    stopped = true;
    watch?.cancel();
    poll?.cancel();
  };
}
