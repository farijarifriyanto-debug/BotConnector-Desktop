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
])

replace("static/opensearch.xml", [
    ("<ShortName>Open WebUI</ShortName>", "<ShortName>BotConnector Local</ShortName>"),
    ("<Description>Search Open WebUI</Description>", "<Description>Search BotConnector Local</Description>"),
])

pkg = root / "package.json"
data = json.loads(pkg.read_text(encoding="utf-8"))
data["name"] = "botconnector-local-ui"
pkg.write_text(json.dumps(data, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")

brand_meta = root / "BOTCONNECTOR_BRANDING.json"
brand_meta.write_text(json.dumps({
    "name": "BotConnector Local",
    "upstream": "Open WebUI v0.6.5",
    "license": "BSD-3-Clause",
    "note": "Original BSD-3-Clause notice must remain with redistributed builds."
}, indent=2) + "\n", encoding="utf-8")

print("Applied BotConnector Local text branding to Open WebUI v0.6.5 source.")
