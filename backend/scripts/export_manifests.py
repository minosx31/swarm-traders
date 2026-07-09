"""Snapshot manifest export CLI — thin wrapper over alpha_swarms.manifest.

Usage:  uv run scripts/export_manifests.py

Writes data/manifests/{TICKER}_{AS_OF}.json for every whitelisted snapshot, for
the static (no-backend) demo — the frontend bundler copies from there instead
of hitting GET /snapshot.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from alpha_swarms.manifest import build_manifest  # noqa: E402
from alpha_swarms.snapshot import list_whitelisted, load_snapshot  # noqa: E402


def main() -> int:
    out_dir = Path(__file__).parent.parent / "data" / "manifests"
    out_dir.mkdir(parents=True, exist_ok=True)

    for pair in list_whitelisted():
        snapshot = load_snapshot(pair["ticker"], pair["as_of"])
        manifest = build_manifest(snapshot)
        path = out_dir / f"{pair['ticker']}_{pair['as_of']}.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"manifest  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
