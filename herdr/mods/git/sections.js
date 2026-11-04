// What the Git panel decides about its sections, free of the herdr runtime so
// it can run under `node --test`. The sections themselves are in section-list.js.

// Which sections are open, as the JSON string `saved` holds it, on top of each
// section's default. Sections added since keep their default; dropped ones go.
export function loadOpen(saved, sections) {
  let remembered = null;
  try { remembered = JSON.parse(saved); } catch { /* unreadable: use the defaults */ }
  return Object.fromEntries(sections.map(({ id, defaultOpen }) => {
    const value = remembered?.[id];
    return [id, typeof value === "boolean" ? value : defaultOpen];
  }));
}

export function toggleOpen(open, id) {
  return { ...open, [id]: !open[id] };
}

export function changesSummary(files, error) {
  if (error) return error;
  if (!files.length) return "No changes";
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
  return `${files.length} ${files.length === 1 ? "file" : "files"}  +${add} −${del}`;
}
