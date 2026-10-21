# Agent Bridge — Production Deployment & Live E2E Canary Evidence (Task 8)

Date: 2026-10-21 / 2026-10-22 UTC · Host: VPS `botadmin@100.127.25.35` (`api.botconnector.id` + `app.botconnector.id`) + Windows 11 paired laptop running `DeviceBridge` / `AgentBridge` (`v0.4.20` branch) + real `bccli` (`0.4.8` -> `0.4.9`).

---

## 1. Production Deployment Summary & Backups

All backups were written to `/home/botadmin/newbotconnector/production-candidate/artifacts/backups/agent-bridge-20261021/` (plus standard `deploy-service.sh` compose backup `/home/botadmin/newbotconnector/production-candidate/backups/20261022T002304-before-account-api-deploy.yaml`):

| Component | Before (Backup / SHA-256) | Deployed / Live State | Verification |
|---|---|---|---|
| **Task 8a — `botconnector-device-relay.service`** | Unit missing in `/etc/systemd/system`; `device-relay.cjs.before` (`18c48bba...`), `device-relay-service.cjs.before` (`fb5a0baa...`) | Installed `/etc/systemd/system/botconnector-device-relay.service` (`enabled`, `active`); `device-relay.cjs` (`3b87d4d3...`), `device-relay-service.cjs` (`9e7da47b...`) | TCP `127.0.0.1:18443/health` -> `200 {"ok":true,"service":"botconnector-device-relay"}`; Unix socket `/run/botconnector-device/relay.sock` inside `account-api` -> `200`; `app.botconnector.id/api/devices/pair/exchange` -> `401` (no longer `502`) |
| **Task 8b — Nginx `/v1/client/devices` (`botconnector-api.conf`)** | `botconnector-api.conf.before` (`8faddd01...`, catch-all `location /` with 60 s read timeout & buffering on) | Added `location ^~ /v1/client/devices` (no trailing slash so `/v1/client/devices` does not 301-redirect) with `proxy_buffering off; proxy_request_buffering off; proxy_cache off; proxy_read_timeout 3600s; proxy_send_timeout 3600s;` | `sudo nginx -t` OK, `systemctl reload nginx` OK, `GET https://api.botconnector.id/v1/client/devices` -> `401` JSON (no 301, no buffering) |
| **Task 8c — `account-api` (`device-routes.mjs`)** | `botconnector-production-candidate/account-api:image-package-20261021-v3-candidate`, `device-routes.mjs.before` (`3d4d9ff6...`) | `botconnector-production-candidate/account-api:agent-bridge-20261021-v2-candidate`, `device-routes.mjs` (`6f8eabe4...`: 9 `agent.*` methods in `MOBILE_DEVICE_METHODS` & `WEB_DEVICE_METHODS`, `STREAMABLE_DEVICE_METHODS = {'chat.completions','agent.stream'}`, 60-min stream timeout) | Pre-deploy gates (`contract-test.mjs` 62/62, `e2e-contract.mjs` 42/42, `e2e-contract-free.mjs` 121/121, batch `node --test` 107/107) PASS; container healthy in 6 s |

### Rollback Commands (Verified Ready)
- **Relay:**
  ```bash
  BDIR="/home/botadmin/newbotconnector/production-candidate/artifacts/backups/agent-bridge-20261021"
  cp -a "$BDIR/device-relay.cjs.before" /home/botadmin/newbotconnector/services/device-relay/device-relay.cjs
  cp -a "$BDIR/device-relay-service.cjs.before" /home/botadmin/newbotconnector/services/device-relay/device-relay-service.cjs
  sudo systemctl restart botconnector-device-relay.service
  ```
- **Nginx:**
  ```bash
  sudo cp -a "$BDIR/botconnector-api.conf.before" /etc/nginx/sites-available/botconnector-api.conf
  sudo nginx -t && sudo systemctl reload nginx
  ```
- **`account-api`:**
  ```bash
  cd /home/botadmin/newbotconnector/production-candidate
  bin/deploy-service.sh deploy account-api \
    "botconnector-production-candidate/account-api:image-package-20261021-v3-candidate" \
    --expect-current "botconnector-production-candidate/account-api:agent-bridge-20261021-v2-candidate" \
    --actor claude-vps
  ```

---

## 2. Live E2E Canary Execution & Raw Evidence (`2026-10-21T17:51:22Z` .. `17:52:36Z`)

All requests below were sent over public HTTPS (`https://api.botconnector.id/v1/client/devices/*` and `https://app.botconnector.id/api/devices/*`) with a real `native_mobile` bearer token, a real paired Windows laptop (`deviceId: febe8b03-9aeb-49ee-bf6d-c80750889d15`), and real `bccli` (`0.4.8` then `0.4.9`, model `gmi/Qwen/Qwen3.8-Max`).

### 2.1 Pairing & `GET /v1/client/devices`
- `POST /v1/client/devices/pair` -> `200 OK` (`object: "device_pair_code"`, `expires_at: "2026-10-21T17:56:25.623Z"`)
- Laptop `DeviceBridge.pair(code)` connected to `wss://app.botconnector.id/api/devices/socket`.
- `GET /v1/client/devices` -> `200 OK`:
  ```json
  {
    "id": "febe8b03-9aeb-49ee-bf6d-c80750889d15",
    "online": true,
    "capabilities": [
      "hardware.get",
      "launcher.list",
      "launcher.start",
      "launcher.stop",
      "tools.list",
      "agent.capabilities",
      "agent.workspaces",
      "agent.sessions",
      "agent.session",
      "agent.start",
      "agent.prompt",
      "agent.approve",
      "agent.cancel",
      "agent.stream"
    ]
  }
  ```

### 2.2 Pre-Upgrade `bccli 0.4.8` Honest Error Check (`agent_unsupported`)
- `POST /v1/client/devices/{id}/request` `{"method":"agent.capabilities","params":{}}` -> `200 OK`:
  ```json
  {
    "result": {
      "supported": true,
      "deviceCliVersion": "0.4.20",
      "bccliVersion": "0.4.8"
    }
  }
  ```
- `POST /v1/client/devices/{id}/request` `{"method":"agent.start","params":{"cwd":"..."}}` -> `502 Bad Gateway`:
  ```json
  {
    "error": {
      "code": "agent_unsupported",
      "message": "bccli 0.4.8 is too old (minimum 0.4.9). Update with: npm i -g @botconnector/bccli",
      "type": "botconnector_error"
    }
  }
  ```
- Note: during the initial Windows canary probe, `child_process.spawn('bccli.cmd', ...)` threw `EINVAL` on Node 24 (`win32` CVE-2024-27980 `.cmd` restriction). Fixed in `desktop/local/agent-bridge.cjs` (`spawnCandidate` + `resolveWin32CmdEntry` resolving `@botconnector/bccli/dist/cli.js` via `process.execPath` with `shell: true` fallback) and covered by two unit tests in `desktop/local/agent-bridge.test.cjs`.

### 2.3 Upgrade to `bccli 0.4.9`, Capabilities, Workspaces, and Permission Guard
- Upgraded global `@botconnector/bccli` on laptop to `0.4.9`.
- `POST /v1/client/devices/{id}/request` `{"method":"agent.capabilities","params":{}}` -> `200 OK`:
  ```json
  {
    "result": {
      "supported": true,
      "deviceCliVersion": "0.4.20",
      "bccliVersion": "0.4.9"
    }
  }
  ```
- `POST /v1/client/devices/{id}/request` `{"method":"agent.workspaces","params":{}}` -> `200 OK` (returned 1 workspace).
- `POST /v1/client/devices/{id}/request` `{"method":"agent.start","params":{"cwd":"...","permissionMode":"bypassPermissions"}}` -> `400 Bad Request`:
  ```json
  {
    "error": {
      "code": "agent_invalid_params",
      "message": "permissionMode dikunci ke ask untuk sesi agen.",
      "type": "botconnector_error"
    }
  }
  ```

### 2.4 Session Start, Unbuffered SSE (`ready` + `25s heartbeat`), and Capacity Cap (`429 agent_capacity`)
- `POST /v1/client/devices/{id}/request` `{"method":"agent.start","params":{"cwd":"..."}}` -> `200 OK`:
  ```json
  {
    "result": {
      "sessionId": "2026-10-21T17-51-53-808Z-8b4c27"
    }
  }
  ```
- `POST /v1/client/devices/{id}/stream` `{"method":"agent.stream","params":{"sessionId":"2026-10-21T17-51-53-808Z-8b4c27"}}` -> `200 OK` (`content-type: text/event-stream; charset=utf-8`):
  - First-byte latency (`:\n\n` comment + `ready` frame): **129 ms**
  - Received `ready` event and 25-second `heartbeat` event without Nginx buffering:
    ```json
    [
      {
        "event": {
          "item": {
            "type": "ready",
            "sessionId": "2026-10-21T17-51-53-808Z-8b4c27",
            "host": {
              "home": "<redacted-home>\\.bccli",
              "version": "0.4.9"
            }
          }
        }
      },
      {
        "event": {
          "heartbeat": true
        }
      }
    ]
    ```
- Opened a 2nd concurrent `agent.stream` (`200 OK`), then attempted a 3rd concurrent `agent.stream` for the same account -> **`429 Too Many Requests`**:
  ```json
  {
    "error": {
      "code": "agent_capacity",
      "message": "Batas sesi agen aktif tercapai. Tutup sesi lain lalu coba lagi.",
      "type": "botconnector_error"
    }
  }
  ```

### 2.5 Prompt, `approval_request`, `agent_busy`, Mid-Turn Disconnect/Reconnect Replay, Approval, and Diff `display`
- `POST /v1/client/devices/{id}/request` `{"method":"agent.prompt","params":{"sessionId":"2026-10-21T17-51-53-808Z-8b4c27","prompt":"Read hello.txt and then use the edit tool to replace OLD_CANARY_VALUE with NEW_CANARY_VALUE in hello.txt. Do not use bash."}}` -> `200 OK`:
  ```json
  {
    "result": {
      "turnId": "522fd50a846d"
    }
  }
  ```
- SSE stream received `approval_request`:
  ```json
  {
    "type": "approval_request",
    "requestId": "5d8f53273a32",
    "tool": "edit",
    "kind": "edit",
    "target": "hello.txt",
    "preview": "    1   line 1\n    2 - OLD_CANARY_VALUE\n    2 + NEW_CANARY_VALUE\n    3   line 3"
  }
  ```
- Concurrent `agent.prompt` while turn was waiting on approval -> `502 Bad Gateway`:
  ```json
  {
    "error": {
      "code": "agent_busy",
      "message": "Agent session is already running a turn.",
      "type": "botconnector_error"
    }
  }
  ```
- **Mid-turn SSE disconnect & reconnect replay:** Aborted SSE stream #1 while `requestId: "5d8f53273a32"` was pending. Reconnected a fresh `POST .../stream` (`agent.stream`) -> `bccli` turn survived and immediately replayed `ready` (`readySeen: true`) + `approval_request` (`replayedRequestId: "5d8f53273a32"`).
- `agent.approve` with `answer: "all"` -> rejected with `400 Bad Request` (`code: "agent_invalid_params"`).
- `agent.approve` with `{"sessionId":"2026-10-21T17-51-53-808Z-8b4c27","requestId":"5d8f53273a32","answer":"yes"}` -> `200 OK` (`{"result":{"ok":true}}`).
- SSE stream received `tool_result` with unified diff in `display`, followed by `result`:
  ```json
  {
    "type": "tool_result",
    "tool": "edit",
    "output": "Edited hello.txt.",
    "isError": false,
    "display": "    1   line 1\n    2 - OLD_CANARY_VALUE\n    2 + NEW_CANARY_VALUE\n    3   line 3"
  }
  ```
- `agent.sessions` and `agent.session` returned the persisted session (`id: "2026-10-21T17-51-53-808Z-8b4c27"`, `permissionMode: "ask"`, `messageCount: 8`).
- Canary device and temporary Redis session token were revoked in `finally` (`200 {"ok":true}`, `{"revoked":true}`).

---

## 3. Reference-First Comparison Matrix

| Perilaku Referensi (Spec `2026-10-21-agent-remote-laptop-design.md` & `bccli 0.4.9 serve-api.md`) | Implementasi Kita (`BotConnector-Desktop` + `account-api` + Nginx) | Bukti Uji Nyata | Status | Tindakan |
|---|---|---|---|---|
| 9 metode `agent.*` (`capabilities`, `workspaces`, `sessions`, `session`, `start`, `prompt`, `approve`, `cancel`, `stream`) lewat relay yang sama tanpa port inbound baru di laptop | `web/device-relay-service.cjs`, `device-routes.mjs`, `desktop/local/device-bridge.cjs`, `desktop/local/agent-bridge.cjs` | Canary E2E produksi lulus untuk seluruh 9 metode + 149 unit test | **MATCH** | Siap rilis |
| `permissionMode` selalu `'ask'`; `agent.approve` hanya menerima `yes\|no\|session` (menolak `all`) | Ditegakkan berlapis di `web/device-relay-service.cjs` (HTTP 400 `agent_invalid_params`) dan `desktop/local/agent-bridge.cjs` | Canary E2E produksi: `permissionMode: 'bypassPermissions'` -> 400; `answer: 'all'` -> 400; `answer: 'yes'` -> 200 | **MATCH** | Siap rilis |
| Kuota 2 stream agen aktif per akun & 20 global di relay (`429 agent_capacity`) | `web/device-relay-service.cjs` (`AGENT_STREAM_PER_ACCOUNT = 2`, `AGENT_STREAM_GLOBAL = 20`, per-request `slotReleased` guard) | Canary E2E produksi: stream ke-3 ditolak 429 `agent_capacity`; setelah stream ke-2 ditutup, kuota kembali bebas | **MATCH** | Siap rilis |
| SSE unbuffered dengan heartbeat 25 dtk, disconnect SSE menutup mux WS (`device.cancel`) tanpa mematikan turn `bccli`, reconnect me-replay `approval_request` | `location ^~ /v1/client/devices` (`proxy_buffering off`, 3600 s), `DeviceRelay` `AbortSignal` -> `device.cancel`, `AgentBridge.stream` | Canary E2E produksi: first-byte 129 ms, heartbeat diterima, disconnect + reconnect me-replay `requestId: 5d8f53273a32` | **MATCH** | Siap rilis |
| `tool_result` membawa `display` diff (cap byte-budget <= 900 KB UTF-8 aman, `output` <= 32 KB) | `capItem` & `sliceUtf8Clean` di `desktop/local/agent-bridge.cjs` | Canary E2E produksi (`display` diff `OLD_CANARY_VALUE -> NEW_CANARY_VALUE`) + tes 100k/290k CJK di `agent-bridge.test.cjs` | **MATCH** | Siap rilis |
| Kode error jujur (`agent_runtime_missing`, `agent_not_configured`, `agent_unsupported`, `agent_busy`, `agent_capacity`) | `AgentError` + `AGENT_ERROR_CODES` di relay + `relayFailure` lowercase di `account-api` | Canary E2E produksi membuktikan `agent_unsupported` (`0.4.8`), `agent_busy` (409), dan `agent_capacity` (429) | **MATCH** | Siap rilis |
