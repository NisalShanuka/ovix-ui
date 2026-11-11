#!/usr/bin/env python3
"""Rebrand the upstream 3x-ui tree as Ovix UI.

Idempotent: run after every upstream merge. Dry-run by default; pass --apply to write.
Usage: python ovix/rebrand.py [--apply] [--verbose]
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = "ovix.store/ovix-ui"

# Paths removed from the fork entirely (upstream-only material).
DELETE_DIRS = [".github", "media", "deploy/marketplace", ".oss-scanner"]
DELETE_GLOBS = ["README.*.md"]
# Tests that only check the deleted .github bot workflows.
DELETE_FILES = {"bot_context_test.go"}
# docs/ is the upstream Fumadocs site; only the architecture map is kept.
DOCS_KEEP = {"docs/architecture.md"}

# Files never rewritten.
SKIP_FILES = {"LICENSE", "go.sum", "ovix/rebrand.py", "README.md"}

# Tokens that must survive untouched: upstream links/issue refs and the
# User-Agents remote 3x-ui servers recognise.
PROTECT = [
    "MHSanaei/3x-ui",
    "upstream 3x-ui",
    "plain 3x-ui",
    "3x-ui-outbound-sub/1.0",
    "3x-ui-pia/1.0",
    "3x-ui-remote-routing/1.0",
]

# Ordered: earlier rules consume text before later, broader ones see it.
RULES = [
    ("module path", re.compile(r"github\.com/mhsanaei/3x-ui(?:/v3)?"), MODULE),
    ("3X-UI brand", re.compile(r"3X-UI"), "Ovix UI"),
    ("3x-ui slug", re.compile(r"3x-ui"), "ovix-ui"),
    ("X-UI brand", re.compile(r"(?<![A-Za-z0-9])X-UI"), "OVIX-UI"),
    ("x-ui slug", re.compile(r"(?<![A-Za-z0-9])x-ui"), "ovix-ui"),
    ("XUI_ env", re.compile(r"(?<![A-Za-z0-9])XUI_"), "OVIX_"),
]

RENAMES = {
    "x-ui.sh": "ovix-ui.sh",
    "x-ui.rc": "ovix-ui.rc",
    "x-ui.service.arch": "ovix-ui.service.arch",
    "x-ui.service.debian": "ovix-ui.service.debian",
    "x-ui.service.rhel": "ovix-ui.service.rhel",
}


def git_files():
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


def is_deleted(path):
    if path in DELETE_FILES:
        return True
    if path.startswith("docs/") and path not in DOCS_KEEP:
        return True
    if any(path == d or path.startswith(d + "/") for d in DELETE_DIRS):
        return True
    return any(Path(path).match(g) and "/" not in path for g in DELETE_GLOBS)


def renamed(path):
    p = Path(path)
    if p.name in RENAMES:
        return str(p.with_name(RENAMES[p.name])).replace("\\", "/")
    if "3x-ui" in p.name:
        return str(p.with_name(p.name.replace("3x-ui", "ovix-ui"))).replace("\\", "/")
    return path


def rewrite(text):
    keep = {}
    for i, tok in enumerate(PROTECT):
        ph = f"\x00P{i}\x00"
        keep[ph] = tok
        text = text.replace(tok, ph)
    counts = {}
    for name, rx, repl in RULES:
        text, n = rx.subn(repl, text)
        if n:
            counts[name] = n
    for ph, tok in keep.items():
        text = text.replace(ph, tok)
    return text, counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    files = git_files()
    deletes = [f for f in files if is_deleted(f)]
    live = [f for f in files if f not in set(deletes)]
    totals, changed, renames, unreadable = {}, [], [], []

    for f in live:
        if f in SKIP_FILES:
            continue
        path = ROOT / f
        try:
            raw = path.read_bytes()
        except OSError as e:
            unreadable.append((f, e.strerror or str(e)))
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = None
        if text is not None:
            new, counts = rewrite(text)
            if counts:
                changed.append((f, counts))
                for k, v in counts.items():
                    totals[k] = totals.get(k, 0) + v
                if a.apply:
                    path.write_bytes(new.encode("utf-8"))
        nf = renamed(f)
        if nf != f:
            renames.append((f, nf))

    print(f"files tracked: {len(files)}  to delete: {len(deletes)}  to rewrite: {len(changed)}  to rename: {len(renames)}")
    for k, v in totals.items():
        print(f"  {k:12} {v:6} replacements")
    for f, t in renames:
        print(f"  rename {f} -> {t}")
    for f, why in unreadable:
        print(f"  SKIPPED unreadable {f}: {why} (rebrand it on Linux)")
    if a.verbose:
        for f, c in changed:
            print("  edit", f, c)

    if not a.apply:
        print("dry run: nothing written (use --apply)")
        return 0

    if deletes:
        for i in range(0, len(deletes), 200):
            subprocess.run(["git", "rm", "-q", "-r", "--"] + deletes[i:i + 200], cwd=ROOT, check=True)
    for f, t in renames:
        subprocess.run(["git", "mv", f, t], cwd=ROOT, check=True)
    print("applied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
