# The reference machine is the source of truth, the manifests are a snapshot of it

Third-party plugins and skills get added, tried and dropped day to day with `claude plugin install` and `npx skills add`, not by editing the repo first. So the setup actually installed on the reference machine is the source of truth, and `manifests/` records it: a snapshot writes the machine's state into the manifests, and install/update replay them on other machines. Snapshot only writes files; the diff is reviewed and committed by hand, and anything personal stays out through the ignore list.

## Considered Options

- **Repo as source of truth** (classic dotfiles: edit the manifest, then install). Rejected because the manifests kept drifting from what was really in use, since nobody edits a manifest before trying a plugin.

## Consequences

- `global/settings.json` is excluded and stays hand-curated: the live `settings.json` holds machine-specific hooks and permissions.
- Only user-scope tooling is recorded; project-scope plugins belong to their projects.
