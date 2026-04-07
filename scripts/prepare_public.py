from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA_DIR = ROOT / "public" / "data"


def main() -> int:
    if PUBLIC_DATA_DIR.exists():
        shutil.rmtree(PUBLIC_DATA_DIR)
        print(f"Removed public seed directory: {PUBLIC_DATA_DIR}")
    else:
        print("No public seed directory to remove.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
