{ pkgs, ... }:
# Local development environment for grill.
#
# grill the PRODUCT is Nix-agnostic (a plain npm package, published to the registry and
# run under Node — see AGENTS.md). This file is DEV tooling only: it is excluded from the
# published tarball (see the `files` allowlist in package.json) so nothing Nix ships to npm.
#
# Toolchain mirrors the host bun-dev convention: bun (package manager), Node 26 (the
# runtime grill ships against), and typescript-go / tsgo (the native TypeScript 7 compiler)
# for typechecking. Linting/formatting run through bun-installed oxlint/oxfmt.
{
  packages = [
    pkgs.bun # package manager (NOT the runtime; tests run via vitest, not `bun test`)
    pkgs.nodejs_26 # the runtime grill is built and shipped against
    pkgs.typescript-go # tsgo — native TypeScript 7 typechecker (`tsgo --noEmit`)
    pkgs.git
    pkgs.jq
  ];

  env.GRILL_STATE = ".grill-state"; # keep dev state inside the repo (gitignored)

  # Greeting goes to stderr so it never pollutes a command's stdout (e.g. a piped
  # `grill sessions` JSON) when tools are run through `direnv exec`.
  enterShell = ''
    # bun can drop the exec bit on @effect/tsgo's prebuilt platform binary; restore
    # it so `effect-tsgo diagnostics` and the editor LSP can spawn it. Idempotent.
    for b in node_modules/@effect/tsgo-*/lib/tsc; do
      [ -f "$b" ] && chmod +x "$b" 2>/dev/null || true
    done
    echo "grill dev — node $(node --version), bun $(bun --version), tsgo $(tsgo --version 2>/dev/null || echo '?')" >&2
  '';
}
