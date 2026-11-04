# Herdr clones are stored as patches on what herdr ships, not as copies

The Git panel needs small changes to files herdr ships (`tabs`, the `main` layout, `changes`), and herdr replaces its own files on every start, so those changes have to live in clones that herdr then never updates. The repo stores only our edits, as patches, and install/update build the clones from whatever the installed herdr ships. If a patch no longer applies, the failure is reported and any existing clone stays in place.

The edits are a few lines each, so this keeps upstream fixes flowing into the clones, and a patch fails exactly where an upstream change touches our edits.

## Considered Options

- **Commit the full cloned files and compare them by hand after each release.** Rejected because a full copy can't show what changed upstream without also keeping the original, and nothing makes anyone do the comparison.
- **Wait for an upstream extension point.** Rejected as a dependency, because nothing guarantees one will arrive. It can still replace the patches if it does.

## Consequences

- Clones only exist once the shipped files they're built from exist on that machine.
- A vendored fork is handled differently: the graph mod's changes are too large for patches, so its full source lives in the repo.
