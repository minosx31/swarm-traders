"""Static-demo data export CLI — thin wrapper over alpha_swarms.

Usage:  uv run scripts/export_manifests.py

Writes, for the static (no-backend) demo, which the frontend bundler copies from
instead of hitting the backend:
  - data/manifests/{TICKER}_{AS_OF}.json for every whitelisted snapshot (the
    offline stand-in for GET /snapshot).
  - data/models.json, the paid model catalog (offline stand-in for GET /models)
    so the replay picker shows the same labels/optgroups as the live picker.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from alpha_swarms.llm import catalog  # noqa: E402
from alpha_swarms.manifest import build_manifest  # noqa: E402
from alpha_swarms.snapshot import list_whitelisted, load_snapshot  # noqa: E402


def main() -> int:
    data_dir = Path(__file__).parent.parent / "data"
    out_dir = data_dir / "manifests"
    out_dir.mkdir(parents=True, exist_ok=True)

    for pair in list_whitelisted():
        snapshot = load_snapshot(pair["ticker"], pair["as_of"])
        manifest = build_manifest(snapshot)
        path = out_dir / f"{pair['ticker']}_{pair['as_of']}.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"manifest  {path}")

    models_path = data_dir / "models.json"
    models_path.write_text(json.dumps(catalog(), indent=2))
    print(f"catalog   {models_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
