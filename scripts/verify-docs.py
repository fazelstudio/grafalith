#!/usr/bin/env python3
"""Verify public docs stay consistent (run: `bun run verify:docs`).

Checks:
1. No references to deleted paths in tracked files.
2. `docs/modules/` (working notes) stays untracked.
3. Every guide in `docs/guides/` is linked from `docs/README.md`.
4. Every relative `.md` link resolves to an existing file.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Deleted locations that must never be referenced again.
STALE_PATTERNS = (
    "docs/adr/",
    "docs/architecture/",
    "docs/engine/",
    "docs/phases/",
    "apps/desktop/docs/",
    "00-audit",
    "05-command-reference",
)

LINK_RE = re.compile(r"\]\(([^)\"'#]+(?:\.md)[^)\"']*)\)")


def tracked_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return [ROOT / line for line in out.stdout.splitlines() if line.strip()]


def check_stale_references(files: list[Path]) -> list[str]:
    errors: list[str] = []
    for path in files:
        if path.resolve() == Path(__file__).resolve():
            continue
        if path.suffix not in {".md", ".py", ".ts", ".tsx", ".rs", ".toml", ".json", ".yml"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for pattern in STALE_PATTERNS:
            if pattern in text:
                errors.append(f"{path.relative_to(ROOT)}: stale reference to `{pattern}`")
    return errors


def check_modules_untracked() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "docs/modules"], cwd=ROOT, capture_output=True, text=True, check=True
    )
    if out.stdout.strip():
        return ["docs/modules/ has tracked files (working notes must stay untracked)"]
    return []


def check_guides_indexed() -> list[str]:
    index = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")
    errors = []
    for guide in sorted((ROOT / "docs" / "guides").glob("*.md")):
        if guide.name not in index:
            errors.append(f"docs/guides/{guide.name} is not linked from docs/README.md")
    return errors


def check_md_links(files: list[Path]) -> list[str]:
    errors: list[str] = []
    for path in files:
        if path.suffix != ".md":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for match in LINK_RE.finditer(text):
            target = match.group(1).split("#")[0]
            if not target or target.startswith(("http://", "https://", "mailto:", "/")):
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.is_file():
                errors.append(f"{path.relative_to(ROOT)}: broken link to `{target}`")
    return errors


def main() -> int:
    files = tracked_files()
    errors = [
        *check_stale_references(files),
        *check_modules_untracked(),
        *check_guides_indexed(),
        *check_md_links(files),
    ]
    if errors:
        print("docs verification failed:")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"docs verification passed ({len(files)} tracked files checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
