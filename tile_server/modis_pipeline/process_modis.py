import os
import argparse


# Configuration via environment variables with defaults
def get_env_path(key, default):
    """Get path from environment variable or use default."""
    path = os.getenv(key, default)
    return os.path.expanduser(path)


# Base directories
BASE_DATA_DIR = get_env_path("MODIS_BASE_DIR", "/root/data/modis_net_et_8_day")
DOWNLOAD_FOLDER = get_env_path("MODIS_DOWNLOAD_DIR", os.path.join(BASE_DATA_DIR, "downloads"))
INPUT_DIR = get_env_path("MODIS_INPUT_DIR", os.path.join(BASE_DATA_DIR, "et_tiffs"))
OUTPUT_DIR = get_env_path("MODIS_OUTPUT_DIR", os.path.join(BASE_DATA_DIR, "et_tiles"))
MERGED_DIR = get_env_path("MODIS_MERGED_DIR", os.path.join(BASE_DATA_DIR, "raw_et"))
TEMP_DIR = get_env_path("MODIS_TEMP_DIR", os.path.join(BASE_DATA_DIR, "temp"))

# Data Product Configuration
BASE_DATA_PRODUCT = os.getenv("MODIS_BASE_DATA_PRODUCT", "MOD16A2")
DATA_PRODUCT_VERSION = os.getenv("MODIS_DATA_PRODUCT_VERSION", "061")
S3_ENDPOINT = os.getenv("MODIS_S3_ENDPOINT", "https://data.lpdaac.earthdatacloud.nasa.gov/s3credentials")
S3_BUCKET = os.getenv("MODIS_S3_BUCKET", "lp-prod-protected")

# Set environment variables for other scripts
os.environ["MODIS_DOWNLOAD_DIR"] = DOWNLOAD_FOLDER
os.environ["MODIS_INPUT_DIR"] = INPUT_DIR
os.environ["MODIS_OUTPUT_DIR"] = OUTPUT_DIR
os.environ["MODIS_MERGED_DIR"] = MERGED_DIR
os.environ["MODIS_TEMP_DIR"] = TEMP_DIR
os.environ["MODIS_BASE_DATA_PRODUCT"] = BASE_DATA_PRODUCT
os.environ["MODIS_DATA_PRODUCT_VERSION"] = DATA_PRODUCT_VERSION
os.environ["MODIS_S3_ENDPOINT"] = S3_ENDPOINT
os.environ["MODIS_S3_BUCKET"] = S3_BUCKET

from fetch_modis import fetch_new_dates
from workflow import process_hdf_files
from merge_process import merge_and_process_tiffs


def main():
    """Main workflow function."""
    parser = argparse.ArgumentParser(description="Process MODIS data")
    parser.add_argument(
        "--generate-tiles", action="store_true", help="Generate PNG tiles for web visualization", default=False
    )
    parser.add_argument("--limit", type=int, help="Limit the number of dates to process", default=None)
    parser.add_argument("--min-zoom", type=int, help="Minimum zoom level", default=1)
    parser.add_argument("--max-zoom", type=int, help="Maximum zoom level", default=11)
    parser.add_argument("--band-name", type=str, help="Band name", default="ET_500m")
    args = parser.parse_args()

    print("Starting MODIS processing workflow...")
    print("\nUsing the following directories:")
    print(f"Base data directory: {BASE_DATA_DIR}")
    print(f"Download directory: {DOWNLOAD_FOLDER}")
    print(f"Input directory: {INPUT_DIR}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Merged directory: {MERGED_DIR}")
    print(f"Temp directory: {TEMP_DIR}")
    print("\nData product configuration:")
    print(f"Base data product: {BASE_DATA_PRODUCT}")
    print(f"Data product version: {DATA_PRODUCT_VERSION}")
    print(f"S3 endpoint: {S3_ENDPOINT}")
    print(f"S3 bucket: {S3_BUCKET}")
    print(f"Generate tiles: {args.generate_tiles}\n")

    # Step 1: Fetch new data
    print("\nStep 1: Checking for new MODIS data...")
    fetch_new_dates(limit=args.limit)

    # Step 2: Process HDF files
    print("\nStep 2: Processing HDF files...")
    process_hdf_files(band_name=args.band_name)

    # Step 3: Merge and process TIFFs
    print("\nStep 3: Merging and processing TIFFs...")
    merge_and_process_tiffs(generate_tiles=args.generate_tiles, min_zoom=args.min_zoom, max_zoom=args.max_zoom)

    print("\nMODIS processing workflow completed!")


if __name__ == "__main__":
    main()
