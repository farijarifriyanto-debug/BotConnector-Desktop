# Agent Bridge & Device CLI — Release Runbook (B5)

This runbook documents the verified production deployment and release procedures for the two artifacts shipped from this repository:

1. **Server-side Device Relay (`web/device-relay.cjs` + `web/device-relay-service.cjs`)** and its companion edge/API configurations on the production VPS.
2. **Client-side Device CLI (`botconnector-device`, served via `https://app.botconnector.id/device-cli.json` and `/device-cli-v<ver>.tgz`)**.

> **Hard Gate (B5 & O1 Sequencing):**
> - Never ship the feature if either pipeline is unverified.
> - **Always deploy and verify Section B (Server-Side Relay + Nginx + `account-api`) BEFORE merging to `main` or executing Section A (Device CLI release).** Merging a version bump to `main` triggers `.github/workflows/device-cli.yml`, which automatically creates the immutable `device-v<ver>` GitHub Release.

---

## Section B — Server-Side Relay, Nginx, and `account-api` Deployment (Run First)

### B.1 Restore / Update `botconnector-device-relay` Service

**Host paths (verified on VPS):**
- Working directory: `/home/botadmin/newbotconnector/services/device-relay`
- Deployed files:
  - `/home/botadmin/newbotconnector/services/device-relay/device-relay.cjs`
  - `/home/botadmin/newbotconnector/services/device-relay/device-relay-service.cjs`
- Internal token secret: `/home/botadmin/newbotconnector/production-candidate/secrets/device_relay_internal_token` (must stay identical to `device_relay_token_account_api`; never rotate during relay deploy)
- State file: `/home/botadmin/.local/state/botconnector-device-relay/devices.json`
- Unix socket directory (bind-mounted into `account-api` container at `/run/botconnector-device`): `/home/botadmin/.botconnector-device-runtime`
- Unix socket path: `/home/botadmin/.botconnector-device-runtime/relay.sock`
- TCP listener (used by `app.botconnector.id` Nginx for `/api/devices/pair/exchange` and `/api/devices/socket`): `127.0.0.1:18443`

#### Step B.1.1 — Backup existing relay files and unit template
```bash
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BDIR="/home/botadmin/newbotconnector/production-candidate/artifacts/backups/agent-bridge-${TS}"
mkdir -p "$BDIR"
cp -a /home/botadmin/newbotconnector/services/device-relay/device-relay.cjs "$BDIR/"
cp -a /home/botadmin/newbotconnector/services/device-relay/device-relay-service.cjs "$BDIR/"
sha256sum "$BDIR"/device-relay*.cjs > "$BDIR/SHA256SUMS"
cat "$BDIR/SHA256SUMS"
```

#### Step B.1.2 — Copy updated `device-relay.cjs` and `device-relay-service.cjs`
Copy `web/device-relay.cjs` and `web/device-relay-service.cjs` from this repository to `/home/botadmin/newbotconnector/services/device-relay/`, then syntax-check with the production Node binary:
```bash
NODE_BIN="/home/botadmin/.nvm/versions/node/v24.20.0/bin/node"
"$NODE_BIN" --check /home/botadmin/newbotconnector/services/device-relay/device-relay.cjs
"$NODE_BIN" --check /home/botadmin/newbotconnector/services/device-relay/device-relay-service.cjs
```

#### Step B.1.3 — Install/update `botconnector-device-relay.service` and restart
Ensure `/home/botadmin/.botconnector-device-runtime` and `/home/botadmin/.local/state/botconnector-device-relay` exist (owned by `botadmin`), install `/etc/systemd/system/botconnector-device-relay.service` with `User=botadmin` and `BOTCONNECTOR_DEVICE_RELAY_SOCKET=/home/botadmin/.botconnector-device-runtime/relay.sock`, then reload and start:
```bash
mkdir -p /home/botadmin/.botconnector-device-runtime /home/botadmin/.local/state/botconnector-device-relay
sudo tee /etc/systemd/system/botconnector-device-relay.service >/dev/null <<'EOF'
[Unit]
Description=BotConnector Device Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=botadmin
Group=botadmin
WorkingDirectory=/home/botadmin/newbotconnector/services/device-relay
Environment=NODE_ENV=production
Environment=BOTCONNECTOR_DEVICE_RELAY_HOST=127.0.0.1
Environment=BOTCONNECTOR_DEVICE_RELAY_PORT=18443
Environment=BOTCONNECTOR_DEVICE_APP_ORIGIN=https://app.botconnector.id
Environment=BOTCONNECTOR_DEVICE_RELAY_TOKEN_FILE=/home/botadmin/newbotconnector/production-candidate/secrets/device_relay_internal_token
Environment=BOTCONNECTOR_DEVICE_RELAY_STATE_FILE=/home/botadmin/.local/state/botconnector-device-relay/devices.json
Environment=BOTCONNECTOR_DEVICE_RELAY_SOCKET=/home/botadmin/.botconnector-device-runtime/relay.sock
ExecStart=/home/botadmin/.nvm/versions/node/v24.20.0/bin/node /home/botadmin/newbotconnector/services/device-relay/device-relay-service.cjs
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
MemoryMax=192M
CPUQuota=35%

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now botconnector-device-relay.service
sudo systemctl restart botconnector-device-relay.service
sudo systemctl status botconnector-device-relay.service --no-pager -l
```

#### Step B.1.4 — Verify TCP health, container Unix socket, and Nginx upstream
```bash
# 1. Loopback TCP health
curl -sS http://127.0.0.1:18443/health

# 2. Container-to-relay Unix socket connectivity
sudo docker exec botconnector-production-candidate-account-api sh -c \
  'node -e "const net=require(\"net\");const s=net.connect(\"/run/botconnector-device/relay.sock\");s.on(\"connect\",()=>{console.log(\"SOCKET OK\");s.end();process.exit(0)});s.on(\"error\",e=>{console.error(\"SOCKET ERR\",e.code);process.exit(1)})"'

# 3. Public WebSocket endpoint (must not be 502)
curl -sS -o /dev/null -w "http_code=%{http_code}\n" https://app.botconnector.id/api/devices/socket
```

#### Rollback B.1
```bash
cp -a "$BDIR/device-relay.cjs" /home/botadmin/newbotconnector/services/device-relay/device-relay.cjs
cp -a "$BDIR/device-relay-service.cjs" /home/botadmin/newbotconnector/services/device-relay/device-relay-service.cjs
sudo systemctl restart botconnector-device-relay.service
```

---

### B.2 Nginx Unbuffered Location for `/v1/client/devices/` (`botconnector-api.conf`)

Without a dedicated location block, `/v1/client/devices/{id}/stream` falls into `location /` in `/etc/nginx/sites-available/botconnector-api.conf` with default `proxy_buffering on` and a 60-second read timeout.

#### Step B.2.1 — Backup and add location block
```bash
sudo cp -a /etc/nginx/sites-available/botconnector-api.conf "$BDIR/botconnector-api.conf.bak"
```
Add before `location /` in `/etc/nginx/sites-available/botconnector-api.conf`:
```nginx
    location ^~ /v1/client/devices/ {
        limit_req zone=botconnector_account_api burst=20 nodelay;
        limit_req_status 429;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_pass http://127.0.0.1:49292;
    }
```

#### Step B.2.2 — Test and reload Nginx
```bash
sudo nginx -t
sudo systemctl reload nginx
```

#### Rollback B.2
```bash
sudo cp -a "$BDIR/botconnector-api.conf.bak" /etc/nginx/sites-available/botconnector-api.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

### B.3 `account-api` Allowlist & Stream Gate (`device-routes.mjs`)

**Live file inside container:** `botconnector-production-candidate-account-api:/app/device-routes.mjs`

#### Step B.3.1 — Extract, backup, and patch `/app/device-routes.mjs`
1. Copy `/app/device-routes.mjs` out of the live container into `"$BDIR/device-routes.mjs.orig"`.
2. Add the 9 `agent.*` methods (`agent.capabilities`, `agent.workspaces`, `agent.sessions`, `agent.session`, `agent.start`, `agent.prompt`, `agent.approve`, `agent.cancel`, `agent.stream`) to `MOBILE_DEVICE_METHODS`.
3. Update the stream gate from `action === 'stream' && method !== 'chat.completions'` to allow both `'chat.completions'` and `'agent.stream'`, include `method.startsWith('agent.')` in the long-timeout (`slow`) set, and raise the `/stream` `relayCall` `timeoutMs` from `15 * 60 * 1000` to `60 * 60 * 1000` (matching Nginx's `3600s` read timeout).
4. Build a candidate image layered on the currently running image and deploy via `bin/deploy-service.sh`:
```bash
cd /home/botadmin/newbotconnector/production-candidate
CUR_IMG="$(sudo docker inspect botconnector-production-candidate-account-api --format '{{.Config.Image}}')"
NEW_IMG="botconnector-production-candidate/account-api:agent-bridge-$(date -u +%Y%m%d)-candidate"

cat > "$BDIR/Dockerfile" <<EOF
FROM ${CUR_IMG}
COPY device-routes.mjs /app/device-routes.mjs
EOF

sudo docker build -t "$NEW_IMG" "$BDIR"
bin/deploy-service.sh deploy account-api "$NEW_IMG" --expect-current "$CUR_IMG" --actor claude-vps
```

#### Rollback B.3
```bash
cd /home/botadmin/newbotconnector/production-candidate
bin/deploy-service.sh deploy account-api "$CUR_IMG" --expect-current "$NEW_IMG" --actor claude-vps
```

---

## Section A — Device CLI Release (`botconnector-device` TGZ + Manifest)

### Launcher Verification Locks (`launcher/cli.cjs:31-36`)
The published launcher (`https://app.botconnector.id/device-cli-launcher-v1.0.2.tgz`) enforces three checks on `https://app.botconnector.id/device-cli.json`:
1. `version` must match `/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/`.
2. `url` origin **must equal** `https://app.botconnector.id` and `pathname` **must equal** `/device-cli-v<version>.tgz`.
3. If `sha256` is present, it must be a 64-character hex digest matching the downloaded tarball.

### Step A.1 — Merge Release PR to `main`
1. Confirm `package.json` and `package-lock.json` carry the target `<version>` (e.g. `0.4.20`).
2. Merge the PR into `main`.
3. Wait for `.github/workflows/device-cli.yml` to finish green on `main` and publish the immutable GitHub Release `device-v<version>`.

### Step A.2 — Install Versioned Tarball and Update `/var/www/botconnector-device/device-cli.json`
On the VPS (`botadmin@100.127.25.35`):
```bash
VER="0.4.20"
TAG="device-v${VER}"
WWW="/var/www/botconnector-device"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

# 1. Backup current manifest
sudo cp -a "$WWW/device-cli.json" "$WWW/device-cli.json.bak-${TS}"

# 2. Download the release tarball from GitHub Release to a staging file
curl -fsSL "https://github.com/farijarifriyanto-debug/BotConnector-Desktop/releases/download/${TAG}/device-cli.tgz" \
  -o "/tmp/device-cli-v${VER}.tgz"

# 3. Compute SHA-256 and verify archive contents include agent-bridge.cjs
SHA="$(sha256sum "/tmp/device-cli-v${VER}.tgz" | awk '{print $1}')"
tar -tzf "/tmp/device-cli-v${VER}.tgz" | grep -q '^package/desktop/local/agent-bridge.cjs$'
echo "Verified tarball sha256=${SHA}"

# 4. Install tarball and update stable symlink + manifest atomically
sudo install -m 0644 "/tmp/device-cli-v${VER}.tgz" "$WWW/device-cli-v${VER}.tgz"
sudo ln -sfn "device-cli-v${VER}.tgz" "$WWW/device-cli.tgz"
printf '{"url":"https://app.botconnector.id/device-cli-v%s.tgz","version":"%s","sha256":"%s"}\n' \
  "$VER" "$VER" "$SHA" | sudo tee "$WWW/device-cli.json.tmp" >/dev/null
sudo mv "$WWW/device-cli.json.tmp" "$WWW/device-cli.json"
rm -f "/tmp/device-cli-v${VER}.tgz"
```

### Step A.3 — Public Verification
```bash
curl -sS https://app.botconnector.id/device-cli.json
curl -sSI "https://app.botconnector.id/device-cli-v${VER}.tgz" | head -n 10
npx --yes https://app.botconnector.id/device-cli-launcher-v1.0.2.tgz --version
```
Expected: `npx` prints `0.4.20`.

### Rollback A
```bash
sudo cp -a "$WWW/device-cli.json.bak-${TS}" "$WWW/device-cli.json"
sudo ln -sfn "device-cli-v0.4.19.tgz" "$WWW/device-cli.tgz"
curl -sS https://app.botconnector.id/device-cli.json
```

---

## Pre-Release Dry-Run Evidence (Captured 2026-10-21)

Safe read-only checks executed prior to release:

```text
=== 1. Public manifest check ===
{"url":"https://app.botconnector.id/device-cli-v0.4.19.tgz","version":"0.4.19","sha256":"22ae0fbd23eba60c4a01947eb79be7d23ad716528001b69bc79e5acf5759ce9a"}

=== 2. Public versioned TGZ HEAD ===
HTTP/1.1 200 OK
Content-Type: application/gzip
Content-Length: 107623
Cache-Control: public, max-age=31536000, immutable

=== 3. Local CLI --version ===
0.4.20
```
