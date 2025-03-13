import os
import base64
import boto3
import json
import requests
import datetime


from dotenv import load_dotenv

load_dotenv()

S3_ENDPOINT = "https://data.lpdaac.earthdatacloud.nasa.gov/s3credentials"

BUCKET_NAME = "lp-prod-protected"
# BASE_DATA_PRODUCT = "MOD16A2GF"
BASE_DATA_PRODUCT = "MOD16A2"
DATA_PRODUCT_VERSION = "061"
DATA_PRODUCT = f"{BASE_DATA_PRODUCT}.{DATA_PRODUCT_VERSION}"


def retrieve_credentials():
    """Authenticate with NASA Earthdata and retrieve temporary S3 credentials."""

    login_resp = requests.get(S3_ENDPOINT, allow_redirects=False)
    login_resp.raise_for_status()

    temp_cred_path = ".temp_s3_credentials.json"
    if os.path.exists(temp_cred_path):
        with open(temp_cred_path, "r") as f:
            creds = json.load(f)
        expiration = datetime.datetime.strptime(creds["expiration"], "%Y-%m-%d %H:%M:%S%z")

        if expiration > datetime.datetime.now(datetime.timezone.utc):
            return creds
        else:
            print("Credentials expired, fetching new ones.")
            os.remove(temp_cred_path)
    else:
        print("No credentials found, fetching new ones.")

    EDL_USERNAME = os.environ.get("EDL_USERNAME", "")
    EDL_PASSWORD = os.environ.get("EDL_PASSWORD", "")

    auth = f"{EDL_USERNAME}:{EDL_PASSWORD}"
    encoded_auth = base64.b64encode(auth.encode("ascii")).decode("ascii")

    auth_redirect = requests.post(
        login_resp.headers["location"],
        data={"credentials": encoded_auth},
        headers={"Origin": S3_ENDPOINT},
        allow_redirects=False,
    )
    auth_redirect.raise_for_status()

    final = requests.get(auth_redirect.headers["location"], allow_redirects=False)
    results = requests.get(S3_ENDPOINT, cookies={"accessToken": final.cookies["accessToken"]})
    results.raise_for_status()

    creds = json.loads(results.content)

    with open(".temp_s3_credentials.json", "w") as f:
        json.dump(creds, f)

    return json.loads(results.content)


def download_tile_from_s3(date, tile, dest_folder="modis_downloads"):
    """Download a file from NASA's S3 bucket using temporary credentials."""
    os.makedirs(dest_folder, exist_ok=True)

    converted_date = datetime.datetime.strptime(date, "%Y.%m.%d").strftime("%Y%j")
    filename = f"{BASE_DATA_PRODUCT}.A{converted_date}.{tile}.{DATA_PRODUCT_VERSION}"
    output_name = f"{filename.split('/')[-1]}.hdf"
    save_path = os.path.join(dest_folder, output_name)
    if os.path.exists(os.path.join(dest_folder, output_name)):
        return save_path

    creds = retrieve_credentials()

    s3 = boto3.client(
        "s3",
        aws_access_key_id=creds["accessKeyId"],
        aws_secret_access_key=creds["secretAccessKey"],
        aws_session_token=creds["sessionToken"],
    )

    object_path = f"{DATA_PRODUCT}/{filename}"
    response = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=object_path)
    if "Contents" not in response:
        print(f"No files found for {filename} in {BUCKET_NAME}.")
        return

    hdf_path = next((item["Key"] for item in response["Contents"] if item["Key"].endswith(".hdf")), None)

    s3.download_file(BUCKET_NAME, hdf_path, save_path)

    return save_path


def list_all_tiles_for_year(year):
    """List all available MODIS tiles for a given year."""
    year_str = str(year)
    filename = f"{BASE_DATA_PRODUCT}.A{year_str}"
    creds = retrieve_credentials()

    s3 = boto3.client(
        "s3",
        aws_access_key_id=creds["accessKeyId"],
        aws_secret_access_key=creds["secretAccessKey"],
        aws_session_token=creds["sessionToken"],
    )

    object_path = f"{DATA_PRODUCT}/{filename}"
    response = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=object_path)
    if "Contents" not in response:
        print(f"No files found for {filename} in {BUCKET_NAME}.")
        return set()

    tiles = set()
    for item in response["Contents"]:
        key = item["Key"]
        tile = key.split(".")[-2]
        tiles.add(tile)

    return tiles


if __name__ == "__main__":
    download_tile_from_s3("2008.12.18", "h08v05")
