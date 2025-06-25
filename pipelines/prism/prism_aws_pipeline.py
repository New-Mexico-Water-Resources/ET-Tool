import logging
import os
import time
import zipfile
import requests
from tqdm import tqdm
import re
import shutil
import numpy as np
import rasterio
from rasterio.mask import mask
from rasterio.warp import calculate_default_transform, reproject, Resampling
import geopandas as gpd
from datetime import datetime, timedelta
import boto3


class PrismAWSDataPipeline:
    def __init__(
        self,
        aws_bucket: str = "ose-dev-inputs",
        aws_region: str = "us-west-2",
        aws_profile: str = None,
        aws_access_key_id: str = None,
        aws_secret_access_key: str = None,
        base_url: str = "https://ftp.prism.oregonstate.edu/monthly/ppt/",
        product_prefix: str = "OREGON_STATE_PRISM",
        raw_dir: str = "prism_data",
        monthly_dir: str = "prism_data_monthly",
        output_dir: str = "prism_tiles",
        delay: float = 0.2,
        source_crs: str = "EPSG:4269",
        target_crs: str = "EPSG:4326",
        tiles_geojson: str = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ARD_tiles.geojson"),
        allow_provisional: bool = False,
    ):
        self.aws_bucket = aws_bucket
        self.aws_region = aws_region
        self.aws_profile = aws_profile
        self.aws_access_key_id = aws_access_key_id
        self.aws_secret_access_key = aws_secret_access_key
        self.base_url = base_url
        self.product_prefix = product_prefix
        self.raw_dir = raw_dir
        self.monthly_dir = monthly_dir
        self.output_dir = output_dir
        self.delay = delay
        self.source_crs = source_crs
        self.target_crs = target_crs
        self.tiles_geojson = tiles_geojson
        self.allow_provisional = allow_provisional

        self.session = boto3.Session(profile_name=self.aws_profile)
        self.s3 = self.session.client(
            "s3",
            region_name=self.aws_region,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
        )

        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.INFO)

    def _download_file(self, url, save_path, allow_fail: bool = False):
        """Download a file from a URL and save it to the specified path."""
        response = requests.get(url, stream=True)
        if response.status_code == 200:
            total_size = int(response.headers.get("content-length", 0))
            with open(save_path, "wb") as f, tqdm(
                desc=f"Downloading {os.path.basename(save_path)}",
                total=total_size,
                unit="B",
                unit_scale=True,
                unit_divisor=1024,
            ) as bar:
                for chunk in response.iter_content(1024):
                    f.write(chunk)
                    bar.update(len(chunk))
            return True
        else:
            if not allow_fail:
                self.logger.error(f"Failed to download {url} - HTTP Status Code: {response.status_code}")

            return False

    def _extract_bil_and_hdr(self, zip_path, extract_dir, year):
        """Extract .bil and .hdr files from a yearly zip archive."""
        try:
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                for file in zip_ref.namelist():
                    if file.endswith(".bil") or file.endswith(".hdr"):
                        # Create month subdirectory
                        month = file.split("_")[4][:6]  # Extract YYYYMM from the filename
                        month_dir = os.path.join(extract_dir, month)
                        os.makedirs(month_dir, exist_ok=True)
                        # Extract the file
                        zip_ref.extract(file, month_dir)
                        self.logger.info(f"Extracted {file} to {month_dir}")
        except zipfile.BadZipFile:
            self.logger.error(f"Error: {zip_path} is not a valid zip file")

    def download_by_month(self, year: int, month: int):
        """
        Download the monthly data for the given year and month.
        Args:
            year (int): The year to download data for
            month (int): The month to download data for
        """
        year_url = f"{self.base_url}{year}/"
        file_name = f"PRISM_ppt_stable_4kmM3_{year}{month:02d}_bil.zip"
        file_url = f"{year_url}{file_name}"

        year_dir = os.path.join(self.raw_dir, str(year))
        os.makedirs(year_dir, exist_ok=True)

        zip_path = os.path.join(year_dir, file_name)
        success = self._download_file(file_url, zip_path)
        if success:
            self._extract_bil_and_hdr(zip_path, year_dir, year)
        else:
            # Try provisional data
            if self.allow_provisional:
                file_name = f"PRISM_ppt_provisional_4kmM3_{year}{month:02d}_bil.zip"
                file_url = f"{year_url}{file_name}"
                zip_path = os.path.join(year_dir, file_name)
                success = self._download_file(file_url, zip_path)
                if success:
                    self._extract_bil_and_hdr(zip_path, year_dir, year)
                else:
                    self.logger.error(f"Failed to download {file_name}")
            else:
                self.logger.error(f"Failed to download {file_name}")

    def download_by_year(self, year: int):
        """
        Download all monthly data for the given year
        """
        year_url = f"{self.base_url}{year}/"
        file_name = f"PRISM_ppt_stable_4kmM3_{year}_all_bil.zip"
        file_url = f"{year_url}{file_name}"

        year_dir = os.path.join(self.raw_dir, str(year))
        os.makedirs(year_dir, exist_ok=True)

        zip_path = os.path.join(year_dir, file_name)

        # Download the file if it doesn't already exist
        if not os.path.exists(zip_path):
            self.logger.info(f"Downloading {file_name}...")
            success = self._download_file(file_url, zip_path, allow_fail=True)
            if success:
                self._extract_bil_and_hdr(zip_path, year_dir, year)
            else:
                # The all_bil file is not available, so we need to download the monthly files
                for month in range(1, 13):
                    self.download_by_month(year, month)
                    time.sleep(self.delay)
        else:
            self.logger.info(f"{file_name} already exists. Skipping download.")

    def consolidate_bil_files(self, year: int):
        """Consolidate all .bil files into a flat directory."""
        year_dir = os.path.join(self.raw_dir, str(year))
        if not os.path.exists(year_dir):
            self.logger.info(f"Year directory {year_dir} does not exist. Skipping.")
            return

        self.logger.info(f"Processing year {year}...")
        for root, _, files in os.walk(year_dir):
            for file in files:
                # Make sure filename matches PRISM_ppt_stable_4kmM3_198501_bil.bil
                if self.allow_provisional:
                    # Allow either stable or provisional data
                    matches = re.match(r"PRISM_ppt_(stable|provisional)_4kmM3_(\d{6})_bil.[a-z]{3,3}", file)
                else:
                    matches = re.match(r"PRISM_ppt_stable_4kmM3_(\d{6})_bil.[a-z]{3,3}", file)
                if not matches:
                    self.logger.info(f"Skipping {file} - wrong filename format")
                    continue

                if file.endswith(".bil") or file.endswith(".hdr"):
                    source_path = os.path.join(root, file)
                    os.makedirs(self.monthly_dir, exist_ok=True)
                    target_path = os.path.join(self.monthly_dir, file)

                    # If already exists, skip
                    if os.path.exists(target_path):
                        self.logger.info(f"Skipping {source_path} - already exists")
                        continue

                    shutil.copy(source_path, target_path)
                    self.logger.info(f"Copied {source_path} to {target_path}")

    def _parse_date_from_filename(self, filename):
        """Parse start and end dates from the filename."""
        parts = filename.split("_")
        if len(parts) < 5:
            raise ValueError(f"Unexpected filename format: {filename}")
        date_str = parts[4]  # YYYYMM
        start_date = datetime.strptime(date_str, "%Y%m")
        end_date = (start_date.replace(day=28) + timedelta(days=4)).replace(day=1)
        return start_date.strftime("%Y%m01"), end_date.strftime("%Y%m01")

    def _calculate_bounds(self, transform, width, height):
        """Calculate bounds from an Affine transform and raster dimensions."""
        left = transform.c
        top = transform.f
        right = left + transform.a * width
        bottom = top + transform.e * height
        return left, bottom, right, top

    def _reproject_raster(self, src_crs, data, transform):
        """Reproject raster data to the target CRS."""
        bounds = self._calculate_bounds(transform, data.shape[2], data.shape[1])
        transform, width, height = calculate_default_transform(
            src_crs, self.target_crs, data.shape[2], data.shape[1], *bounds
        )
        dest_data = np.empty((data.shape[0], height, width), dtype=data.dtype)
        dest_meta = {
            "crs": self.target_crs,
            "transform": transform,
            "width": width,
            "height": height,
            "count": data.shape[0],
            "dtype": data.dtype.name,
            "driver": "GTiff",
        }

        for i in range(data.shape[0]):
            reproject(
                source=data[i],
                destination=dest_data[i],
                src_transform=transform,
                src_crs=src_crs,
                dst_transform=transform,
                dst_crs=self.target_crs,
                resampling=Resampling.nearest,
            )

        return dest_data, dest_meta

    def process_tiles(self):
        """Chop each .bil file into tiles and save them in the specified format."""
        # Load GeoJSON
        tiles_gdf = gpd.read_file(self.tiles_geojson)

        # Loop through all .bil files
        for bil_file in os.listdir(self.monthly_dir):
            if bil_file.endswith(".bil"):
                bil_path = os.path.join(self.monthly_dir, bil_file)
                self.logger.info(f"Processing {bil_file}...")

                # Parse dates from filename
                try:
                    start_date, end_date = self._parse_date_from_filename(bil_file)
                except ValueError as e:
                    self.logger.error(e)
                    continue

                # Open the .bil file
                with rasterio.open(bil_path) as src:
                    # Manually assign CRS if missing
                    if src.crs is None:
                        src_crs = self.source_crs
                    else:
                        src_crs = src.crs

                    # Loop through each feature in the GeoJSON
                    for _, feature in tiles_gdf.iterrows():
                        hv = feature["hv"]
                        geometry = [feature["geometry"]]

                        # Mask the raster with the feature geometry
                        try:
                            out_image, out_transform = mask(src, geometry, crop=True)
                            # Reproject the raster data to WGS84
                            reprojected_data, reprojected_meta = self._reproject_raster(src_crs, out_image, out_transform)

                            os.makedirs(self.output_dir, exist_ok=True)
                            # Generate output filename
                            output_filename = f"{self.product_prefix}_{hv}_{start_date}_{end_date}_PPT.tif"
                            output_path = os.path.join(self.output_dir, output_filename)

                            # Write the output tile
                            with rasterio.open(output_path, "w", **reprojected_meta) as dest:
                                dest.write(reprojected_data)
                            self.logger.info(f"Saved tile {output_filename}")
                        except Exception as e:
                            self.logger.error(f"Error processing tile {hv}: {e}")

    def check_if_s3_key_exists(self, key: str) -> bool:
        """
        Check if the file exists in the aws bucket
        Args:
            key (str): key of the file to check
        Returns:
            bool: True if the file exists, False otherwise
        """
        try:
            self.s3.head_object(Bucket=self.aws_bucket, Key=key)
            return True
        except self.s3.exceptions.ClientError:
            return False

    def upload_to_aws(self, path: str, overwrite: bool = False):
        """
        Upload the file to the aws bucket
        Args:
            path (str): path to the file to upload
            overwrite (bool, optional): whether to overwrite the file if it already exists [default: False]
        """
        file_name = os.path.basename(path)
        if not overwrite:
            # Check if the file already exists in the bucket
            if self.check_if_s3_key_exists(file_name):
                self.logger.info(f"File {file_name} already exists in aws bucket {self.aws_bucket}, skipping upload")
                return

        self.s3.upload_file(path, self.aws_bucket, file_name)
        self.logger.info(f"Uploaded file {file_name} to aws bucket {self.aws_bucket}")
        return file_name

    def upload_local_folder_to_aws(self, output_dir: str | None = None, overwrite: bool = False):
        """
        Upload all the files to the aws bucket
        Args:
            output_dir (str): path to the directory to upload
            overwrite (bool, optional): whether to overwrite the files if they already exist [default: False]
        Returns:
            list[str]: list of files that were uploaded
        """
        if output_dir is None:
            output_dir = self.output_dir

        files = []
        pbar = tqdm(os.listdir(output_dir), desc=f"Uploading files to aws bucket {self.aws_bucket}", leave=False)
        for file in pbar:
            file_path = os.path.join(output_dir, file)
            files.append(self.upload_to_aws(file_path, overwrite))
            pbar.set_description(f"Uploading file: {file}")
        return files

    def process_year(self, year: int, upload: bool = False):
        """
        Process the year
        Args:
            year (int): The year to process
            upload (bool, optional): Whether to upload the files to the aws bucket [default: False]
        """
        self.download_by_year(year)
        self.consolidate_bil_files(year)
        self.process_tiles()
        if upload:
            self.upload_local_folder_to_aws()
