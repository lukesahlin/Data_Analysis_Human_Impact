"""
Download College Scorecard (most recent institution-level) dataset.
Skips download if the data file already exists.
"""
import os
import sys
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

# Most Recent Cohorts - Institution (24 MB). Multiple variables + outcomes.
DATA_DIR = Path(__file__).resolve().parent / "data"
ZIP_URL = "https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Institution_10032025.zip"
ZIP_NAME = "Most-Recent-Cohorts-Institution_10032025.zip"
ZIP_PATH = DATA_DIR / ZIP_NAME


def main():
    force = "--force" in sys.argv or "-f" in sys.argv

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if ZIP_PATH.exists() and not force:
        print(f"Data already present: {ZIP_PATH}")
        print("Run with --force to re-download.")
        return 0

    print(f"Downloading to {ZIP_PATH} ...")
    try:
        urlretrieve(ZIP_URL, ZIP_PATH)
    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        return 1

    print("Extracting...")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        zf.extractall(DATA_DIR)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
