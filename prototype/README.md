# Prototype (reference only — DO NOT SHIP)

A zero-dependency Node throwaway that proved the grill UX end to end:
the multi-session **inbox** (sidebar of pending sessions), **dark mode by default**
with a light toggle, options with a **recommended** pick pre-selected, **Accept all
recommended**, per-session isolation, and the `round.json` → `answer.json` file loop.

Reproduce this look and behavior in the **Foldkit** UI (`src/ui/`). Do not ship this
Node server — the real server is `grill serve` (Effect HttpApi). Run the prototype with
`node serve.mjs` (serves on :4100).
