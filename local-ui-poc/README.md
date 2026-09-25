# BotConnector Local UI POC

This directory documents the GitHub Actions-only experiment for a richer localhost browser UI.

## Scope

- Build the **Open WebUI v0.6.5 frontend only**.
- Produce static browser assets as a GitHub Actions artifact.
- Do **not** deploy it.
- Do **not** change Device CLI versions.
- Do **not** install Docker, Electron, Python, or Open WebUI on user devices as part of this POC.
- The eventual BotConnector design is expected to serve these browser assets from the existing Device CLI/local gateway.

## Why v0.6.5

The POC is intentionally pinned to Open WebUI v0.6.5, the BSD-3-Clause baseline identified by the upstream project. The upstream license notice is copied into the artifact.

## Artifact

Workflow: `.github/workflows/local-ui-poc.yml`

Output:

- `botconnector-local-ui-poc.tgz`
- `botconnector-local-ui-poc.sha256`

The archive contains static frontend assets, the upstream BSD license, and build provenance metadata.

## Acceptance gates before integration

1. No login/signup in the final BotConnector-local experience.
2. Served only from localhost by Device CLI.
3. Local model inventory maps to runnable backends, not display-only entries.
4. Load / chat / unload work end-to-end.
5. File upload works locally.
6. Tool/MCP integration works locally.
7. Resource use is acceptable before any Device CLI release is cut.
