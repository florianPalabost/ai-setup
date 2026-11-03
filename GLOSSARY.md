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
A directory that install generates in the vendor dir to stand in for a vendored skill that can't be linked as is: it links to the skill's files, leaving out `.claude-plugin/` so Claude Code doesn't load the skill a second time as a plugin.
_Avoid_: copy, shadow

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
