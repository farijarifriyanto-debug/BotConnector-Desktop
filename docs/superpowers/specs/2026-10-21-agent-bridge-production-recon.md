# Production recon — agent bridge (Plan B, Task 0)

Date: 2026-10-21 · Mode: READ-ONLY on VPS (`botadmin@100.127.25.35`, Tailscale) · sudo nopasswd tersedia · tidak ada perubahan produksi pada recon ini.
Raw evidence: 7 skrip recon (`/tmp/recon-agent{,2..7}.sh` di VPS) + output lokal.

Legend: **VERIFIED** = dibaca langsung di host. **NOT FOUND** = tidak ada. **BLOCKED** = tidak bisa diverifikasi tanpa perubahan.

---

## Ringkasan eksekutif (baca ini dulu)

1. **Penting — relay device produksi MATI.** Unit systemd `botconnector-device-relay.service` **tidak terpasang** di `/etc/systemd/system` (hanya ada di folder backup `services/device-relay/backup-before-socket-20261007-092508/`). Tidak ada proses relay; `127.0.0.1:18443` tidak listening; socket `/run/botconnector-device/relay.sock` basi (file tertinggal 9 Okt, `ECONNREFUSED` dari container account-api); nginx `https://app.botconnector.id/api/devices/socket` dan `/api/devices/pair/exchange` → **502**. Artinya fitur "Local AI / pairing laptop" **tidak berfungsi di produksi saat ini** (device tidak bisa connect, relay tidak bisa menjangkau device). Ini insiden terpisah dari Plan B, tapi **blokir canary Plan B** dan harus dipulihkan lebih dulu.
2. **Penting — drift repo vs artefak produksi.** `web/device-relay.cjs` di repo == file yang deployed (identik semantik; beda hanya line ending). Tapi `web/device-relay-service.cjs` yang deployed **memiliki tambahan dukungan unix-socket** (+16 baris) yang **belum ada di repo**. Deploy versi repo apa adanya akan **mematahkan account-api** (container hanya reach relay lewat socket; `DEVICE_RELAY_URL` tidak di-set). → Repo harus disinkronkan dulu (Task 0.5).
3. **Penting — nginx memotong SSE panjang di sisi API publik.** Route `/v1/client/devices/{id}/stream` jatuh ke catch-all `location /` (`botconnector-api.conf:186-195`) yang **tidak** punya `proxy_buffering off` dan **tidak** punya `proxy_read_timeout` panjang → default nginx 60 s. Stream agen (berjam-jam) **pasti terputus** di edge publik. → Butuh `location` khusus (R1 = VERIFIED, actionable).
4. **Allowlist metode ADA di account-api** (R3 = VERIFIED): `device-routes.mjs` di image account-api punya `MOBILE_DEVICE_METHODS` / `WEB_DEVICE_METHODS` + gate `action === 'stream' && method !== 'chat.completions'`. `agent.*` **tidak akan** lolos sebelum di-patch + image di-rebuild.

---

## (a) account-api: allowlist metode device — VERIFIED

Sumber: file **live di dalam container** `botconnector-production-candidate-account-api:/app/device-routes.mjs` (165 baris; di-mount sebagai bagian image, bukan bind mount). Salinan di host: `/home/botadmin/newbotconnector/production-candidate/build/universal-catalog-20261007/live-account-api/device-routes.mjs` (7 Okt — **stale**, jangan dipakai sebagai acuan).

- `MOBILE_DEVICE_METHODS` = `hardware.get, runtime.status, models.list, model.load, model.unload, chat.completions, chat.cancel`
- `WEB_DEVICE_METHODS` = MOBILE + `runtime.start/stop`, `runtime.install.*`, `models.pull.*`, `models.delete`
- Gate (fungsi `handleClientDevices`): `if (!allowedMethods.has(method) || (action === 'stream' && method !== 'chat.completions')) → 403 device_method_not_allowed`
- Route: `POST /v1/client/devices/{id}/request|stream|revoke`; `user_id` selalu dari identitas terautentikasi (`native_mobile` credential atau BFF webapp), bukan dari body.
- Streaming: `relayCall(cfg, base + '/stream', …, timeoutMs: 15 * 60 * 1000)` → SSE passthrough (`res.write(chunk)` per chunk, `res.on('close') → upstream.destroy()`).
- Slow-method pada route `request`: `chat.completions|model.load|model.unload` → 15 mnt; lainnya 12 s.
- Error mapping: `relayFailure` → `deps.error(res, status, String(code).toLowerCase(), message)`; catch-all → `504 device_timeout` / `503 local_relay_unavailable`.

**Implikasi Plan B:** dua baris harus berubah di `device-routes.mjs`: (1) masukkan 9 metode `agent.*` ke `MOBILE_DEVICE_METHODS`; (2) gate stream menerima `agent.stream` (jadi `STREAMABLE = new Set(['chat.completions','agent.stream'])`).
**Deploy account-api = build image baru + recreate container** (bukan patch file di host): pola `bin/deploy-*.sh` yang berlaku → patch → `docker build` (FROM image live) → `bin/deploy-service.sh deploy account-api <new> --expect-current <old> --actor claude-vps` → rollback = perintah sama dengan tag lama. `production-candidate` **bukan git repo**; image live = `botconnector-production-candidate/account-api:agnes-payg-flag-20261021-candidate` (408 MB, dibangun ~1 jam sebelum recon).

## (b) nginx: timeout & buffering untuk SSE device — VERIFIED ( actionable)

`/etc/nginx/sites-available/botconnector-api.conf` (server `api.botconnector.id`, upstream `127.0.0.1:49292` = account-api):

| route | buffering | read/send timeout | catat |
|---|---|---|---|
| `location = /v1/chat/completions` | off | 3600s/3600s | pola yang benar |
| `location = /v1/responses` | off | 3600s/3600s | |
| `location = /v1/messages` | off | 3600s/3600s | |
| `location ^~ /v1beta/` | off | 3600s/3600s | |
| `location = /v1/client/files` | off | 900s/900s | |
| `location = /v1/models` | (default) | (default) | |
| **`location /` (catch-all → dipakai `/v1/client/devices/*`)** | **default (on)** | **default (60s)** | **⚠️ stream device terpotus 60 s** |

`botconnector-app.conf` (server `app.botconnector.id`):
- `location = /api/devices/pair/exchange` → `proxy_pass http://127.0.0.1:18443` (limit_req `botconnector_device_pair` burst 5) — **kini 502 karena relay mati**.
- `location = /api/devices/socket` → `proxy_pass http://127.0.0.1:18443` + `proxy_read_timeout 3600s` + Upgrade — **kini 502**.

**Perubahan yang dibutuhkan (R1):** tambah `location` khusus di `botconnector-api.conf` untuk path device stream, minimal:
`proxy_buffering off; proxy_read_timeout 3600s; proxy_send_timeout 3600s; proxy_set_header Connection "";` (+ `limit_req` zone yang tidak memblokir, atau zone baru). Side effect positif: SSE laptop-chat yang ada ikut benar (kini ikut batas 60 s + buffering default).

## (c) account-api → relay: mekanisme — VERIFIED

- account-api (container) → relay lewat **unix socket** `DEVICE_RELAY_SOCKET=/run/botconnector-device/relay.sock` (bind mount `ro` dari `/home/botadmin/.botconnector-device-runtime`), header `x-botconnector-device-internal: <token>`; token dibaca dari `DEVICE_RELAY_TOKEN_FILE=/run/secrets/device_relay_token_account_api`.
- `DEVICE_RELAY_URL` **tidak** di-set → **socket adalah satu-satunya jalan** container → relay.
- Dua file secret identik (terverifikasi lewat `cmp -s`): `production-candidate/secrets/device_relay_internal_token` (dipakai relay, unit file) dan `…/device_relay_token_account_api` (dipakai container).
- Probe dari dalam container: `SOCKET ERR ECONNREFUSED` → relay benar-benar tidak hidup.

## (d) Deployment relay: cara jalankan & status — VERIFIED

Unit file **hanya ada di backup**: `services/device-relay/backup-before-socket-20261007-092508/botconnector-device-relay.service`:

```
WorkingDirectory=/home/botadmin/newbotconnector/services/device-relay
Environment=BOTCONNECTOR_DEVICE_RELAY_HOST=127.0.0.1
Environment=BOTCONNECTOR_DEVICE_RELAY_PORT=18443
Environment=BOTCONNECTOR_DEVICE_APP_ORIGIN=https://app.botconnector.id
Environment=BOTCONNECTOR_DEVICE_RELAY_TOKEN_FILE=/home/botadmin/newbotconnector/production-candidate/secrets/device_relay_internal_token
Environment=BOTCONNECTOR_DEVICE_RELAY_STATE_FILE=/home/botadmin/.local/state/botconnector-device-relay/devices.json
ExecStart=/home/botadmin/.nvm/versions/node/v24.20.0/bin/node /home/botadmin/newbotconnector/services/device-relay/device-relay-service.cjs
Restart=on-failure  RestartSec=2  NoNewPrivileges=true  PrivateTmp=true  MemoryMax=192M  CPUQuota=35%
WantedBy=default.target
```

- **Tidak ada** unit relay di `/etc/systemd/system` → butuh `sudo cp` + `systemctl daemon-reload` + `enable --now` (atau `systemctl --user`; unit pakai `WantedBy=default.target` → user unit). Perlu dipastikan saat restore.
- Artefak deployed: `services/device-relay/device-relay.cjs` (sha256 `18c48bba…09259`) & `device-relay-service.cjs` (sha256 `fb5a0baa…ccac51`) + `node_modules/` (deps `ws`) lokal.
- `web/device-relay.cjs` repo == deployed (identik semantik; hanya CRLF beda). `web/device-relay-service.cjs` repo **kurang** dukungan unix-socket (lihat §drift).
- State file relay: `/home/botadmin/.local/state/botconnector-device-relay/devices.json` (1290 B, ada) → daftar device tersimpan (device lama masih terdaftar, token hash).
- Tidak ada pm2/supervisor/screen; cron user tidak menyentuh relay; journald tidak punya entri unit relay (unit tak pernah ter-install di host ini).

## (e) Pipeline rilis Device CLI (B5) — VERIFIED

- CI (`.github/workflows/device-cli.yml`): `npm pack` → `dist/device/device-cli.tgz`; launcher tgz; on push to main → `gh release create device-v<version>` (immutable, skip bila sudah ada) berisi `device-cli.tgz`, `device-cli-launcher.tgz`, `device-cli.json`; URL aset = `https://github.com/<repo>/releases/download/device-v<ver>/device-cli.tgz`.
- Manifest produksi: `/var/www/botconnector-device/device-cli.json` = `{"url":"https://app.botconnector.id/device-cli-v0.4.19.tgz","version":"0.4.19","sha256":"22ae0fbd…59ce9a"}` (tanpa field `tag`).
- Launcher's locks (`launcher/cli.cjs:31-36`): `packageUrl.origin` **harus sama** dengan `manifest.origin`; `packageUrl.pathname` **harus persis** `/device-cli-v<version>.tgz`; sha256 opsional 64 hex.
- nginx menyajikan: `location = /device-cli.json` (alias, `no-store`), `location ~ ^/device-cli-v[0-9]+\.[0-9]+\.[0-9]+\.tgz$` (root `/var/www/botconnector-device`, `immutable` 1 tahun), plus blok eksplisit untuk versi lama; `device-cli.tgz` = symlink ke tgz versi terkini.
- Isi direktori saat ini: `device-cli-v0.3.0 … v0.4.11`, `v0.4.18`, `v0.4.19` (v0.4.20 belum ada) + launcher v1.0.1/v1.0.2 + `device-cli.json` + backup `.bak-*` (konvensi: backup file lama ditulis berdampingan).
- **Prosedur update yang terverifikasi (tidak ada otomatis):** salin `device-cli.tgz` dari GH Release → `/var/www/botconnector-device/device-cli-v<ver>.tgz` (0644 root) → update symlink `device-cli.tgz` → tulis `device-cli.json` (url/version/sha256 baru) → `nginx -t` + `systemctl reload nginx` (tidak wajib; file statis) → verifikasi `curl https://app.botconnector.id/device-cli.json` + `curl -I <tgz>` (200). Manifest saat ini stale? Tidak: 0.4.19 = release terbaru, `curl` publik mengembalikan JSON yang cocok dan tgz 200.

## (f) Batas stream / konkurensi per akun — VERIFIED (tidak ada)

- Relay: **tidak ada** cap device/stream/pENDING per akun maupun global; hanya 1 socket per device (koneksi baru menggantikan yang lama: "Replaced by newer connection").
- account-api: tidak ada cap stream device. Yang ada: pair-code rate limit `PAIR_MAX=6` per 10 menit per user (429 `pair_rate_limited`), dan env `MAX_CONCURRENT_REQUESTS_PER_USER=8` / `PAYG_MAX_CONCURRENT_REQUESTS_PER_USER=8` (untuk traffic cloud chat — **belum diverifikasi** apakah ikut menghitung request device;GIN: harus dicek saat canary, dan cap agen 2/akun aman di bawah 8).
- Upstream account-api → relay timeout untuk stream: **15 menit** (`relayCall(..., timeoutMs: 15*60*1000)` di `device-routes.mjs`) → **stream agen harus lebih pendek dari 15 menit per koneksi**, atau timeout harus dinaikkan (tercantum di §risiko §b). Relay service sendiri: `LOCAL_AI_REQUEST_TIMEOUT_MS=15 mnt` hanya untuk metode "slow"; `agent.stream` perlu timeout khusus (Task 2) — dan sisi account-api juga butuh penyesuaian timeout (15 mnt) agar konsisten.

## (g) Drift repo vs produksi (BARU — blocker deploy)

| File | Repo HEAD `7e37be4` | Produksi | Dampak |
|---|---|---|---|
| `web/device-relay.cjs` | identik semantik | identik | aman |
| `web/device-relay-service.cjs` | tanpa unix socket | **+ unix socket** (handler di-refactor agar bisa dipakai 2 listener; `BOTCONNECTOR_DEVICE_RELAY_SOCKET` → `socketServer.listen(socketPath)` + `chmod 0666`) | deploy versi repo = **account-api kehilangan jalan ke relay** (container hanya pakai socket) |

→ **Task 0.5 (baru): portasikan dukungan unix-socket dari artefak produksi ke repo** (perubahan kecil, 16 baris) **sebelum** task deploy apa pun, lalu deploy dari repo.

## GO / NO-GO (Task 0 exit criteria)

| Kriteria | Status | Catatan |
|---|---|---|
| (a) allowlist device di account-api teridentifikasi | **GO** | `device-routes.mjs` di image; perlu patch + rebuild image (pola `bin/deploy-*.sh` + `bin/deploy-service.sh`) |
| (b) timeout/buffering nginx dipahami | **GO** | route catch-all 60 s + buffering default → butuh location khusus (R1) |
| (c) account-api → relay timeout | **GO (perAttention)** | stream dibatasi 15 mnt di sisi account-api → stream agen > 15 mnt terputus; harus dinaikkan atau heartbeat+reconnect dari app |
| (d) cara deploy relay | **GO** | unit file diketahui (backup dir) + artefak + token + state; **tapi relay sedang mati → pulihkan dulu (Task 8a)** |
| (e) pipeline rilis Device CLI | **GO** | GH Release → copy tgz → update `device-cli.json` (origin lock) → verifikasi curl; 절차 manual terverifikasi |
| (f) sumber device-routes.mjs di host | **PARTIAL** | `production-candidate` bukan git repo; source of truth = image; patch via `docker cp` → build → deploy-service.sh (pola `bin/deploy-admin-jobs-20261003.sh` sebagai contoh) |

**Kesimpulan Task 0: GO untuk Tasks 1–7 (kode repo + runbook).** Tasks 8 (deploy) blocked sampai: (1) relay produksi dipulihkan, (2) drift unix-socket dipordi ke repo, (3) nginx location khusus dibuat, (4) account-api image di-rebuild dengan allowlist `agent.*`.

## Risiko baru yang harus masuk plan

- **R-1 (baru):** stream device di API publik terputus 60 s + buffering nginx → `location` khusus wajib (buka `botconnector-api.conf`, backup + `nginx -t` + reload).
- **R-2 (baru):** timeout 15 mnt sisi account-api untuk stream → naikkan (atau heartbeat 25 s + reconnect app, sesuai spec §8: watchdog 120 s).
- **R-3 (baru):** relay produksi mati → fitur laptop pairing mati untuk semua user; pulihkan (Task 8a) sebelum canary.
- **R-4 (baru):** deploy artefak relay harus dari repo yang sudah punya unix-socket (Task 0.5) atau account-api kehilangan akses.
- **R-5 (baru):** `MAX_CONCURRENT_REQUESTS_PER_USER=8` account-api mungkin menghitung request device → cek saat canary; cap agen 2/akun + 20 global harus implementing relay (bukan account-api) supaya satu sumber kebenaran.
