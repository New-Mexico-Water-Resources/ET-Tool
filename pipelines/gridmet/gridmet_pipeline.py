import requests
import os
import xarray as xr
import json
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
import pandas as pd
import geopandas as gpd
import numpy as np
from shapely.geometry import box, shape
import logging
import boto3
from tqdm import tqdm

class GridMETPipeline:

    def __init__(
        self,
        bands: list[str] = ["pet"],
        aws_profile: str = "ose-nmw",
        aws_bucket: str = "ose-dev-inputs",
        aws_region: str = "us-west-2",
        tile_path: str = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ARD_tiles.geojson"),
        url: str = "https://www.northwestknowledge.net/metdata/data/",
        alt_url: str = "http://thredds.northwestknowledge.net:8080/thredds/fileServer/MET/pet/",
        temp_dir: str = "temp_data",
        output_dir: str = "output_data",
    ):
        self.bands = bands
        self.aws_profile = aws_profile
        self.aws_bucket = aws_bucket
        self.aws_region = aws_region
        self.tile_path = tile_path
        self.url = url.rstrip("/")
        self.alt_url = alt_url.rstrip("/")
        self.temp_dir = temp_dir
        self.output_dir = output_dir
        self.session = boto3.Session(profile_name=self.aws_profile, region_name=self.aws_region)
        self.s3 = self.session.client(
            "s3",
            region_name=self.aws_region,
        )

        self.band_mapping = {
            "pet": "ETO",
        }
        self.internal_band_mapping = {
            "pet": "potential_evapotranspiration",
        }
        
        self.manifest = set()

        # Set up logging
        logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
        self.logger = logging.getLogger(__name__)
        self.update_manifest()

    def update_manifest(self):
        # Check AWS and store all keys in a set
        paginator = self.s3.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=self.aws_bucket, Prefix=f"IDAHO_EPSCOR_GRIDMET_")
        
        for page in pages:
            for obj in page.get("Contents", []):
                self.manifest.add(obj["Key"])

    def fetch_year_netcdf(self, year: int):
        paths = []
        for band in self.bands:
            url = f"{self.url}/{band}_{year}.nc"
            output_path = os.path.join(self.temp_dir, f"{band}_{year}.nc")
            if not os.path.exists(self.temp_dir):
                os.makedirs(self.temp_dir)

            if os.path.exists(output_path):
                paths.append(
                    {
                        "path": output_path,
                        "band": band,
                    }
                )
                continue

            try:
                response = requests.get(url)
                response.raise_for_status()
            except requests.exceptions.RequestException as e:
                url = f"{self.alt_url}/{band}_{year}.nc"
                try:
                    response = requests.get(url)
                    response.raise_for_status()
                except requests.exceptions.RequestException as e:
                    self.logger.error(f"Failed to fetch {url}: {str(e)}")
                    continue
            
            with open(os.path.join(self.temp_dir, f"{band}_{year}.nc"), "wb") as f:
                f.write(response.content)
            paths.append(
                {
                    "path": os.path.join(self.temp_dir, f"{band}_{year}.nc"),
                    "band": band,
                }
            )
        return paths

    def process_netcdf(self, path: str, band: str, year: int):
        paths = []
        with xr.open_dataset(path) as ds:
            self.logger.info(f"Processing NetCDF file: {path}")
            self.logger.info(f"Original dataset time dimension size: {len(ds.day)}")

            ds = ds.rename({"day": "time"})
            ds["time"] = pd.date_range(start=f"{year}-01-01", periods=len(ds.time), freq="D")

            self.logger.info(f"Date range: {ds.time.min().values} to {ds.time.max().values}")
            self.logger.info(f"Total days in dataset: {len(ds.time)}")

            original_data = ds[self.internal_band_mapping.get(band, band)]
            self.logger.info(f"Original data shape: {original_data.shape}")
            self.logger.info(
                f"Original data date range: {original_data.time.min().values} to {original_data.time.max().values}"
            )

            ds = ds.resample(time="ME").sum()
            self.logger.info(f"After monthly resampling, time dimension size: {len(ds.time)}")

            for month in range(1, 13):
                month_data = ds.sel(time=f"{year}-{month:02d}")

                self.logger.info(f"Processing month {month} ({year}-{month:02d})")

                month_start = f"{year}-{month:02d}-01"

                original_month_data = original_data.sel(time=slice(month_start, None))
                month_mask = (original_month_data.time.dt.month == month) & (original_month_data.time.dt.year == year)
                original_month_data = original_month_data.where(month_mask, drop=True)

                daily_dates = original_month_data.time.values
                self.logger.info(f"Month {month}: Found {len(daily_dates)} days")
                self.logger.info(f"Month {month}: First day: {daily_dates[0]}")
                self.logger.info(f"Month {month}: Last day: {daily_dates[-1]}")

                output_path = os.path.join(self.temp_dir, f"{band}_{year}_{month:02d}.tif")
                if os.path.exists(output_path):
                    self.logger.info(f"Month {month}: Output file already exists, skipping")
                    paths.append(output_path)
                    continue

                data = month_data[self.internal_band_mapping.get(band, band)].values

                data = data.squeeze()

                # data = np.where(data == 0, np.nan, data)

                lats = month_data.lat.values
                lons = month_data.lon.values

                lat_res = abs(lats[1] - lats[0]) if len(lats) > 1 else 1 / 24
                lon_res = abs(lons[1] - lons[0]) if len(lons) > 1 else 1 / 24

                transform = from_bounds(
                    west=lons.min() - lon_res / 2,
                    south=lats.min() - lat_res / 2,
                    east=lons.max() + lon_res / 2,
                    north=lats.max() + lat_res / 2,
                    width=len(lons),
                    height=len(lats),
                )

                with rasterio.open(
                    output_path,
                    "w",
                    driver="GTiff",
                    height=data.shape[0],
                    width=data.shape[1],
                    count=1,
                    dtype=data.dtype,
                    crs="EPSG:4326",
                    transform=transform,
                ) as dst:
                    dst.write(data, 1)
                paths.append(output_path)

        return paths

    def clip_geotiff(self, geotiff_path: str, tile_geometry: dict):
        with rasterio.open(geotiff_path) as src:
            raster_bounds = src.bounds
            tile_geom = shape(tile_geometry)
            tile_gdf = gpd.GeoDataFrame(geometry=[tile_geom], crs="EPSG:4326")

            raster_poly = box(*raster_bounds)
            raster_gdf = gpd.GeoDataFrame(geometry=[raster_poly], crs=src.crs)

            if tile_gdf.crs != src.crs:
                tile_gdf = tile_gdf.to_crs(src.crs)

            if not raster_gdf.geometry.iloc[0].intersects(tile_gdf.geometry.iloc[0]):
                raise ValueError("Input shapes do not overlap raster")

            if np.issubdtype(src.dtypes[0], np.floating):
                nodata_value = np.nan
            else:
                nodata_value = -9999

            # Match ET 30m resolution
            target_pixel_size = 0.000269494585236

            tile_geom = shape(tile_geometry)
            buffered_geom = tile_geom.buffer(0.1)

            rough_clipped, rough_transform = rasterio.mask.mask(src, [buffered_geom], crop=True, nodata=nodata_value)

            rough_bounds = rasterio.transform.array_bounds(rough_clipped.shape[1], rough_clipped.shape[2], rough_transform)
            west, south, east, north = rough_bounds

            new_width = int((east - west) / target_pixel_size)
            new_height = int((north - south) / target_pixel_size)

            new_transform = from_bounds(west, south, east, north, new_width, new_height)

            upsampled = np.empty((rough_clipped.shape[0], new_height, new_width), dtype=rough_clipped.dtype)

            reproject(
                source=rough_clipped,
                destination=upsampled,
                src_transform=rough_transform,
                src_crs=src.crs,
                dst_transform=new_transform,
                dst_crs=src.crs,
                resampling=Resampling.nearest,
                src_nodata=nodata_value,
                dst_nodata=nodata_value,
            )

            with rasterio.io.MemoryFile() as memfile:
                with memfile.open(
                    driver="GTiff",
                    height=new_height,
                    width=new_width,
                    count=rough_clipped.shape[0],
                    dtype=rough_clipped.dtype,
                    crs=src.crs,
                    transform=new_transform,
                    nodata=nodata_value,
                ) as temp_src:
                    temp_src.write(upsampled)

                    final_clipped, final_transform = rasterio.mask.mask(
                        temp_src, [tile_geometry], crop=True, nodata=nodata_value
                    )

            return final_clipped, final_transform, nodata_value

    def tile_geotiff(self, geotiff_path: str, band_name: str):
        with open(self.tile_path) as f:
            tile_data = json.load(f)
        paths = []

        # Extract date information from filename (format: {band}_{year}_{month:02d}.tif)
        filename_base = os.path.basename(geotiff_path)
        filename_parts = filename_base.replace(".tif", "").split("_")
        year = int(filename_parts[-2])
        month = int(filename_parts[-1])

        # Create date objects for filename generation
        month_start = pd.Timestamp(year=year, month=month, day=1)
        if month == 12:
            month_end = pd.Timestamp(year=year + 1, month=1, day=1)
        else:
            month_end = pd.Timestamp(year=year, month=month + 1, day=1)

        date_str = month_start.strftime("%Y%m%d")
        next_month_date_str = month_end.strftime("%Y%m%d")

        with rasterio.open(geotiff_path) as src:
            for tile in tile_data["features"]:
                tile_geometry = tile["geometry"]
                clipped, clipped_transform, nodata_value = self.clip_geotiff(geotiff_path, tile_geometry)
                filename = (
                    f"IDAHO_EPSCOR_GRIDMET_{tile['properties']['hv']}_{date_str}_{next_month_date_str}_{band_name}.tif"
                )
                if filename in self.manifest:
                    self.logger.info(f"File {filename} already exists in aws bucket {self.aws_bucket}, skipping")
                    paths.append(filename)
                    continue

                if not os.path.exists(self.output_dir):
                    os.makedirs(self.output_dir)
                output_path = os.path.join(self.output_dir, filename)
                if os.path.exists(output_path):
                    self.logger.info(f"File {output_path} already exists, skipping")
                    paths.append(output_path)
                    continue

                # Update profile with clipped data dimensions and transform
                profile = src.profile.copy()
                profile.update(
                    {
                        "height": clipped.shape[1],
                        "width": clipped.shape[2],
                        "transform": clipped_transform,
                        "nodata": nodata_value,
                    }
                )

                with rasterio.open(output_path, "w", **profile) as dst:
                    dst.write(clipped)
                paths.append(output_path)

        return paths

    def fetch_year(self, year: int):
        paths = self.fetch_year_netcdf(year)
        all_tile_paths = []
        for path in paths:
            month_paths = self.process_netcdf(path["path"], path["band"], year)
            for month_path in month_paths:
                tile_paths = self.tile_geotiff(month_path, self.band_mapping[path["band"]] or path["band"])
                all_tile_paths.extend(tile_paths)
        return all_tile_paths

    def fetch_year_range(self, start_year: int, end_year: int):
        for year in range(start_year, end_year + 1):
            self.fetch_year(year)

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

    def upload_file_to_aws(self, path: str, overwrite: bool = False):
        """
        Upload the file to the aws bucket
        Args:
            path (str): path to the file to upload
            overwrite (bool, optional): whether to overwrite the file if it already exists [default: False]
        Returns:
            bool: True if upload was successful, False otherwise
        """
        file_name = os.path.basename(path)
        if not overwrite:
            # Check if the file already exists in the bucket
            if self.check_if_s3_key_exists(file_name):
                self.logger.info(f"File {file_name} already exists in aws bucket {self.aws_bucket}, skipping upload")
                return True

        try:
            self.s3.upload_file(path, self.aws_bucket, file_name)
            self.logger.info(f"Uploaded file {file_name} to aws bucket {self.aws_bucket}")
            return True
        except Exception as e:
            self.logger.error(f"Failed to upload {file_name}: {str(e)}")
            return False

    def upload_to_aws(self, delete_on_success: bool = False):
        """
        Upload all files in output directory to AWS
        Args:
            delete_on_success (bool): Whether to delete local files after successful upload
        """
        files = os.listdir(self.output_dir)
        pbar = tqdm(files, desc="Uploading files to AWS")
        for file in pbar:
            full_path = os.path.join(self.output_dir, file)
            pbar.set_description(f"Uploading {file}")
            
            if self.upload_file_to_aws(full_path):
                if delete_on_success:
                    try:
                        os.remove(full_path)
                        self.logger.info(f"Deleted local file {file}")
                    except Exception as e:
                        self.logger.error(f"Failed to delete {file}: {str(e)}")
