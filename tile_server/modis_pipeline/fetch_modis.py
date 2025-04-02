import os
import requests
from bs4 import BeautifulSoup
import tqdm
from fetch_modis_earthdata import download_tile_from_s3

# Configuration
BASE_DATA_PRODUCT = os.getenv("MODIS_BASE_DATA_PRODUCT", "MOD16A2")  # MOD16A2GF for gap-filled data
DATA_PRODUCT_VERSION = os.getenv("MODIS_DATA_PRODUCT_VERSION", "061")
MODIS_BASE_URL = f"https://e4ftl01.cr.usgs.gov/MOLT/{BASE_DATA_PRODUCT}.{DATA_PRODUCT_VERSION}/"


def get_env_path(key, default):
    """Get path from environment variable or use default."""
    path = os.getenv(key, default)
    return os.path.expanduser(path)


# Get paths from environment variables
DOWNLOAD_FOLDER = get_env_path("MODIS_DOWNLOAD_DIR", "~/data/modis_net_et_8_day/downloads")
EXISTING_MERGED_FOLDER = get_env_path("MODIS_MERGED_DIR", "~/data/modis_net_et_8_day/raw_et")


def get_available_dates(url=MODIS_BASE_URL):
    response = requests.get(url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    dates = []

    for a in soup.find_all("a"):
        href = a.get("href")
        if href and href.endswith("/"):
            potential_date = href.strip("/")
            formatted_date = potential_date.replace(".", "")
            if formatted_date.isdigit():
                dates.append(potential_date)

    return dates


# *** We're rate limited by HTTP requests, better to use S3
# def get_files_for_date(date, base_url=MODIS_BASE_URL):
#     url = f"{base_url}{date}/"
#     response = requests.get(url)
#     response.raise_for_status()

#     soup = BeautifulSoup(response.text, "html.parser")
#     files = []

#     for a in soup.find_all("a"):
#         href = a.get("href")
#         if href and not href.endswith("/"):
#             files.append(href)
#     return files


# def download_hdf_file(date, tile):
#     # files = get_files_for_date(date)
#     # matching_files = [f for f in files if f".{tile}." in f and f.endswith(".hdf")]

#     # if not matching_files:
#     #     print(f"No matching files found for tile {tile} on {date}.")
#     #     return None

#     os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
#     return download_tile_from_s3(date, tile, dest_folder=DOWNLOAD_FOLDER)


def format_date(date_str):
    """Converts a date string from YYYYMMDD to YYYY.MM.DD."""
    return f"{date_str[:4]}.{date_str[4:6]}.{date_str[6:]}"


def fetch_new_dates(limit=None):
    available_dates = get_available_dates()

    existing_files = os.listdir(EXISTING_MERGED_FOLDER)
    existing_dates = [format_date(f.split("_")[2]) for f in existing_files if f.endswith(".tif")]

    new_dates = [d for d in available_dates if d not in existing_dates]

    os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
    if len(new_dates) > 0:
        tiles = ["h08v05", "h09v05"]
        dates_to_process = new_dates[:limit] if limit else new_dates
        pbar = tqdm.tqdm(
            dates_to_process, desc="Downloading MODIS files", leave=False, total=len(dates_to_process) * len(tiles)
        )
        for date in pbar:
            # files = get_files_for_date(date)
            for tile in tqdm.tqdm(tiles, desc=f"Processing {date}", leave=False):
                pbar.set_description(f"Processing {date}, {tile}")
                downloaded_file = download_tile_from_s3(date, tile, dest_folder=DOWNLOAD_FOLDER)

                if downloaded_file:
                    pbar.set_postfix({"Downloaded": len(os.listdir(DOWNLOAD_FOLDER))})
                else:
                    pbar.set_postfix({"Message": "No file found"})

                pbar.update(1)
    else:
        print("No new dates to download.")


if __name__ == "__main__":
    fetch_new_dates()
