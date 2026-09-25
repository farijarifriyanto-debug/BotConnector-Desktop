#!/usr/bin/env python3
from pathlib import Path
import json

root = Path("upstream/open-webui")

def replace(path, pairs):
    p = root / path
    text = p.read_text(encoding="utf-8")
    original = text
    for old, new in pairs:
        text = text.replace(old, new)
    if text == original:
        raise SystemExit(f"expected branding token not found in {path}")
    p.write_text(text, encoding="utf-8")

replace("src/lib/constants.ts", [
    ("export const APP_NAME = 'Open WebUI';", "export const APP_NAME = 'BotConnector Local';"),
])

replace("src/app.html", [
    ('content="Open WebUI"', 'content="BotConnector Local"'),
    ('title="Open WebUI"', 'title="BotConnector Local"'),
    ("<title>Open WebUI</title>", "<title>BotConnector Local</title>"),
    ('href="/static/favicon.png"', 'href="/static/botconnector-mark.svg"'),
    ('href="/static/favicon-96x96.png"', 'href="/static/botconnector-mark.svg"'),
    ('href="/static/favicon.svg"', 'href="/static/botconnector-mark.svg"'),
    ('href="/static/favicon.ico"', 'href="/static/botconnector-mark.svg"'),
    ('href="/static/apple-touch-icon.png"', 'href="/static/botconnector-mark.svg"'),
    ("'/static/splash-dark.png'", "'/static/botconnector-mark.svg'"),
    ("'/static/splash.png'", "'/static/botconnector-mark.svg'"),
    ('src="/static/splash.png"', 'src="/static/botconnector-mark.svg"'),
])

replace("static/opensearch.xml", [
    ("<ShortName>Open WebUI</ShortName>", "<ShortName>BotConnector Local</ShortName>"),
    ("<Description>Search Open WebUI</Description>", "<Description>Search BotConnector Local</Description>"),
    ("http://localhost:5137/favicon.png", "http://localhost:5137/static/botconnector-mark.svg"),
])

# Disable upstream first-run changelog and update notices in BotConnector Local.
layout = root / "src" / "routes" / "(app)" / "+layout.svelte"
layout_text = layout.read_text(encoding="utf-8")
layout_text = layout_text.replace(
    """			if ($user?.role === 'admin' && ($settings?.showChangelog ?? true)) {
				showChangelog.set($settings?.version !== $config.version);
			}""",
    """			showChangelog.set(false);"""
)
layout_text = layout_text.replace(
    """			// Check for version updates
			if ($user?.role === 'admin') {
				// Check if the user has dismissed the update toast in the last 24 hours
				if (localStorage.dismissedUpdateToast) {
					const dismissedUpdateToast = new Date(Number(localStorage.dismissedUpdateToast));
					const now = new Date();

					if (now - dismissedUpdateToast > 24 * 60 * 60 * 1000) {
						checkForVersionUpdates();
					}
				} else {
					checkForVersionUpdates();
				}
			}""",
    """			// BotConnector Local is release-managed by BotConnector, not Open WebUI.
			showChangelog.set(false);"""
)
layout_text = layout_text.replace("<ChangelogModal bind:show={$showChangelog} />", "")
start = layout_text.find("{#if version && compareVersion(version.latest, version.current)")
if start >= 0:
    end = layout_text.find("{/if}", start)
    if end >= 0:
        layout_text = layout_text[:start] + layout_text[end + len("{/if}"):]
layout.write_text(layout_text, encoding="utf-8")

# Keep the visual identity consistent with botconnector.id: the mark is ◇.
mark = root / "static" / "botconnector-mark.svg"
mark.write_text("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="BotConnector">
  <rect width="64" height="64" rx="14" fill="#171717"/>
  <path d="M32 11 53 32 32 53 11 32 32 11Z" fill="none" stroke="#f5f5f5" stroke-width="5" stroke-linejoin="round"/>
</svg>
""", encoding="utf-8")

# Replace upstream favicon/splash references throughout the v0.6.5 frontend.
for p in (root / "src").rglob("*"):
    if not p.is_file() or p.suffix not in {".svelte", ".ts", ".js", ".html"}:
        continue
    text = p.read_text(encoding="utf-8")
    updated = (
        text.replace("/static/favicon.png", "/static/botconnector-mark.svg")
            .replace("/static/splash.png", "/static/botconnector-mark.svg")
            .replace("/static/splash-dark.png", "/static/botconnector-mark.svg")
    )
    if updated != text:
        p.write_text(updated, encoding="utf-8")

pkg = root / "package.json"
data = json.loads(pkg.read_text(encoding="utf-8"))
data["name"] = "botconnector-local-ui"
pkg.write_text(json.dumps(data, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")

brand_meta = root / "BOTCONNECTOR_BRANDING.json"
brand_meta.write_text(json.dumps({
    "name": "BotConnector Local",
    "mark": "◇",
    "brand_reference": "https://botconnector.id",
    "upstream": "Open WebUI v0.6.5",
    "license": "BSD-3-Clause",
    "note": "Original BSD-3-Clause notice must remain with redistributed builds."
}, indent=2) + "\n", encoding="utf-8")

print("Applied BotConnector Local branding and ◇ mark to Open WebUI v0.6.5 source.")
