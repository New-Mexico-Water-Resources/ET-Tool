import os
import argparse
import time
import logging
from datetime import datetime
from os.path import join, dirname
from dotenv import load_dotenv
import boto3
from tqdm import tqdm
from pathlib import Path
import json

load_dotenv()

dotenv_path = Path(dirname(__file__)) / ".env.secrets"
load_dotenv(dotenv_path)

dotenv_path = Path(dirname(__file__)).parent.parent / ".env.secrets"
load_dotenv(dotenv_path)

dotenv_path = Path(dirname(__file__)).parent.parent / ".env"
load_dotenv(dotenv_path)


# Configuration via environment variables with defaults
def get_env_path(key, default):
    """Get path from environment variable or use default."""
    path = os.getenv(key, default)
    return os.path.expanduser(path)


# Base directories
BASE_DATA_DIR = get_env_path("BASE_DATA_DIR", "/root/data/modis")
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

# Application Data Bucket
S3_INPUT_BUCKET = os.getenv("S3_INPUT_BUCKET", "ose-dev-inputs")
AWS_PROFILE = os.getenv("AWS_PROFILE", None)
BUCKET_PREFIX = os.getenv("BUCKET_PREFIX", "modis/")

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

BAND_MAPPING = {
    "ET_500m": "ET",
    "PET_500m": "PET",
}

from fetch_modis import fetch_new_dates
from workflow import process_hdf_files
from merge_process import merge_and_process_tiffs


def get_client_version():
    """Get the client version from package.json."""
    try:
        with open("./package.json", "r") as f:
            package_data = json.load(f)
            return package_data.get("version")
    except Exception as e:
        logging.error(f"Error reading package.json: {e}")
        return None


def cleanup_affected_files():
    """Delete files affected by the PET/ET bug from both S3 and local storage."""

    # Need to delete these dates because they have a bug in the MODIS data (PET matches ET)
    affected_dates = ["20250314", "20250322", "20250330", "20250407", "20250415", "20250423"]

    deleted_s3_count = 0
    deleted_local_count = 0

    # Delete from S3
    if S3_INPUT_BUCKET:
        session = boto3.Session(profile_name=AWS_PROFILE)
        s3 = session.client("s3")

        for date in affected_dates:
            # Delete ET file
            et_key = f"{BUCKET_PREFIX}MOD16A2_MERGED_{date}_ET.tif"
            try:
                s3.delete_object(Bucket=S3_INPUT_BUCKET, Key=et_key)
                logging.info(f"Deleted from S3: {et_key}")
                deleted_s3_count += 1
            except Exception as e:
                logging.error(f"Error deleting from S3 {et_key}: {e}")

            # Delete PET file
            pet_key = f"{BUCKET_PREFIX}MOD16A2_MERGED_{date}_PET.tif"
            try:
                s3.delete_object(Bucket=S3_INPUT_BUCKET, Key=pet_key)
                logging.info(f"Deleted from S3: {pet_key}")
                deleted_s3_count += 1
            except Exception as e:
                logging.error(f"Error deleting from S3 {pet_key}: {e}")

    # Delete from local storage
    for date in affected_dates:
        # Delete ET file
        et_local_path = os.path.join(MERGED_DIR, f"MOD16A2_MERGED_{date}_ET.tif")
        try:
            if os.path.exists(et_local_path):
                os.remove(et_local_path)
                logging.info(f"Deleted local file: {et_local_path}")
                deleted_local_count += 1
        except Exception as e:
            logging.error(f"Error deleting local file {et_local_path}: {e}")

        # Delete PET file
        pet_local_path = os.path.join(MERGED_DIR, f"MOD16A2_MERGED_{date}_PET.tif")
        try:
            if os.path.exists(pet_local_path):
                os.remove(pet_local_path)
                logging.info(f"Deleted local file: {pet_local_path}")
                deleted_local_count += 1
        except Exception as e:
            logging.error(f"Error deleting local file {pet_local_path}: {e}")

    logging.info(f"Deleted {deleted_s3_count} files from S3")
    logging.info(f"Deleted {deleted_local_count} files from local directory")


def upload_to_s3():
    """
    Sync the processed TIFF files to the S3 input bucket.
    """
    session = boto3.Session(profile_name=AWS_PROFILE)
    s3 = session.client("s3")

    # Get all files in the output directory
    files = [file for file in os.listdir(MERGED_DIR) if file.endswith(".tif")]
    pbar = tqdm(files, desc="Uploading to S3", total=len(files), leave=False)
    for file in pbar:
        # Only upload files that are not already in the S3 bucket
        key = f"{BUCKET_PREFIX}{file}"

        try:
            exists = s3.head_object(Bucket=S3_INPUT_BUCKET, Key=key)
        except Exception as e:
            exists = False

        if not exists:
            pbar.set_postfix(file=file)
            try:
                s3.upload_file(os.path.join(MERGED_DIR, file), S3_INPUT_BUCKET, key)
                logging.info(f"Uploaded {file} to s3://{S3_INPUT_BUCKET}/{key}")
            except Exception as e:
                logging.error(f"Error uploading {file} to S3: {e}")
        else:
            pbar.set_postfix(file=file, exists="True (skipping)")


def start_workflow(
    limit=None,
    generate_tiles=False,
    min_zoom=1,
    max_zoom=11,
    bands=["ET_500m", "PET_500m"],
    monitor=False,
    interval=24 * 60 * 60,
):
    """
    Start the MODIS processing workflow.
    """
    # Remove duplicates from bands and set default bands if none provided
    bands = list(set(bands)) if bands else ["ET_500m", "PET_500m"]

    while True:
        logging.info(f"Starting MODIS processing workflow ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})...")
        if AWS_PROFILE:
            logging.info(f"AWS profile: {AWS_PROFILE}")
        logging.info(f"Bands: {bands}")
        logging.info("\nUsing the following directories:")
        logging.info(f"Base data directory: {BASE_DATA_DIR}")
        logging.info(f"Download directory: {DOWNLOAD_FOLDER}")
        logging.info(f"Input directory: {INPUT_DIR}")
        logging.info(f"Output directory: {OUTPUT_DIR}")
        logging.info(f"Merged directory: {MERGED_DIR}")
        logging.info(f"Temp directory: {TEMP_DIR}")
        logging.info("\nData product configuration:")
        logging.info(f"Base data product: {BASE_DATA_PRODUCT}")
        logging.info(f"Data product version: {DATA_PRODUCT_VERSION}")
        logging.info(f"S3 endpoint: {S3_ENDPOINT}")
        logging.info(f"S3 bucket: {S3_BUCKET}")
        logging.info(f"Generate tiles: {generate_tiles}\n")

        # Clean up affected files from previous versions before starting the workflow
        version = get_client_version()
        if version == "1.26.0" or version == "1.25.0":
            logging.info("Cleaning up affected files...")
            cleanup_affected_files()

        logging.info("\nChecking for new MODIS data...")
        fetch_new_dates(limit=limit)

        logging.info("\nProcessing HDF files...")
        process_hdf_files(bands=bands)

        logging.info("\nMerging and processing TIFFs...")
        for band_name in bands:
            output_band_name = BAND_MAPPING.get(band_name, "")
            merge_and_process_tiffs(
                generate_tiles=generate_tiles,
                min_zoom=min_zoom,
                max_zoom=max_zoom,
                band_name=band_name,
                output_band_name=output_band_name,
            )

        if S3_INPUT_BUCKET:
            logging.info("\nUploading to S3...")
            upload_to_s3()

        logging.info("\nMODIS processing workflow completed!")

        if not monitor:
            break

        time.sleep(interval)


def main():
    """
    MODIS processing workflow. Fetches new data from NASA Earthdata Cloud, converts the HDF files into TIFFs for each date and the respective band,
    and then merges the TIFFs into a single TIFF for each date and band and outputs the results to the MODIS_OUTPUT_DIR.

    Args:
        generate_tiles (bool): Whether to generate PNG tiles for web visualization.
        limit (int): Limit the number of dates to process.
        min_zoom (int): Minimum zoom level if generating tiles (1-11).
        max_zoom (int): Maximum zoom level if generating tiles (1-11).
        band_name (str): Band name.
    """
    parser = argparse.ArgumentParser(description="Process MODIS data")
    parser.add_argument(
        "--generate-tiles", action="store_true", help="Generate PNG tiles for web visualization", default=False
    )
    parser.add_argument("--limit", type=int, help="Limit the number of dates to process", default=None)
    parser.add_argument("--min-zoom", type=int, help="Minimum zoom level", default=1)
    parser.add_argument("--max-zoom", type=int, help="Maximum zoom level", default=11)
    parser.add_argument("-b", "--bands", action="append", help="List of band names", default=[])

    # Monitoring
    parser.add_argument("--monitor", action="store_true", help="Monitor the process", default=False)
    parser.add_argument(
        "--monitor-interval", type=int, help="Monitor interval in seconds (default: 24 hours)", default=24 * 60 * 60
    )

    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

    start_workflow(
        limit=args.limit,
        generate_tiles=args.generate_tiles,
        min_zoom=args.min_zoom,
        max_zoom=args.max_zoom,
        bands=args.bands,
        monitor=args.monitor,
        interval=args.monitor_interval,
    )


if __name__ == "__main__":
    main()
