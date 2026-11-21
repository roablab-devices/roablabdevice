"""Package the ROAB LAB source without unrelated workspaces or credentials."""
from pathlib import Path
import hashlib
from html.parser import HTMLParser
import json
from urllib.parse import unquote, urlsplit
import zipfile

root = Path(__file__).resolve().parents[1]
files = ["index.html", "Code.gs", "README.md", "scripts/package-release.py",
         "tests/backend-security.cjs", "tests/frontend-live.cjs", "tests/inventory-harness.cjs",
         "tests/inventory-booking.cjs", "tests/frontend-resources.cjs", "tests/frontend-template.cjs"]

class LocalAssets(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key not in {"src", "href"} or not value:
                continue
            url = urlsplit(value)
            if url.scheme or url.netloc or not url.path:
                continue
            asset = (root / unquote(url.path)).resolve()
            if not asset.is_relative_to(root) or not asset.is_file():
                raise ValueError(f"Missing or external local asset: {value}")
            name = asset.relative_to(root).as_posix()
            if name not in files:
                files.append(name)

LocalAssets().feed((root / "index.html").read_text(encoding="utf-8"))
target = root / "dist" / "roab-lab-inventory-v2.zip"
target.parent.mkdir(exist_ok=True)
manifest = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files}
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
    archive.writestr("SHA256SUMS.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(files) | {"SHA256SUMS.json"}
    for name, digest in manifest.items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest
print(f"Verified {len(files)} files: {target}")
print("ZIP SHA-256: " + hashlib.sha256(target.read_bytes()).hexdigest())
