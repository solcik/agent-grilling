# agent-grilling

**grill** — a local, always-on *agent-question inbox*. Agents (in any project, any
harness) post a batch of decisions — each a set of options with a recommended pick,
optionally carrying markdown / image / HTML context — and you answer them in one
browser panel, seeing every pending grilling side by side.

Built with **Effect v4** + **Foldkit**, driven by a small **CLI**. Nix wraps it as a
`systemd` user service so it's always on. Nothing about the tool depends on Nix.

> Status: scaffolding. Architecture lives in `AGENTS.md`.