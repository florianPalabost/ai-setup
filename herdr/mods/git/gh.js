// The gh data layer: every GitHub read goes through ghGraphql, so gh owns auth
// and the mod never holds a token. Queries only: this mod changes nothing on GitHub.
export const GH_PROBLEM = Object.freeze({
  MISSING: "gh-missing",
  SIGNED_OUT: "gh-signed-out",
  FAILED: "gh-failed",
});

const GH_EXIT_AUTH = 4;
const AUTH_TROUBLE = /gh auth login|HTTP 401|Bad credentials/i;

const GRAPHQL_NOT_FOUND = "NOT_FOUND";

const failure = (problem, message) => ({ ok: false, problem, message });
const firstLine = (text) => text.trim().split("\n")[0];

// gh exits non-zero when any part of a query isn't found, yet prints the rest.
// That rest is an answer, as long as there is one and nothing else went wrong.
function partialData(stdout) {
  try {
    const { data, errors } = JSON.parse(stdout);
    const found = Object.values(data ?? {}).some((value) => value !== null);
    return found && errors?.every((error) => error.type === GRAPHQL_NOT_FOUND) ? data : null;
  } catch {
    return null;
  }
}

// exec is herdr's. Resolves to { ok: true, data } or { ok: false, problem, message },
// never rejects. cache is a gh duration ("30s"), left out to ask GitHub afresh.
export async function ghGraphql(exec, { query, vars = {}, cache = null, cwd }) {
  const args = ["api", "graphql", ...(cache ? ["--cache", cache] : [])];
  for (const [name, value] of Object.entries(vars)) args.push("-f", `${name}=${value}`);
  args.push("-f", `query=${query}`);

  let result;
  try {
    result = await exec("gh", args, cwd ? { cwd } : {});
  } catch (error) {
    return failure(GH_PROBLEM.MISSING, String(error?.message ?? error));
  }
  if (result.code !== 0) {
    const partial = partialData(result.stdout);
    if (partial) return { ok: true, data: partial };
    const output = result.stderr || result.stdout;
    if (result.code === GH_EXIT_AUTH || AUTH_TROUBLE.test(output)) return failure(GH_PROBLEM.SIGNED_OUT, firstLine(output));
    return failure(GH_PROBLEM.FAILED, firstLine(output));
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout).data };
  } catch {
    return failure(GH_PROBLEM.FAILED, "gh returned something that isn't JSON");
  }
}

// What to show instead of an empty section.
export function ghFix({ problem, message }) {
  if (problem === GH_PROBLEM.MISSING) return "GitHub CLI (gh) isn't installed. Get it from https://cli.github.com";
  if (problem === GH_PROBLEM.SIGNED_OUT) return "gh isn't signed in. Run: gh auth login";
  return `gh failed: ${message}`;
}
