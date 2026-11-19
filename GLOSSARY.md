# ai-setup

A personal AI coding setup: the instructions, settings, own skills and third-party tooling in use on one machine, published so other machines and other people can reproduce it.

## Language

**Reference machine**:
The machine whose installed setup the repo records. What is installed there is, by definition, the setup.
_Avoid_: main machine, source machine

**Manifest**:
A list in `manifests/` of the third-party plugins or skills the setup includes, as recorded by the last snapshot.
_Avoid_: config, lockfile

**Ignore list**:
Items on the reference machine that a snapshot deliberately leaves out of the manifests, because they're personal or experimental.
_Avoid_: exclude list, blacklist

**Skill mirror**:
A directory that install generates in the vendor dir to stand in for a vendored skill that can't be linked as is: it links to the skill's files, leaving out `.claude-plugin/` so Claude Code doesn't load the skill a second time as a plugin, and holds a rewritten `SKILL.md` where a rename applies.
_Avoid_: copy, shadow

**Git panel**:
The herdr side panel that gathers git and GitHub information for the current branch and for the user's work.
_Avoid_: Git tab

**Herdr feature**:
One part of the herdr setup that install offers to tick or untick: the Git panel, the Factory panel, the Find panel, Quick open or Search.
_Avoid_: module, component, plugin

**Factory panel**:
The herdr side panel that lists the factory's tickets by lane and opens the Factory tab and the Run graph tab.
_Avoid_: Factory tab, board

**Section**:
One collapsible part of the Git panel.

**Graph tab**:
The herdr tab that shows the full commit graph: one per space, reused if it's already open.

**Root**:
The folder Quick open, Search and Find look in. It is the git root of the focused pane's folder, or that folder itself outside a repository.
_Avoid_: project, workspace

**Quick open**:
The herdr popup that finds a file in the Root by fuzzy name.
_Avoid_: file picker, go to file

**Search**:
The herdr popup that finds text inside the Root's files, with the matches grouped by file.
_Avoid_: grep, find in files

**Find**:
The herdr side panel that does Quick open and Search at once. It lists the files whose name matches, then the matches inside files.
_Avoid_: search panel, explorer

**Pick**:
A file or match chosen in Quick open, Search or Find, shown in the Viewer unless sent to VS Code or a Pinned Viewer.
_Avoid_: selection, result

**Viewer**:
The herdr tab that shows and edits one file at a time, named after that file. Each space has one, and each Pick replaces its file unless it has unsaved edits.
_Avoid_: editor, preview

**Pinned Viewer**:
A Viewer tab that keeps its file and ignores Picks.
_Avoid_: Viewer tab of its own, extra Viewer

**Clone**:
A copy of something herdr ships, adjusted by this setup, which herdr never updates by itself.
_Avoid_: fork

**Vendored fork**:
Third-party code kept in this repo and changed freely, with no expectation of following upstream.
_Avoid_: clone

## Operations

**Snapshot**:
Recording the reference machine's installed third-party tooling into the manifests. It only writes files; publishing the result is a separate, manual step.
_Avoid_: export, dump, sync

**Install**:
Bringing a machine in line with the repo and its manifests by adding whatever is missing. Things that are already present keep their current version.
_Avoid_: setup, sync, bootstrap

**Update**:
An install, followed by moving everything already installed to its latest upstream version, this repo included, whether or not it is in a manifest.
_Avoid_: upgrade, sync, refresh
