#!/usr/bin/env python3
"""Check that every engine crate is ready to be published to its registry.

Three distribution channels share one version:

    npm     @fazelstudio/grafalith   <- crates/grafalith (wasm-pack cdylib)
    PyPI    grafalith                <- crates/grafalith-python (maturin)
    crates.io grafalith-*            <- the engine crates (rlib libraries)

This script is the pre-publish gate for the crates.io channel. It verifies:

1. Every crates.io publishable crate carries the metadata a registry page
   needs (license, description, repository, homepage, keywords, categories).
2. Every non-publishable crate (wasm cdylib, PyO3 module, desktop host,
   example) is marked `publish = false`, so a stray `cargo publish -p <name>`
   cannot claim a registry name with a crate nobody can depend on.
3. `cargo package --list` succeeds for each publishable crate, which proves
   the manifest parses and the packaged file set is clean (no fuzz harness,
   no build output, no stale artifacts).
4. The internal dependency graph is acyclic and in topological order, so the
   documented publish order (geometry -> core -> io/pptx/bindings/sdk/text) works.

Run with `python scripts/verify_crate_publish.py`.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CRATES_DIR = ROOT / "crates"

# Crates that ship to crates.io, in publish order. Each must have its internal
# dependencies already published, which is exactly this order.
PUBLISHABLE = [
    "grafalith-geometry",
    "grafalith-core",
    "grafalith-io",
    "grafalith-pptx",
    "grafalith-bindings",
    "grafalith-sdk",
    "grafalith-text",
]

# Crates that must never be published to crates.io: crate name -> (reason,
# manifest directory). The crate name and directory differ for the PyO3
# module (`grafalith-py` lives in crates/grafalith-python).
GUARDED: dict[str, tuple[str, Path]] = {
    "grafalith": ("wasm-pack cdylib (npm artifact, no rlib)", CRATES_DIR / "grafalith"),
    "grafalith-py": ("PyO3 extension module (PyPI artifact)", CRATES_DIR / "grafalith-python"),
    "grafalith-desktop": ("Tauri application host", ROOT / "apps" / "desktop" / "src-tauri"),
    "ext-sticker": ("out-of-workspace teaching example", ROOT / "examples" / "ext-sticker"),
}

REQUIRED_METADATA = [
    "license",
    "description",
    "repository",
    "homepage",
    "keywords",
    "categories",
]

MAX_KEYWORDS = 5

# crates.io category slugs, fetched from https://crates.io/api/v1/categories.
# Kept in sync manually: an unknown slug is a hard publish error.
VALID_CATEGORIES = {
    "api-bindings",
    "data-structures",
    "encoding",
    "graphics",
    "mathematics",
    "multimedia",
    "multimedia::images",
    "text-processing",
    "visualization",
    "wasm",
}


def cargo_metadata() -> dict[str, dict]:
    """Return {crate_name: manifest} for the workspace plus excluded crates."""
    result = subprocess.run(
        ["cargo", "metadata", "--no-deps", "--format-version", "1"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    import json

    packages = json.loads(result.stdout)["packages"]
    return {pkg["name"]: pkg for pkg in packages}


def read_manifest(crate_dir: Path) -> dict:
    with (crate_dir / "Cargo.toml").open("rb") as handle:
        return tomllib.load(handle)


def check_publishable(manifest: dict, name: str) -> list[str]:
    problems: list[str] = []
    package = manifest.get("package", {})

    if package.get("publish") is False:
        problems.append(f"{name}: is in the publishable set but also marks publish = false")
    for field in REQUIRED_METADATA:
        if not package.get(field):
            problems.append(f"{name}: missing required registry metadata '{field}'")

    keywords = package.get("keywords", [])
    if len(keywords) > MAX_KEYWORDS:
        problems.append(f"{name}: crates.io allows at most {MAX_KEYWORDS} keywords")
    lowered = [keyword.lower() for keyword in keywords]
    if len(set(lowered)) != len(lowered):
        problems.append(f"{name}: keywords must be unique (case-insensitive)")

    for category in package.get("categories", []):
        if category not in VALID_CATEGORIES:
            problems.append(f"{name}: unknown crates.io category slug '{category}'")

    return problems


def check_guarded(manifest: dict, name: str, reason: str) -> list[str]:
    if manifest.get("package", {}).get("publish") is not False:
        return [f"{name}: must set publish = false ({reason})"]
    return []


def check_package_list(name: str) -> list[str]:
    result = subprocess.run(
        ["cargo", "package", "--list", "-p", name, "--allow-dirty"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return [f"{name}: cargo package --list failed:\n{result.stderr.strip()}"]

    # A packaged crate must not ship build or fuzz harness directories.
    listed = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    junk = [entry for entry in listed if entry.startswith(("fuzz/", "target/", "pkg/", "dist/"))]
    if junk:
        return [f"{name}: package would ship build artifacts: {', '.join(junk)}"]
    return []


def check_dependency_order(metadata: dict[str, dict]) -> list[str]:
    """Only index-based path deps are validated; registry deps are out of scope."""
    problems: list[str] = []
    position = {name: index for index, name in enumerate(PUBLISHABLE)}
    for name in PUBLISHABLE:
        for dep in metadata[name].get("dependencies", []):
            dep_name = dep["name"]
            if dep_name not in position:
                continue
            if position[dep_name] >= position[name]:
                problems.append(
                    f"{name}: depends on {dep_name}, which is published later; "
                    "reorder PUBLISHABLE so dependencies come first"
                )
    return problems


def main() -> int:
    failures: list[str] = []

    metadata = cargo_metadata()

    for name in PUBLISHABLE:
        crate_dir = CRATES_DIR / name
        if not (crate_dir / "Cargo.toml").is_file():
            failures.append(f"{name}: {crate_dir} has no Cargo.toml")
            continue
        manifest = read_manifest(crate_dir)
        failures.extend(check_publishable(manifest, name))
        failures.extend(check_package_list(name))

    for name, (reason, crate_dir) in GUARDED.items():
        if not (crate_dir / "Cargo.toml").is_file():
            failures.append(f"{name}: {crate_dir} has no Cargo.toml")
            continue
        failures.extend(check_guarded(read_manifest(crate_dir), name, reason))

    failures.extend(check_dependency_order(metadata))

    if failures:
        print("crate publish verification FAILED")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(
        f"crate publish verification passed "
        f"({len(PUBLISHABLE)} publishable, {len(GUARDED)} guarded)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
