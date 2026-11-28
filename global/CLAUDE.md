@AGENTS.md

@RTK.md

<!-- herdr-chat:subagents begin -->
## Sub-agents in Herdr
To start a Pi, Claude Code, Codex or Antigravity sub-agent, run `hc run --bg --name <name> pi-chat "<task>"` (or `claude-chat`, `codex-chat`, `agy-chat`), so the person can open it as a chat.
Use `hc run --bg --name <name> -- pi` (or `-- claude`, `-- codex`, `-- agy`) only when you need its terminal UI.
Everything else is the same: `hc send`, `hc wait`, `hc read` and `hc kill` by name.
<!-- herdr-chat:subagents end -->
