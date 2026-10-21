# As-Built Wire Reference: `agent.*` Remote Laptop Sessions (Plan C Input)

Date: 2026-10-21 / 2026-10-22 UTC · Status: **LIVE on `https://api.botconnector.id` & `https://app.botconnector.id`** · Device CLI version: `0.4.20` · Required `bccli` engine: `>= 0.4.9`.

All examples below are **real, redacted payloads captured from the Task 8 production canary** (`docs/superpowers/specs/2026-10-21-agent-bridge-canary-evidence.md`). Plan C (the mobile app UI in `BotConnector-Chat`) codes directly against this contract.

---

## 1. Transport & Authentication

All mobile requests use the existing paired-device endpoints on `https://api.botconnector.id` with the mobile session bearer token (`Authorization: Bearer bc_live_mobile_<token>`):

- **List devices (includes `capabilities`):**
  `GET /v1/client/devices`
- **One-shot RPC (`agent.capabilities`, `agent.workspaces`, `agent.sessions`, `agent.session`, `agent.start`, `agent.prompt`, `agent.approve`, `agent.cancel`):**
  `POST /v1/client/devices/{deviceId}/request`
  Body: `{"method": "agent.<name>", "params": { ... }}`
- **Long-lived SSE event stream (`agent.stream` ONLY):**
  `POST /v1/client/devices/{deviceId}/stream`
  Body: `{"method": "agent.stream", "params": {"sessionId": "<id>"}}`

> **Old Device CLI detection:** A paired laptop running Device CLI `< 0.4.20` will NOT include `"agent.start"` or `"agent.stream"` in `device.capabilities` on `GET /v1/client/devices` (and calling any `agent.*` method on it returns HTTP 403 `device_method_not_allowed`). The app should check `device.capabilities.includes('agent.start')` and show an update prompt (`npx https://app.botconnector.id/device-cli-launcher-v1.0.2.tgz connect`) when absent.

---

## 2. One-Shot RPC Methods (`POST /v1/client/devices/{deviceId}/request`)

### 2.1 `agent.capabilities`
Lightweight probe (never spawns `bccli serve`; never errors if `bccli` is missing).

**Request:**
```json
{
  "method": "agent.capabilities",
  "params": {}
}
```
**Response (`200 OK`):**
```json
{
  "result": {
    "supported": true,
    "deviceCliVersion": "0.4.20",
    "bccliVersion": "0.4.9"
  }
}
```
*(When `bccli` is not installed on the laptop, `bccliVersion` is `null`.)*

### 2.2 `agent.workspaces`
Returns up to 20 workspaces known to the laptop's `WorkspaceStore`, sorted most-recent first.

**Request:**
```json
{
  "method": "agent.workspaces",
  "params": {}
}
```
**Response (`200 OK`):**
```json
{
  "result": [
    {
      "path": "C:\\Users\\demo\\project",
      "name": "project",
      "lastUsed": "2026-10-21T17:51:53.000Z"
    }
  ]
}
```

### 2.3 `agent.start`
Runs `preflight()` (`bccli >= 0.4.9` and non-empty `/v1/models`) and creates a new `bccli` session in `permissionMode: "ask"`. Passing `permissionMode` in `params` is rejected with `400 agent_invalid_params`.

**Request:**
```json
{
  "method": "agent.start",
  "params": {
    "cwd": "C:\\Users\\demo\\project"
  }
}
```
*(Optional field: `"model": "gmi/Qwen/Qwen3.8-Max"`.)*

**Response (`200 OK`):**
```json
{
  "result": {
    "sessionId": "2026-10-21T17-51-53-808Z-8b4c27"
  }
}
```

### 2.4 `agent.prompt`
Starts a turn on an existing session. Subscribe to `agent.stream` first (or concurrently) to receive live events.

**Request:**
```json
{
  "method": "agent.prompt",
  "params": {
    "sessionId": "2026-10-21T17-51-53-808Z-8b4c27",
    "prompt": "Read hello.txt and then use the edit tool to replace OLD_CANARY_VALUE with NEW_CANARY_VALUE in hello.txt."
  }
}
```
**Response (`200 OK`):**
```json
{
  "result": {
    "turnId": "522fd50a846d"
  }
}
```
*(If a turn is already running on `sessionId`, returns HTTP `502` with `error.code === "agent_busy"`.)*

### 2.5 `agent.approve`
Answers a pending `approval_request` item. Only `"yes"`, `"no"`, or `"session"` are accepted (`"all"` is rejected with `400 agent_invalid_params`).

**Request:**
```json
{
  "method": "agent.approve",
  "params": {
    "sessionId": "2026-10-21T17-51-53-808Z-8b4c27",
    "requestId": "5d8f53273a32",
    "answer": "yes"
  }
}
```
**Response (`200 OK`):**
```json
{
  "result": {
    "ok": true
  }
}
```

### 2.6 `agent.cancel`
Cancels the currently running turn on `sessionId` (the session itself remains open).

**Request:**
```json
{
  "method": "agent.cancel",
  "params": {
    "sessionId": "2026-10-21T17-51-53-808Z-8b4c27"
  }
}
```
**Response (`200 OK`):**
```json
{
  "result": {
    "ok": true
  }
}
```

### 2.7 `agent.sessions`
Lists saved `bccli` sessions (optionally filtered by `cwd`).

**Request:**
```json
{
  "method": "agent.sessions",
  "params": {
    "cwd": "C:\\Users\\demo\\project"
  }
}
```
**Response (`200 OK`):**
```json
{
  "result": [
    {
      "id": "2026-10-21T17-51-53-808Z-8b4c27",
      "mtime": "2026-10-21T17:52:35.660Z",
      "preview": "Read hello.txt and then use the edit tool to replace OLD_CANARY_VALUE with NEW_C"
    }
  ]
}
```

### 2.8 `agent.session`
Loads the baseline state and message history for a session. If `JSON.stringify(messages)` exceeds `200,000` bytes, the oldest whole messages are dropped from the front and `"truncated": true, "omittedCount": <n>` are added.

**Request:**
```json
{
  "method": "agent.session",
  "params": {
    "id": "2026-10-21T17-51-53-808Z-8b4c27",
    "cwd": "C:\\Users\\demo\\project"
  }
}
```
**Response (`200 OK`):**
```json
{
  "result": {
    "id": "2026-10-21T17-51-53-808Z-8b4c27",
    "cwd": "C:\\Users\\demo\\project",
    "permissionMode": "ask",
    "messages": [ ... ],
    "truncated": true,
    "omittedCount": 4
  }
}
```
*(Note: `truncated` and `omittedCount` are only present when messages were actually omitted.)*

---

## 3. SSE Event Stream (`POST /v1/client/devices/{deviceId}/stream`)

**Request:**
```json
{
  "method": "agent.stream",
  "params": {
    "sessionId": "2026-10-21T17-51-53-808Z-8b4c27"
  }
}
```

### 3.1 SSE Frame Sequence (Full Turn with Approval, Reconnect Replay, and Diff)

1. **Immediate initial comment line (flushes response headers within ~130 ms):**
   ```text
   :

   ```
2. **Session `ready` item:**
   ```text
   data: {"event":{"item":{"type":"ready","sessionId":"2026-10-21T17-51-53-808Z-8b4c27","host":{"home":"C:\\Users\\demo\\.bccli","version":"0.4.9"}}}}

   ```
3. **Periodic heartbeat every 25 seconds:**
   ```text
   data: {"event":{"heartbeat":true}}

   ```
4. **Tool execution & approval request (`approval_request`):**
   ```text
   data: {"event":{"item":{"type":"approval_request","requestId":"5d8f53273a32","tool":"edit","kind":"edit","target":"hello.txt","preview":"    1   line 1\n    2 - OLD_CANARY_VALUE\n    2 + NEW_CANARY_VALUE\n    3   line 3"}}}

   ```
   *(If the phone drops and re-opens `agent.stream` while an approval is pending, `bccli` keeps the turn alive and immediately replays `ready` followed by the same `approval_request` frame.)*
5. **Tool result with `display` diff (`tool_result`):**
   ```text
   data: {"event":{"item":{"type":"tool_result","tool":"edit","output":"Edited hello.txt.","isError":false,"display":"    1   line 1\n    2 - OLD_CANARY_VALUE\n    2 + NEW_CANARY_VALUE\n    3   line 3"}}}

   ```
   - `output` is capped at `32,768` characters + `"\n[truncated]"`.
   - The serialized `{"item": ...}` payload is capped at `<= 900,000` UTF-8 bytes by shrinking `display` on clean UTF-8 code-point boundaries + `"\n[truncated]"`.
6. **Turn completion (`result`):**
   ```text
   data: {"event":{"item":{"type":"result","text":"Done. `OLD_CANARY_VALUE` on line 2 of hello.txt is now `NEW_CANARY_VALUE`, verified by re-reading the file.","toolCalls":[...],"usage":{"inputTokens":58404,"outputTokens":183},"stopReason":"done"}}}

   ```
7. **Mid-stream error frame (if the runtime or device fails after HTTP 200 headers were sent):**
   ```text
   data: {"error":{"message":"...","code":"agent_runtime_missing"}}

   ```

---

## 4. Error Code Table

All HTTP errors from `account-api` return `{"error":{"code":"<code>","message":"<message>","type":"botconnector_error"}}` with lowercase `code`:

| `error.code` | HTTP Status | Meaning & Recommended App UX |
|---|---|---|
| `agent_runtime_missing` | `502` (or SSE `error`) | `bccli` is not installed on the laptop or `bccli serve` failed to start/respond. Show install command: `npm i -g @botconnector/bccli`. |
| `agent_unsupported` | `502` | Installed `bccli` is older than `0.4.9`. Show update command: `npm i -g @botconnector/bccli`. |
| `agent_not_configured` | `502` | `bccli` has no configured provider or models (`/v1/models` empty or 401/403). Direct user to sign in or configure `bccli`. |
| `agent_busy` | `502` | `agent.prompt` called while a turn is already running on that session. Offer to wait or call `agent.cancel`. |
| `agent_capacity` | `429` | Account already has 2 active `agent.stream` connections (or VPS global cap of 20 reached). Prompt user to close another active agent stream. |
| `agent_invalid_params` | `400` | Caller attempted to override `permissionMode` on `agent.start` or sent an `agent.approve` answer outside `yes\|no\|session`. |
| `device_offline` | `409` | Paired laptop is disconnected from the relay. |
| `device_timeout` | `504` | Paired laptop did not respond within the request timeout. |
| `device_method_not_allowed` | `403` / `400` | Laptop is running an older Device CLI (`< 0.4.20`) without `agent.*` capabilities, or `agent.stream` was called on `/request`. |

---

## 5. Timing, Caps & Client Watchdog Constants

- **Max concurrent `agent.stream` per account:** `2`
- **Max concurrent `agent.stream` globally on relay:** `20`
- **Bridge -> phone SSE heartbeat interval:** `25 seconds` (`{"event":{"heartbeat":true}}`)
- **Phone SSE idle watchdog (Plan C spec §8):** `120 seconds` (if no SSE byte/event arrives for 120 s, abort SSE, call `agent.session` baseline, and reopen `agent.stream`)
- **Server-side stream read timeout (Nginx & `account-api`):** `3600 seconds` (60 minutes per SSE connection)
- **`bccli serve` idle auto-shutdown on laptop:** `30 minutes` with `0` open streams
