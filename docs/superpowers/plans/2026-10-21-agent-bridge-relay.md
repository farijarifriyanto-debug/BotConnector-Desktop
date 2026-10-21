# Agent bridge: relay `agent.*` + Device CLI ↔ bccli serve — Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paired computer can host coding-agent sessions (`bccli serve`, loopback-only) that the phone drives through the existing device relay: RPC methods `agent.*` end-to-end (phone-side caller = account-api `/v1/client/devices/{id}/request|stream`), long-lived SSE streaming of bccli mux items, interactive approvals, and honest capacity/runtime errors — with owner-mandated caps (2 agent streams per account, 20 global).

**Architecture:** Two production artifacts in this repo: (1) the **relay** (`web/device-relay.cjs` core class + `web/device-relay-service.cjs` standalone service on the VPS, loopback `127.0.0.1:18443`, trusted-upstream token) gains `agent.*` in `ALLOWED_METHODS`, a streamable-method set, abort-on-client-disconnect, stream caps, and device error-code pass-through; (2) the **Device CLI** (`desktop/local/device-bridge.cjs` dispatch) gains a new module `desktop/local/agent-bridge.cjs` that discovers/spawns/health-checks `bccli serve`, wraps its HTTP API as `agent.*` RPC handlers, and mirrors one bccli mux WS stream per `agent.stream` request into relay `device.event` frames. No new servers, no inbound ports, no new auth.

**Tech Stack:** CommonJS `.cjs`, Node >= 22.12, built-in `node:test` + `node:assert/strict`, hand-rolled plain-object fakes and injectable seams (`fetchImpl`, `spawn`, `this.fetch`) — repo convention, NO new dependencies (`ws ^8.18.3` already present). CI: `.github/workflows/device-cli.yml` runs `npm run check:device` (ubuntu) + targeted `node --test` (windows). No lint config exists in this repo.

**Spec:** `farijarifriyanto-debug/BotConnector-Chat` repo, branch `docs/agent-remote-laptop-design-20261021`, file `docs/superpowers/specs/2026-10-21-agent-remote-laptop-design.md` — §5 (wire contract), §6 (bridge), §9 (security), §11 (R1–R5), §14 (B2–B5, O1–O2). Read the spec first. bccli serve contract: `farijarifriyanto-debug/bccli` `docs/serve-api.md` @ v0.4.9.

## Global Constraints

- **Anti-goals are hard failures:** no inbound exposure on the user's computer (serve stays loopback; bridge stays an outbound WS client); no auto-approval; no silent fallbacks (missing runtime → honest error code, never pretend/route to cloud).
- **Error codes (exact strings, machine-readable):** `agent_runtime_missing` (bccli not found / serve won't start), `agent_not_configured` (bccli present but no usable provider config — §14-B3), `agent_unsupported` (bccli older than `MIN_BCCLI = '0.4.9'`), `agent_busy` (409 from messages POST), `agent_capacity` (stream caps). Existing device codes (`DEVICE_OFFLINE` 409, `DEVICE_TIMEOUT` 504, `DEVICE_METHOD_NOT_ALLOWED` 403) unchanged. Old Device CLI advertises no `agent.*` capabilities → relay 403 capability check (`device-relay.cjs:250-265`) → app shows update guidance (O2 Plan A) — no new code for that path, but it must not regress.
- **Caps (owner decision O1):** `AGENT_STREAM_PER_ACCOUNT = 2`, `AGENT_STREAM_GLOBAL = 20`, enforced in `web/device-relay-service.cjs` on `agent.stream` only; exceed → HTTP 429 code `AGENT_CAPACITY`; counters decrement on response `close` exactly once.
- **Fixed sizes/time:** mux→relay event byte budget `900_000` bytes (device→relay WS `maxPayload` is 1 MB, `device-relay.cjs:171`); forwarded `tool_result.output` cap `32 * 1024` chars + marker `\n[truncated]` (B4); `agent.session` baseline ≤ ~200 KB JSON with `{truncated:true, omittedCount:n}` (B2); heartbeat `{heartbeat:true}` every 25 s during `agent.stream`; serve idle-kill 30 min with no open stream/RPC; `agent.stream` relay-side request timeout disabled (0 = no timer); other `agent.*` use `LOCAL_AI_REQUEST_TIMEOUT_MS` (15 min, `device-relay.cjs:7`).
- **Permission:** `agent.start` always creates sessions with `permissionMode:'ask'`; any client-supplied `permissionMode` is rejected; `agent.approve` accepts only `yes|no|session` (never `all`).
- **bccli spawn contract (verified @ 0.4.9):** `bccli serve --port 0 --token <hex>` writes its banner to **stderr** (`bccli src/cli.ts:74`), line `bccli serve http://127.0.0.1:<port>`; token may also come from env `BCCLI_SERVE_TOKEN`. Bridge generates `crypto.randomBytes(32).toString('hex')`, keeps `{port, token, child}` **in memory only**. HTTP: `GET /health` → `{ok,version}`; `GET /v1/models`; `POST /v1/sessions {cwd, permissionMode, model?}`; `GET /v1/sessions?cwd=` → `[{id,mtime,preview}]`; `GET /v1/sessions/:id` → `{id,cwd,permissionMode,messages}`; `POST .../messages {prompt}` → 202 `{turnId}` / 409 busy; `POST .../approvals {requestId,answer}`; `POST .../cancel`. WS `/v1/mux` Bearer token; frames per `docs/serve-api.md`.
- **Repo mechanics:** new shipped file MUST be added to `package.json` `files` allowlist (lines 10–29) AND to the `check`/`check:device` `node --check`/`node --test` chains (lines 34–35) AND to CI test lists (`device-cli.yml:149,154` where applicable) — the tgz install gate in CI catches allowlist misses. Version bump = `package.json` + `package-lock.json` in the release commit (repo convention; CI creates tag `device-v<version>` + immutable GH Release from `package.json` version on push to main). `main` receives PR-squash merges.
- **Production VPS rules (owner standing rules):** any VPS change = audit + backup + canary + rollback; write scripts to a file, `scp`, execute (no complex inline quoting from PowerShell); SSH `botadmin@100.127.25.35` (Tailscale), key `C:\Users\farij\.ssh\codex_trading_lab_vps_ed25519`. Production candidate tree: `/home/botadmin/newbotconnector/production-candidate`. Sequencing (O1): server-side acceptance of `agent.*` BEFORE any Device CLI release.
- **Gates per code task:** `npm run check:device` (or the task's listed `node --test` files) exit 0. Full `npm run check` before the release commit.

## Review Focus

1. **Client-disconnect hygiene** (streams live for hours; leaks multiply): SSE `res` close → AbortSignal → relay sends `{type:'device.cancel', id}` → bridge closes that mux WS + clears heartbeat. Pinned by Task 1 (signal→device.cancel, pending removed), Task 2 (res close aborts), Task 5 (mux closed on cancel and on device-socket close).
2. **Byte budget:** a bccli item with 100k-char CJK `display` (~300 KB UTF-8; bccli caps chars not bytes) + 32 KB output must serialize ≤ 900 KB in the `device.event` frame — bridge shrinks `display` by BYTES. Pinned by Task 5 byte-budget test.
3. **Error-code survival:** `error.code` set by the bridge must reach the relay-service caller (`device.response{ok:false,error:{message,code}}` → rejected Error with `.code` → service JSON/SSE error keeps `code` for `agent_*`). Pinned by Task 1 + Task 2 + Task 4 tests.
4. **Caps accounting:** 3rd concurrent per-account stream and 21st global → 429 `AGENT_CAPACITY`; counters correct after normal end, error end, and client abort (no double-decrement, no leak). Pinned by Task 2 tests.
5. **Permission invariants:** `agent.start` with `permissionMode:'bypassPermissions'` param → rejected, never forwarded; `agent.approve answer:'all'` → rejected. Pinned by Task 4 tests.
6. **Honest runtime errors:** bccli absent → `agent_runtime_missing`; present but unconfigured (empty/401 `GET /v1/models`) → `agent_not_configured`; version < 0.4.9 → `agent_unsupported`. Pinned by Task 3 tests.
7. **Old-device path unchanged:** a device whose hello lacks `agent.*` still gets 403 capability rejection for agent methods (existing behavior — must not regress via allowlist edits). Pinned by Task 2 test.
8. **Docs/runbook truth (B5):** runbook steps match what Task 0 actually found on the VPS (paths, unit names, manifest mechanics); feature does not ship if either pipeline is unverified.

---

### Task 0: Production recon (read-only) — R1/R2/R3 + B5 discovery

**Files:**
- Create: `docs/superpowers/specs/2026-10-21-agent-bridge-production-recon.md` (findings; committed on this branch)
- Read-only on VPS: account-api source for `/v1/client/devices/*`, nginx site confs, relay deployment (systemd unit / artifact path), `/var/www/botconnector-device`

**Interfaces:**
- Produces: verified facts that pin Task 7 (runbook) and Task 8 (deploy): (a) does account-api allowlist device methods or pass through? exact file:line; (b) nginx read/send timeouts + `proxy_buffering` for the `/v1/client/devices/{id}/stream` route (25 s heartbeats must fit); (c) how account-api calls the relay (`/internal/devices/...` + `x-botconnector-device-internal`? confirm) and how device errors surface to the app (status/body shape — pins whether `agent_*` codes pass); (d) relay service deployment: unit name, artifact path, restart command, current deployed version vs repo; (e) `/var/www/botconnector-device` contents: manifest `device-cli.json` (origin/path/sha fields), versioned tgz naming, how a GH Release artifact gets copied there (manual scp? script?); (f) any existing per-account stream limits in account-api.
- Consumes: VPS access per Global Constraints; repo facts from this plan.

- [ ] **Step 1: Recon script.** Write `recon-agent.sh` locally (single file, read-only commands: `grep -rn` over account-api tree for `devices/.*request|stream|method|allow`, `nginx -T` dump of relevant `location` blocks incl. timeouts/buffering, `systemctl list-units | grep -i relay` + `systemctl cat <unit>`, `ls -la /var/www/botconnector-device`, `cat device-cli.json`, `curl -sS http://127.0.0.1:18443/healthz` or equivalent, deployed relay file hash vs repo). `scp` to VPS, run via SSH, capture full output to a local file.
- [ ] **Step 2: Findings doc.** Fill the spec file: one section per item (a)–(f) with exact paths/lines/quotes, each marked VERIFIED / NOT FOUND / BLOCKED. Include the GO/NO-GO matrix: GO requires (a) answer known (pass-through OR allowlist location identified), (b) timeouts accommodate 25 s heartbeats or the exact conf line to change, (d)+(e) update procedures identified.
- [ ] **Step 3: If account-api has a method allowlist** → add a pinned sub-section: file, exact list constant, change required for the 9 `agent.*` methods, and its deploy/rollback procedure (this becomes concrete input to Task 8).
- [ ] **Step 4: Commit** findings doc (`docs: production recon findings for agent bridge (R1-R3, B5)`). No production changes in this task — strictly read-only.

**Go/No-Go:** if (b), (d) or (e) cannot be verified → STOP, report to owner; per B5 the feature does not ship without verified pipelines. Tasks 1–6 (repo code) may proceed in parallel regardless; Task 8 may not.

**Outcome (executed 2026-10-21, see `docs/superpowers/specs/2026-10-21-agent-bridge-production-recon.md`):** GO for Tasks 1–7, with four new facts that changed the plan: (1) the production device relay is **DOWN** (no systemd unit installed, port 18443 closed, stale unix socket, nginx 502) — Task 8a restores it; (2) the deployed `device-relay-service.cjs` has unix-socket support the repo lacks → new **Task 0.5** ports it back (deploying the repo as-is would cut account-api off); (3) the public API catch-all route for `/v1/client/devices/*` has **default 60 s read timeout and buffering on** → Task 8b adds a dedicated nginx location (`proxy_buffering off`, 3600 s); (4) account-api's device-stream upstream timeout is **15 minutes** → Task 8c raises it (or the app must heartbeat+reconnect within that window).

### Task 0.5: Port unix-socket support into repo (blocker found by Task 0)

**Files:**
- Modify: `web/device-relay-service.cjs` — refactor the HTTP handler into a named `handler` so a second listener can reuse it; add the optional unix-socket listener (production artifact already has it; the repo does not — deploying the repo as-is would cut account-api off from the relay, because the container reaches the relay ONLY through `DEVICE_RELAY_SOCKET`)
- Test: `web/device-relay-service.test.cjs`

**Interfaces:**
- Consumes: the production artifact `services/device-relay/device-relay-service.cjs` (sha256 `fb5a0baa…ccac51`) — the exact 16-line change was recovered by `git diff` repo↔production (see Task 0 findings doc §g).
- Produces: `createDeviceRelayServer()` returns `{ server, relay, config, handler }`; `if (require.main === module)` additionally starts a unix-socket listener when `BOTCONNECTOR_DEVICE_RELAY_SOCKET` is set (`fs.unlinkSync` stale socket → `listen(socketPath)` → `chmodSync 0o666` → log). The repo's `package.json` `files` allowlist already ships `web/*`? — NO: `web/*` is NOT packed (the relay is deployed from the repo, not the tgz) → no allowlist change needed.

- [ ] **Step 1: Failing test** (append to `web/device-relay-service.test.cjs`): boot the service with `socketPath` in a temp dir → after listen, a Unix-socket HTTP request to the internal route (e.g. `POST /internal/pair` with the internal token) returns 200; the socket file exists and is connectable; a second server without `socketPath` creates no socket file. (Existing HTTP/TCP tests must stay green.)
- [ ] **Step 2: Run** `node --test web/device-relay-service.test.cjs` → new test FAIL.
- [ ] **Step 3: Implement** — mirror the recovered production change exactly (same env var name, same chmod, same log line) so a future deploy is behaviour-identical to today's production artifact.
- [ ] **Step 4: Run** `node --test web/device-relay.test.cjs web/device-relay-service.test.cjs` → all PASS.
- [ ] **Step 5: Commit** `feat(relay-service): restore unix-socket listener (parity with deployed artifact; account-api reaches relay only via socket)`.

### Task 1: Relay core — abortable requests + `device.cancel` + agent timeouts (`web/device-relay.cjs`)

**Files:**
- Modify: `web/device-relay.cjs` — `request()` (timeout selection ~268-274, frame send ~284), `forwardEvent` (220-227), `resolveResponse` (229-247), pending bookkeeping (27-29)
- Test: `web/device-relay.test.cjs` (stub-socket pattern at lines 26-47: plain object `{readyState:1, send(raw), close()}` installed as `stored.socket`)

**Interfaces:**
- Consumes: existing `DeviceRelay` maps (`devices`, `pending`); `LONG_LOCAL_AI_METHODS` / `LOCAL_AI_REQUEST_TIMEOUT_MS` (lines 7-8).
- Produces (used by Task 2 + Task 5): `request(userId, deviceId, method, params, { onEvent, signal })` — `signal` is an optional `AbortSignal`; on abort the relay removes the pending entry, clears its timer, sends `{"type":"device.cancel","id":<requestId>}` to the device socket when `readyState===1`, and rejects with an Error whose `.code === 'aborted'`. Timeout policy inside `request()`: `method === 'agent.stream'` → no timer; `method.startsWith('agent.')` → `LOCAL_AI_REQUEST_TIMEOUT_MS`; else unchanged. `resolveResponse` for `{ok:false}` rejects with an Error carrying `.message` AND `.code` from `frame.error.code` when present. `forwardEvent`/`resolveResponse` for unknown ids remain silent no-ops (post-abort frames from the device are dropped).

- [ ] **Step 1: Failing tests** (append to `web/device-relay.test.cjs`, reuse the stub-socket + `setImmediate(relay.resolveResponse…)` idiom): (a) `request(..., {signal})` + `controller.abort()` → sends `device.cancel` frame with the same `id` as the `device.request` frame, promise rejects `err.code === 'aborted'`, a later `resolveResponse` for that id does not throw; (b) `agent.stream` with `requestTimeoutMs: 50` and a socket that never replies → still pending after 200 ms (no timer), then abort → rejects `aborted`; (c) `chat.completions` still times out at `requestTimeoutMs` (regression); (d) `resolveResponse {ok:false, error:{message:'X', code:'agent_busy'}}` → rejects with `err.message==='X' && err.code==='agent_busy'`; without `code` → `err.code === undefined` (old devices unaffected).
- [ ] **Step 2: Run** `node --test web/device-relay.test.cjs` → new tests FAIL, old PASS.
- [ ] **Step 3: Implement** per Produces. Keep changes method-agnostic where possible (the only agent-specific logic is the timeout policy line).
- [ ] **Step 4: Run** `node --test web/device-relay.test.cjs` → all PASS. Then `node --test web/device-relay-service.test.cjs` (no regression).
- [ ] **Step 5: Commit** `feat(relay): abortable requests with device.cancel, agent.* timeout policy, error code pass-through`.

### Task 2: Relay service — allowlist, streamable set, caps, disconnect abort (`web/device-relay-service.cjs`)

**Files:**
- Modify: `web/device-relay-service.cjs` — `ALLOWED_METHODS` (13-35), stream gate (179-182), SSE writer (184-208), `errorJson` call sites (248-258), constants near line 11
- Test: `web/device-relay-service.test.cjs` (fake-relay injection pattern at lines 66-78: `{attach(){}, close(){}, async request(userId, deviceId, method, params, options){…}}`)

**Interfaces:**
- Consumes: Task 1's `request(..., {onEvent, signal})` and Error `.code`.
- Produces (used by account-api/app via Task 8; pinned for Plan C): `ALLOWED_METHODS` gains exactly `agent.capabilities, agent.workspaces, agent.sessions, agent.session, agent.start, agent.prompt, agent.approve, agent.cancel, agent.stream`. New `STREAMABLE_METHODS = new Set(['chat.completions', 'agent.stream'])` replaces the hardcode: gate becomes `if (!STREAMABLE_METHODS.has(method) || !ALLOWED_METHODS.has(method)) → 403 DEVICE_METHOD_NOT_ALLOWED`. `POST /internal/devices/:id/stream` with `method==='agent.stream'`: after auth/uuid gates, check caps (`inflight` Map userId→count, plus `inflightTotal`); over cap → `errorJson(res, 429, 'AGENT_CAPACITY', …)` BEFORE contacting the device; else increment, create `AbortController`, pass `signal` to `relay.request`, and `res.on('close', …)` → `controller.abort()` + decrement exactly once (guard flag). SSE frames unchanged in shape: `data: {"event":{…}}` per device event (heartbeats `{heartbeat:true}` pass through as ordinary events), `data: {"done":true,"result":…}` on success. Error emission: when `err.code` is a string starting with `agent_`, the JSON route returns `errorJson(res, 502, err.code, err.message)` (lowercase code verbatim, e.g. `agent_busy`) and the SSE route emits `{"error":{"message":…,"code":…}}`; all other errors keep the existing status→code mapping (248-258). Same `.code` pass-through on the non-stream `/internal/devices/:id/request` route (212-229).

- [ ] **Step 1: Failing tests** (append; reuse boot helper lines 9-22 and fake relay): (a) allowlist contains all 9 `agent.*`, still excludes `shell.exec`; (b) stream gate accepts `agent.stream` (fake relay `request` records `method/params.stream===true`, emits `onEvent({heartbeat:true})` then resolves → SSE body contains `"heartbeat":true` and `"done":true`); (c) stream gate still rejects `models.list` with 403; (d) caps: with `AGENT_STREAM_PER_ACCOUNT=2` (export constants for test override or construct service with injectable caps — pin: read from optional constructor opts `{agentStreamPerAccount, agentStreamGlobal}` defaulting to 2/20): 3rd concurrent `agent.stream` for one user_id → 429 `AGENT_CAPACITY` while a different user still succeeds; global cap → 429 for anyone; after one stream ends (`res` closed), count frees up; (e) abort: fake relay captures `options.signal`; test closes the response mid-stream → `signal.aborted === true` within 50 ms; (f) error code pass-through: fake relay rejects with `err.code='agent_busy'` on the request route → JSON error body has `code:'agent_busy'`; on the stream route → SSE `{"error":{…,"code":"agent_busy"}}`; (g) capability regression: relay-level 403 for unadvertised method still maps to `DEVICE_METHOD_NOT_ALLOWED` (existing matrix lines 112-202 untouched, must stay green).
- [ ] **Step 2: Run** `node --test web/device-relay-service.test.cjs` → new FAIL, old PASS.
- [ ] **Step 3: Implement** per Produces.
- [ ] **Step 4: Run** `node --test web/device-relay.test.cjs web/device-relay-service.test.cjs` → all PASS.
- [ ] **Step 5: Commit** `feat(relay-service): allow agent.* methods, agent.stream SSE with 2/account + 20/global caps, abort on disconnect, agent error codes`.

### Task 3: Device CLI — bccli serve lifecycle module (`desktop/local/agent-bridge.cjs`, new)

**Files:**
- Create: `desktop/local/agent-bridge.cjs`
- Create: `desktop/local/agent-bridge.test.cjs`
- Modify: `package.json` — `files` allowlist (add both? tests ship today: `files` lists only sources — add ONLY `desktop/local/agent-bridge.cjs`), `check` + `check:device` script chains (`node --check` + `node --test` entries)
- Modify: `.github/workflows/device-cli.yml` — add `desktop/local/agent-bridge.test.cjs` where device tests are listed (windows job line 149 list or ubuntu `check:device` coverage — `check:device` runs on ubuntu, so no workflow edit needed IF the file is in the `check:device` chain; verify and only touch the workflow if the file must run on windows too — pin: ubuntu via `check:device` is sufficient)

**Interfaces:**
- Consumes: spawn pattern of `cli/local-runtime.cjs:1224-1246` (`{windowsHide:true, stdio:'ignore'→['ignore','pipe','pipe'], detached:false}`) and readiness poll `waitManagedReady` (1193-1206); `AgentError` (new, exported: `{code, message}` where code ∈ Global Constraints list).
- Produces (used by Task 4 + Task 5): `class AgentBridge { constructor({ fetchImpl, spawnImpl, now, heartbeatMs, idleKillMs, dataDir } = {}) }` with async methods: `discoverBccli()` → path or throw `AgentError('agent_runtime_missing')`; resolution order: env `BOTCONNECTOR_BCCLI_PATH` → `bccli.cmd`/`bccli` on PATH (probe via `spawnImpl(path, ['--version'])` exit 0) → `~/.bccli/bin/bccli(.cmd)`; `ensureServe()` → `{port, token}`: reuse in-memory instance after `GET /health` (one restart on failure), else spawn `bccli serve --port 0 --token <randomBytes(32).hex>` with env `BCCLI_SERVE_TOKEN=<token>`, parse stderr banner `/bccli serve http:\/\/127\.0\.0\.1:(\d+)/` (15 s deadline), poll `/health` 500 ms/10 s; child `exit`/`error` clears state; `preflight()` → `{bccliVersion}`: `ensureServe` + `GET /health` version ≥ `MIN_BCCLI='0.4.9'` (naive semver compare) else `AgentError('agent_unsupported', 'bccli <v> is too old …update: npm i -g @botconnector/bccli')` + `GET /v1/models` non-empty and not 401/403 else `AgentError('agent_not_configured', setup link)`; `touch()` resets the idle timer; idle-kill: `idleKillMs` (default 30 min) with `openStreams === 0` → kill child; `close()` kills child (called from bridge shutdown). All HTTP through `this.fetch` seam with `Authorization: Bearer <token>`, base `http://127.0.0.1:<port>`.

- [ ] **Step 1: Failing tests** (`desktop/local/agent-bridge.test.cjs`, hand-rolled fakes per repo convention — fake `spawnImpl` returning an EventEmitter-ish `{stderr:{on}, stdout:{on}, kill(), on('exit')}` that emits the banner line; fake `fetchImpl` routing `/health`, `/v1/models`): (a) happy path: discover via `BOTCONNECTOR_BCCLI_PATH` → ensureServe parses port 51234 from stderr banner → returns `{port:51234, token:<64 hex>}`; spawn args exactly `['serve','--port','0','--token',<same token>]`, env includes `BCCLI_SERVE_TOKEN`; (b) missing everywhere (probe spawns fail, no `~/.bccli/bin` — inject `dataDir`/home seam) → `agent_runtime_missing`; (c) health 500 twice → restart once → still failing → `agent_runtime_missing`; (d) preflight: `/v1/models` → `[]` → `agent_not_configured`; 401 → same; (e) preflight: health `version:'0.4.8'` → `agent_unsupported`, message contains `0.4.9`; (f) idle-kill: `idleKillMs:30`, no streams → child killed after ~60 ms, state cleared; `touch()` prevents it; (g) child exit clears state so next `ensureServe` respawns.
- [ ] **Step 2: Run** `node --test desktop/local/agent-bridge.test.cjs` → FAIL (module missing).
- [ ] **Step 3: Implement** module.
- [ ] **Step 4: Run** test → PASS; update `package.json` allowlist + check chains; `npm run check:device` → PASS.
- [ ] **Step 5: Commit** `feat(device-cli): AgentBridge - discover/spawn/health-check bccli serve, honest runtime errors, idle-kill`.

### Task 4: Device CLI — `agent.*` RPC handlers + dispatch wiring

**Files:**
- Modify: `desktop/local/agent-bridge.cjs` — add `handle(method, params)` + per-method wrappers
- Modify: `desktop/local/device-bridge.cjs` — hello capabilities (429-455), `execute()` if-chain (514-566), `reply()` error path (574-577: include `code` when the thrown error has one), construction of `AgentBridge` (lazy, next to `localAi` init)
- Test: `desktop/local/agent-bridge.test.cjs` (handler tests), `desktop/local/device-bridge.test.cjs` (dispatch/hello/reply tests, fake-socket pattern lines 209-237)

**Interfaces:**
- Consumes: Task 3 `AgentBridge`; `desktop/local/workspaces.cjs` (`list()` at :124, `module.exports` at :215 — implementer reads exact export names); bccli HTTP contract (Global Constraints).
- Produces (pins the phone vocabulary for Plan C): `handle(method, params)` switch: `agent.capabilities` → NEVER spawns serve and never throws for missing runtime; returns `{supported:true, deviceCliVersion:<package.json version>, bccliVersion:<string from a quick `bccli --version` probe, or null when not found>}` (full preflight happens at `agent.start`); `agent.workspaces` → `Workspaces.list()` → `[{path, name?, lastUsed?}]` capped 20, most recent first; `agent.sessions {cwd?}` → GET passthrough `[{id,mtime,preview}]`; `agent.session {id, cwd?}` → baseline `{id,cwd,permissionMode,messages}`; if `JSON.stringify(messages)` > 200_000 bytes → drop oldest whole messages until under, append fields `{truncated:true, omittedCount:n}` (B2); `agent.start {cwd, model?}` → `preflight()` then `POST /v1/sessions {cwd, permissionMode:'ask', ...(model?{model}:{})}` → `{sessionId}`; params containing `permissionMode` → throw `Error('permissionMode is fixed to ask')`; `agent.prompt {sessionId, prompt}` → POST messages → `{turnId}`; 409 → `AgentError('agent_busy')`; `agent.approve {sessionId, requestId, answer}` → answer ∉ {yes,no,session} → `Error('answer must be yes|no|session')`; POST approvals → `{ok:true}`; `agent.cancel {sessionId}` → POST cancel → `{ok:true}`; `agent.stream` → Task 5. Any serve HTTP failure after retries → `AgentError('agent_runtime_missing')`. Hello capabilities (device-bridge.cjs:429-455) gain the 9 `agent.*` names unconditionally.

- [ ] **Step 1: Failing tests** — agent-bridge.test.cjs (fake `this.fetch` recording calls, stubbed ensureServe/preflight): (a) `agent.start` posts `{cwd, permissionMode:'ask'}` and returns `{sessionId}`; with `permissionMode:'bypassPermissions'` param → throws, fetch NOT called; (b) `agent.prompt` 409 → `AgentError` code `agent_busy`; (c) `agent.approve` answer `'all'` → throws; `'session'` → posts `{requestId, answer:'session'}`; (d) `agent.session` truncation: 300 KB of messages → result JSON ≤ ~200 KB, `truncated:true`, `omittedCount` correct, NEWEST messages kept; (e) `agent.workspaces` caps at 20, most recent first (fake Workspaces). device-bridge.test.cjs: (f) hello frame capabilities include `agent.stream` + `agent.start`; (g) `handleMessage {type:'device.request', method:'agent.prompt', …}` with fake AgentBridge → `device.response {ok:true, result:{turnId}}`; bridge throws `AgentError('agent_busy')` → `device.response {ok:false, error:{message, code:'agent_busy'}}`; (h) unknown `agent.foo` → `ok:false` (not a crash).
- [ ] **Step 2: Run** `node --test desktop/local/agent-bridge.test.cjs desktop/local/device-bridge.test.cjs` → new FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files → PASS; `npm run check:device` → PASS.
- [ ] **Step 5: Commit** `feat(device-cli): agent.* RPC handlers (start/prompt/approve/cancel/sessions/workspaces/capabilities) with fixed ask-mode and honest codes`.

### Task 5: Device CLI — `agent.stream` mux mirroring, caps on bytes, heartbeat, cancel

**Files:**
- Modify: `desktop/local/agent-bridge.cjs` — `stream(sessionId, params, onEvent, signal)` + internal mux management
- Modify: `desktop/local/device-bridge.cjs` — `handleMessage` (475-491): `streamEvent` creation condition currently `method === 'chat.completions' && params?.stream === true` → also `method === 'agent.stream'` (params.stream not required); accept new frame `{type:'device.cancel', id}` → route to the active agent stream's abort (chat.completions cancel path via `chat.cancel` stays untouched); on socket `close` (466-469 area) → abort all active agent streams (mux WS closed; bccli keeps turns running — engine replays pending approvals on reopen, spec §6)
- Test: `desktop/local/agent-bridge.test.cjs` — stub serve = REAL `node:http` + `ws.WebSocketServer` on port 0 (honest mux behavior: open/ready/item/end frames, Bearer check), per repo's real-server test precedent (`web/device-relay-service.test.cjs` boots real HTTP)

**Interfaces:**
- Consumes: Task 3 `ensureServe`; `ws` (existing dep); Task 1's relay `device.cancel` semantics.
- Produces (exactly what Plan C's phone client receives inside SSE `{event:…}`): `stream(sessionId, params, onEvent, signal)` → opens mux `ws://127.0.0.1:<port>/v1/mux` with `authorization: Bearer <token>`; on open sends `{type:'open', streamId:'agent-'+randomUUID(), target:'session:'+sessionId}`; forwards every `item` frame as `onEvent({item: capItem(value)})`; `end` frame for our streamId OR mux close-after-ready → resolve `{ok:true}` (relay emits `done`); mux `error`/close-before-ready → `AgentError('agent_runtime_missing')`. `capItem(v)`: if `v.type==='tool_result'` and `typeof v.output==='string'` and length > 32768 → `v.output = v.output.slice(0,32768)+'\n[truncated]'`; then byte budget: while `Buffer.byteLength(JSON.stringify({item:v})) > 900_000` and `v.display` present → re-slice `v.display` to 90 % of its current length (byte-safe: cut with `Buffer.from(d,'utf8').subarray(0,n).toString('utf8')` then re-append marker `\n[truncated]`). Heartbeat: `setInterval(heartbeatMs=25_000)` → `onEvent({heartbeat:true})`; cleared on finish/abort. `signal.aborted` → close mux WS, clear interval, reject `Error` `.code='aborted'` (relay already gone; device-bridge swallows `aborted` when replying to a dead socket). Registers in `openStreams` count (Task 3 idle-kill input).

- [ ] **Step 1: Failing tests** (stub serve emits scripted frames): (a) order + passthrough: ready → text → tool_use → tool_result → result → end ⇒ onEvent sequence `[{item:{type:'ready'…}}, …]` then resolve; item values byte-identical EXCEPT capped fields; (b) output cap: tool_result with 40 KB output → forwarded output length 32768+12, endsWith `\n[truncated]`, `display` untouched; (c) byte budget, two pinned cases: display `'字'.repeat(100_000)` (3-byte UTF-8 ⇒ ~300 KB) + 32 KB output ⇒ frame < 900 KB ⇒ assert NO shrink and `Buffer.byteLength` of the serialized event < 1_000_000 (device WS cap); synthetic over-budget case display `'字'.repeat(290_000)` (the stub bypasses bccli's own 100k cap, simulating a future engine) ⇒ assert the shrink loop brings the serialized event ≤ 900_000 bytes, the result is valid UTF-8 (no lone surrogates: `Buffer.from(d,'utf8').toString('utf8') === d` round-trip), and ends with the `\n[truncated]` marker; (d) heartbeat: `heartbeatMs:20` → two `{heartbeat:true}` events before end; (e) abort: `controller.abort()` → mux WS closed (stub server observes close), interval cleared, rejects `.code==='aborted'`; (f) device-bridge: `{type:'device.cancel', id}` frame aborts the matching stream; socket `close` aborts all streams; (g) mux close before ready → `agent_runtime_missing`.
- [ ] **Step 2: Run** → new FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test desktop/local/agent-bridge.test.cjs desktop/local/device-bridge.test.cjs` → PASS; `npm run check:device` → PASS.
- [ ] **Step 5: Commit** `feat(device-cli): agent.stream mirrors bccli mux with 32KB output cap, 900KB byte budget, 25s heartbeat, device.cancel`.

### Task 6: Release prep — version 0.4.20 + full gate

**Files:**
- Modify: `package.json` (`"version": "0.4.19"` → `"0.4.20"`) + `package-lock.json` (same field; repo convention bumps both in the release commit)
- Modify (if Task 0 findings require): nothing else — runbook lives in Task 7 doc

**Interfaces:**
- Consumes: all previous tasks merged on this branch.
- Produces: the version CI turns into tag `device-v0.4.20` + immutable GH Release (device-cli.yml:86-109) on merge to main.

- [ ] **Step 1:** bump both files.
- [ ] **Step 2:** `npm run check` (FULL chain — `node --check` every file + all 13+ test files) → exit 0; `npm pack --dry-run` → tgz contains `package/desktop/local/agent-bridge.cjs` (allowlist proof).
- [ ] **Step 3: Commit** `chore(release): device v0.4.20 - agent.* bridge (bccli serve) + relay caps`; **push branch, open PR** against `main` titled `Agent bridge: relay agent.* + Device CLI ↔ bccli serve (device v0.4.20)` with spec link, caps, error-code table, and a note that merge MUST wait for Task 8 sequencing decision (O1: CI creates the public release on push to main — merging IS releasing the artifact; owner authorizes merge timing). CI green required.

### Task 7: Release runbook (B5) — both production artifacts, verified

**Files:**
- Create: `docs/agent-release-runbook.md` (durable repo doc, not dated — it is operated every release)

**Interfaces:**
- Consumes: Task 0 findings (paths, unit names, manifest mechanics).
- Produces: step-by-step, copy-pasteable runbook with verification after each step and rollback per step; B5 gate restated: unverified pipeline = do not ship.

- [ ] **Step 1: Write** two sections. (A) Device CLI: merge → CI GH Release `device-v<ver>` (immutable; re-run skips) → copy `device-cli.tgz` to app host as `/var/www/botconnector-device/device-cli-v<ver>.tgz` (exact mechanism from Task 0-e) → update `device-cli.json` `{version, url, tag?, sha256?}` satisfying launcher locks (`launcher/cli.cjs:31-36`: url origin === manifest origin `https://app.botconnector.id`, pathname exactly `/device-cli-v<ver>.tgz`) → verify: `curl -sS https://app.botconnector.id/device-cli.json` + `curl -sI <url>` 200 + fresh-machine `npx https://app.botconnector.id/device-cli-launcher-v1.0.2.tgz version` prints `<ver>`. (B) Relay: artifact = repo `web/device-relay*.cjs` on the VPS (path/unit/restart from Task 0-d): backup current files → deploy → `systemctl restart <unit>` → health probe → canary (Task 8 Step 4) → rollback = restore backup + restart.
- [ ] **Step 2: Dry-run** every verification command that is safe pre-release (curl manifests, unit status, backup creation) and paste real outputs into the doc as evidence. Commands that would publish (release create, tgz copy, manifest edit) are listed but NOT executed — they run on release day with owner authorization.
- [ ] **Step 3: Commit** `docs: release runbook for Device CLI tgz + relay deployment (B5, verified pipelines)`.

### Task 8: Production deploy + server-side acceptance (owner-gated; AFTER Task 0 GO, BEFORE any CLI release)

**Files:** production VPS only (relay artifact; account-api allowlist IFF Task 0 found one); no repo changes expected — if the account-api change lives in a different repo/tree, record exact diff + rollback in the recon doc addendum.

**Interfaces:**
- Consumes: Task 7 runbook; merged relay code (branch PR merged OR cherry-picked artifact per Task 0-d deployment mechanics — pin after Task 0); Task 0 findings doc (exact paths, unit file, nginx conf lines, account-api patch points).
- Produces: live relay accepting `agent.*`; evidence log; capacity + timeout behavior verified against production nginx/account-api (R1).

- [ ] **Step 0: Task 8a — restore the downed device relay (precondition).** The relay is currently OFF in production (Task 0 findings: no systemd unit, 18443 closed, stale socket, nginx 502 → local-AI pairing broken for all users). Restore with the known unit file (`services/device-relay/backup-before-socket-20261007-092508/botconnector-device-relay.service`): install the unit (user unit per `WantedBy=default.target`, or system unit — pick one and record it), `systemctl daemon-reload`, `enable --now`, then verify: `127.0.0.1:18443` LISTEN, unix socket connectable from the account-api container (`SOCKET OK`), `https://app.botconnector.id/api/devices/socket` no longer 502, and `GET /internal/devices?user_id=…` answers. Rollback = stop/disable the unit. **Report the outage + restoration to the owner as a separate incident note.**
- [ ] **Step 1: Pre-flight (owner authorization checkpoint — irreversible-ish production change):** present runbook + backup plan; proceed only on explicit owner go.
- [ ] **Step 2: Backup** relay files (and account-api file if touched) to `artifacts/backups/agent-bridge-<date>/` with sha256 (VPS convention; sibling examples `backups/20261021T161149-before-account-api-deploy.yaml`).
- [ ] **Step 3: Deploy** relay per runbook B; restart unit; health probe; `journalctl` tail clean.
- [ ] **Step 3b: Task 8b — nginx location for the device stream (R1).** In `botconnector-api.conf` add a dedicated location for the device routes (e.g. `location ^~ /v1/client/devices/ { proxy_buffering off; proxy_read_timeout 3600s; proxy_send_timeout 3600s; proxy_set_header Connection ""; proxy_pass http://127.0.0.1:49292; }` + a `limit_req` zone that does not throttle the stream, e.g. reuse `botconnector_account_api` with a generous burst). Backup the conf first, `nginx -t`, `sudo systemctl reload nginx`, verify with `curl -N` that SSE frames arrive beyond 60 s and are not buffered (first frame latency < 1 s). Rollback = restore backup + reload.
- [ ] **Step 3c: Task 8c — account-api changes (allowlist + stream timeout).** In the live image's `/app/device-routes.mjs`: add the 9 `agent.*` methods to `MOBILE_DEVICE_METHODS`; allow `agent.stream` on the stream action; raise the device-stream upstream timeout beyond 15 min (e.g. 60 min) or keep 15 min and require the app to reconnect within it. Then rebuild the image from the live image (`docker cp` the patched file out, patch, `FROM <live> COPY device-routes.mjs /app/`), tag `botconnector-production-candidate/account-api:agent-bridge-<date>-candidate`, deploy via the established pattern (`bin/deploy-service.sh deploy account-api <new> --expect-current <old> --actor claude-vps`), recreate the container so the env/mounts stay intact, verify `docker exec … node --check /app/device-routes.mjs` + `curl https://api.botconnector.id/v1/client/devices` still 401 without auth and 200 with a valid session. Rollback = redeploy the previous image tag. NOTE: the relay token secret must stay identical (`device_relay_internal_token` = `device_relay_token_account_api`, verified via `cmp -s`) — never rotate it as part of this change.
- [ ] **Step 4: Canary (real path, no mocks):** from a dev machine, using a REAL paired device (owner's laptop running the branch build: `node cli/botconnector-device.cjs connect`) and REAL bccli 0.4.9: via account-api public routes with account bearer — `POST /v1/client/devices/{id}/request {method:'agent.capabilities'}` → `{supported:true, bccliVersion:'0.4.9'…}`; `{method:'agent.start', params:{cwd}}` → `{sessionId}`; `POST .../stream {method:'agent.stream', params:{sessionId}}` → SSE receives `ready` + ≥1 `{heartbeat:true}` within 30 s; `{method:'agent.prompt'}` with a file-edit task → SSE shows `tool_use`/`approval_request`; `{method:'agent.approve', params:{answer:'yes'}}` → `tool_result` with `display` diff; disconnect SSE mid-turn → relay logs show abort/device.cancel, bccli turn survives; reconnect → pending approval replayed. Third concurrent stream → 429 `AGENT_CAPACITY`. Record every command+output in an evidence file; commit evidence to the branch (`docs/superpowers/specs/2026-10-21-agent-bridge-canary-evidence.md`).
- [ ] **Step 5: Rollback drill documented** (restore backup → restart → probe) — executed for real only on failure.
- [ ] **Step 6: Report to owner:** GO for Device CLI release (Task 6 merge + Task 7-A execution) or NO-GO with findings.

### Task 9: Handoff artifacts for Plan C

**Files:**
- Create: `docs/superpowers/specs/2026-10-21-agent-bridge-wire-asbuilt.md` — as-built wire reference for the app team: every `agent.*` method with request/result JSON examples captured from the Task 8 canary (real payloads, redacted), SSE frame sequence for a full turn incl. approval + cancel + reconnect-replay, error code table with HTTP statuses, caps + heartbeat/watchdog numbers (25 s heartbeat ⇒ app 120 s idle watchdog per spec §8).

**Interfaces:**
- Consumes: Task 8 evidence.
- Produces: the frozen contract Plan C codes against (any later change = update this doc first).

- [ ] **Step 1:** assemble from canary evidence (no invented examples).
- [ ] **Step 2:** cross-check every field against `bccli docs/serve-api.md` @ 0.4.9 (items pass through unchanged except the two caps).
- [ ] **Step 3: Commit** `docs: as-built agent.* wire reference for the mobile app (Plan C input)`.

---

## Out of scope (other plans / deferred)

- Phone app UI, store, i18n, watchdog UI behavior (Plan C — BotConnector-Chat repo, branch held until App Store 2.0.0 resolves).
- bccli engine changes (done: 0.4.9 display forwarding; todo/plan/subagent broadcasts + MCP in served sessions remain deferred per spec §3).
- Cloud agent workspace (route 3, separate project, spec §12).
- Relay WS ping/pong heartbeat (none exists today; dead-device detection relies on TCP close — flagged as a follow-up hardening candidate, not MVP-blocking because `agent.stream` heartbeats flow device→relay and the phone-side watchdog covers app reconnects).
- Bundling bccli into the Device CLI installer (R4 → later enhancement; MVP = honest `agent_runtime_missing` + install guidance).
