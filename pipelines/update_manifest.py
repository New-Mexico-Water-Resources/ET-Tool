import boto3
import pandas as pd
import yaml
from datetime import datetime
import re
from tqdm import tqdm
import logging


class S3ManifestTracker:
    def __init__(
        self,
        config_path,
        bucket_name="ose-dev-inputs",
        output_path="S3_filenames_dynamic.csv",
        profile_name=None,
        region_name="us-west-2",
    ):
        self.config_path = config_path
        self.output_path = output_path
        self.bucket_name = bucket_name
        self.profile_name = profile_name
        self.region_name = region_name
        self.session = None
        self.s3_client = None
        self.config = None

        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.INFO)
        self.logger.addHandler(logging.StreamHandler())

        self.initialize_s3_client()
        self.load_config()

    def initialize_s3_client(self):
        self.session = boto3.Session(profile_name=self.profile_name)
        self.s3_client = self.session.client("s3", region_name=self.region_name)

    def load_config(self):
        with open(self.config_path, "r") as f:
            self.config = yaml.safe_load(f)

    def extract_date_from_filename(self, filename, file_prefix):
        """Extract date from filename based on the file prefix pattern"""
        try:
            if file_prefix == "LC08_" or filename.startswith("LT"):
                # Landsat format: LC08_CU_009014_19821116_20200420_C01_V01_ET.tif
                # Extract date from position after tile (YYYYMMDD)
                match = re.search(r"_(\d{8})_", filename)
                if match:
                    date_str = match.group(1)
                    return datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
            elif file_prefix.startswith("OPENET_"):
                # OpenET format: OPENET_ENSEMBLE_009011_20240101_20240102_ET.tif
                # Extract start date (YYYYMMDD)
                match = re.search(r"_(\d{8})_\d{8}_", filename)
                if match:
                    date_str = match.group(1)
                    return datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
            elif file_prefix.startswith("IDAHO_EPSCOR_GRIDMET_"):
                # GRIDMET format: IDAHO_EPSCOR_GRIDMET_009011_20010301_20010302_eto.tif
                match = re.search(r"_(\d{8})_\d{8}_", filename)
                if match:
                    date_str = match.group(1)
                    return datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
            elif file_prefix.startswith("OREGON_STATE_PRISM_"):
                # PRISM format: OREGON_STATE_PRISM_009011_20240101_20240201_PPT.tif
                match = re.search(r"_(\d{8})_\d{8}_", filename)
                if match:
                    date_str = match.group(1)
                    return datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
        except Exception as e:
            self.logger.error(f"Error extracting date from {filename}: {e}")
            return None
        return None

    def extract_tile_from_filename(self, filename):
        """Extract tile ID from filename"""
        # Most files have tile format like 009011, 009012, etc.
        match = re.search(r"_(\d{6})_", filename)
        if match:
            return match.group(1)
        return None

    def list_s3_files_for_source(self, source):
        """List S3 files for a given source configuration"""
        files_data = []
        file_prefix = source["file_prefix"]
        mapped_variable = source["mapped_variable"]
        start_date = datetime.strptime(source["start"], "%Y-%m-%d")
        end_date = datetime.strptime(source["end"], "%Y-%m-%d")

        self.logger.info(f"\nProcessing source: {source['name']}")
        self.logger.info(f"  File prefix: {file_prefix}")
        self.logger.info(f"  Date range: {source['start']} to {source['end']}")

        # List objects in S3 bucket
        paginator = self.s3_client.get_paginator("list_objects_v2")
        prefix = file_prefix

        prefixes = [file_prefix]
        if prefix == "LC08_":
            prefixes.append("LT0")

        for prefix in prefixes:
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
                if "Contents" not in page:
                    continue

                for obj in page["Contents"]:
                    filename = obj["Key"].split("/")[-1]  # Get just the filename without path

                    # Check if it contains the expected variable
                    if not filename.endswith(f"_{mapped_variable}.tif"):
                        continue

                    # Extract date from filename
                    file_date_str = self.extract_date_from_filename(filename, file_prefix)
                    if not file_date_str:
                        continue

                    file_date = datetime.strptime(file_date_str, "%Y-%m-%d")

                    # Check if date is within range
                    if file_date < start_date or file_date >= end_date:
                        continue

                    # Extract tile information
                    tile = self.extract_tile_from_filename(filename)

                    files_data.append(
                        {
                            "filename": filename,
                            "variable": mapped_variable,
                            "date": file_date_str,
                            "tile": tile,
                            "source_id": source["id"],
                        }
                    )

        self.logger.info(f"  Found {len(files_data)} files")
        return files_data

    def update_manifest(self, output_path=None, write_to_file=True):
        if output_path is None:
            output_path = self.output_path

        all_files_data = []

        pbar = tqdm(self.config["sources"], desc="Processing sources")
        for source in pbar:
            source_files = self.list_s3_files_for_source(source)
            all_files_data.extend(source_files)
            pbar.set_postfix({"source": source["name"], "files": len(source_files)})

        new_inventory_df = pd.DataFrame(all_files_data)

        self.logger.info(f"\nGenerated inventory with {len(new_inventory_df)} total files")
        self.logger.info(f"Sources processed: {len(self.config['sources'])}")

        if not new_inventory_df.empty:
            summary = new_inventory_df.groupby(["source_id", "variable"]).size().reset_index(name="file_count")
            self.logger.info(f"\nSummary by source:\n{summary.to_string()}")

            self.logger.info("\nDate range in inventory:")
            self.logger.info(f"  Earliest: {new_inventory_df['date'].min()}")
            self.logger.info(f"  Latest: {new_inventory_df['date'].max()}")

            self.logger.info(f"\nVariables found: {sorted(new_inventory_df['variable'].unique())}")
            self.logger.info(f"Unique tiles: {len(new_inventory_df['tile'].unique())} tiles")
        else:
            self.logger.info("No files found matching the criteria")

        if write_to_file:
            new_inventory_df.sort_values("date").to_csv(
                output_path, index=False, columns=["filename", "variable", "date", "tile"]
            )

        return new_inventory_df
