import ee
import geemap
import boto3
from water_rights_visualizer.google_drive import google_drive_login
from tqdm.auto import tqdm
from typing import Any
import logging
import os
import json
from datetime import datetime
from dateutil.relativedelta import relativedelta


class GEEAWSDataPipeline:
    visualization_configs = {
        "default": {"min": 0.0, "max": 200.0, "palette": ["f6e8c3", "d8b365", "99974a", "53792d", "6bdfd2", "1839c5"]},
        "gridmet": {"min": 0.0, "max": 100.0, "palette": ["f6e8c3", "d8b365", "99974a", "53792d", "6bdfd2", "1839c5"]},
        "tiles": {"color": "blue", "fillColor": "00000000", "strokeWidth": 2},
    }

    def __init__(
        self,
        tiles: ee.FeatureCollection | None = None,
        tile_path: str | None = None,
        bands=["et_ensemble_mad"],
        tile_ids=["13s", "12s", "12r"],
        product="OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0",
        product_prefix="OPENET_ENSEMBLE",
        aws_bucket="ose-dev-inputs",
        aws_region="us-west-2",
        aws_access_key_id=None,
        aws_secret_access_key=None,
        aws_profile=None,
        gdrive_folder="OPENET_EXPORTS",
        temp_local_folder="temp_data",
        project="et-exploration",
        gdrive_key_filename=None,
        gdrive_client_secrets_filename=None,
        monthly_sum: bool = False,
        error_log_filename: str = "error.log",
    ):
        """
        Initialize the GEEAWSDataPipeline
        Args:
            tiles: geojson of tiles
            tile_path (str | None): path to the tile geojson file
            bands: list of bands to process
            tile_ids: list of tile ids to filter by
            product: ee.ImageCollection product
            product_prefix: prefix for the output product name
            aws_bucket: aws bucket to upload final product to
            aws_region: aws region to use for authentication
            aws_access_key_id: aws access key id to use for authentication
            aws_secret_access_key: aws secret access key to use for authentication
            aws_profile: aws profile to use for authentication
            gdrive_folder: temporary gdrive folder to output to
            project: ee project to use for authentication
        """
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.INFO)
        self.error_log_filename = error_log_filename

        self.session = None
        self.s3 = None
        self.drive = None
        self.aws_region = aws_region
        self.aws_profile = aws_profile
        self.authenticate(
            project, gdrive_key_filename, gdrive_client_secrets_filename, aws_access_key_id, aws_secret_access_key
        )

        # Default to ARD_tiles.geojson
        if tiles is None and tile_path is None:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            tile_path = os.path.join(current_dir, "ARD_tiles.geojson")

        if tiles:
            self.tiles = ee.FeatureCollection(tiles)
        else:
            # Load the tiles from the file
            with open(tile_path, "r") as f:
                geojson_dict = json.load(f)
                self.tiles = ee.FeatureCollection(geojson_dict)
        self.bands = bands
        self.product = product
        self.product_prefix = product_prefix
        self.aws_bucket = aws_bucket
        self.gdrive_folder = gdrive_folder
        self.tile_ids = tile_ids
        self.temp_local_folder = temp_local_folder
        self.monthly_sum = monthly_sum

        self._configure_error_log()

    def _error_log_prefix(self):
        """
        Get the error log prefix
        """
        return f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]: "

    def _configure_error_log(self):
        """
        Configure the error log
        """
        with open(self.error_log_filename, "a") as error_log_file:
            err_start = self._error_log_prefix()
            error_log_file.write(f"{err_start}****************************************************\n")
            error_log_file.write(f"{err_start}Error log for {self.product}\n")
            error_log_file.write(f"{err_start}Product: {self.product}\n")
            error_log_file.write(f"{err_start}Product prefix: {self.product_prefix}\n")
            error_log_file.write(f"{err_start}Bands: {self.bands}\n")
            error_log_file.write(f"{err_start}Tile IDs: {self.tile_ids}\n")
            error_log_file.write(f"{err_start}Monthly sum: {self.monthly_sum}\n")
            error_log_file.write(f"{err_start}AWS bucket: {self.aws_bucket}\n")
            error_log_file.write(f"{err_start}AWS region: {self.aws_region}\n")
            error_log_file.write(f"{err_start}AWS profile: {self.aws_profile}\n")
            error_log_file.write(f"{err_start}Gdrive folder: {self.gdrive_folder}\n")
            error_log_file.write(f"{err_start}Temp local folder: {self.temp_local_folder}\n")
            error_log_file.write(f"{err_start}****************************************************\n")

    def log_error(self, error_message: str):
        """
        Log an error to the error log
        """
        with open(self.error_log_filename, "a") as error_log_file:
            err_start = self._error_log_prefix()
            error_log_file.write(f"{err_start}{error_message}\n")

    def authenticate(
        self,
        project: str,
        gdrive_key_filename: str,
        gdrive_client_secrets_filename: str,
        aws_access_key_id: str,
        aws_secret_access_key: str,
    ):
        """
        Authenticate with the GEE API and Google Drive
        Args:
            project (str): project to use for authentication
            gdrive_key_filename (str): path to the gdrive key file
            gdrive_client_secrets_filename (str): path to the gdrive client secrets file
            aws_access_key_id (str): aws access key id
            aws_secret_access_key (str): aws secret access key
        """
        ee.Authenticate()
        ee.Initialize(project=project)
        self.drive = google_drive_login(
            key_filename=gdrive_key_filename, client_secrets_filename=gdrive_client_secrets_filename
        )
        self.session = boto3.Session(profile_name=self.aws_profile)
        self.s3 = self.session.client(
            "s3",
            region_name=self.aws_region,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
        )

    def generate_mosaic_for_month(self, date: ee.Date, band: str) -> tuple[ee.Image, ee.Date, ee.Date]:
        """
        Process the month for the given date and bands
        Args:
            date (ee.Date): date to process (floored to the first day of the month)
        Returns:
            tuple: mosaic image, date, next_month
        """
        date = ee.Date(date)
        next_month = date.advance(1, "month")
        collection = ee.ImageCollection(self.product).filterDate(date, next_month).select([band])

        if self.tile_ids and len(self.tile_ids) > 0:
            images = [
                ee.Image(collection.filterMetadata("system:index", "contains", tile).first()) for tile in self.tile_ids
            ]
            collection = ee.ImageCollection(images)

        if self.monthly_sum:
            # Sum up all images in the collection for the month
            collection_count = collection.size().getInfo()
            current_date_str = date.format("YYYY-MM-dd").getInfo()
            self.logger.info(f"Summing up {collection_count} images in the collection for the month: {current_date_str}")
            # Verify date ranges being summed - want to ensure we have a full month of data
            days_in_month = date.advance(1, "month").difference(date, "day").getInfo()
            if collection_count < days_in_month:
                self.logger.warning(
                    f"Missing dates for monthly sum of {self.product} for the month: {current_date_str}. Only {collection_count} / {days_in_month} images."
                )
                self.log_error(f"Missing dates for month: {current_date_str} ({collection_count} / {days_in_month})")
            mosaic = collection.sum()
        else:
            # Use the original mosaic approach
            mosaic = collection.mosaic()

        return mosaic, date, next_month

    def form_layer_name(self, date: ee.Date, tile_hv: str, band: str) -> str:
        """
        Form the layer name for the given date, tile_hv
        Args:
            date (ee.Date): date to process
            tile_hv (str): tile_hv
            band (str): band to process
        Returns:
            str: layer name
        """
        BAND_NAME_MAP = {
            "et_ensemble_mad": "ET",
            "et_ensemble_mad_min": "ET_MIN",
            "et_ensemble_mad_max": "ET_MAX",
            "eto": "ETO",
        }
        band_name = BAND_NAME_MAP[band] if band in BAND_NAME_MAP else band

        start_output_date = date.format("YYYYMMdd").getInfo()
        next_day = date.advance(1, "month")
        end_output_date = next_day.format("YYYYMMdd").getInfo()
        layer_name = f"{self.product_prefix}_{tile_hv}_{start_output_date}_{end_output_date}_{band_name}"
        return layer_name

    def export_to_gdrive(self, image: ee.Image, layer_name: str, tile_geometry: ee.Geometry):
        """
        Export the image to the gdrive folder
        Args:
            image (ee.Image): image to export
            layer_name (str): name of the layer
            tile_geometry (ee.Geometry): geometry of the tile
        """
        task = ee.batch.Export.image.toDrive(
            image=image,
            description=layer_name,
            folder=self.gdrive_folder,
            region=tile_geometry,
            crs="EPSG:4326",
            scale=30,
            maxPixels=1e12,
        )
        task.start()
        self.logger.info(f"Started export for {layer_name}")

    def visualize_tile(
        self, image: ee.Image, layer_name: str, map_object: geemap.Map, visualization_config: dict | str = "default"
    ):
        """
        Visualize the tile on the map
        Args:
            image (ee.Image): image to visualize
            layer_name (str): name of the layer
            map_object (geemap.Map): geemap.Map object to visualize the tiles. Creates one with geemap.Map() if not provided.
            visualization_config (dict | str, optional): visualization configuration to use for map styling [default: "default"]
        Returns:
            geemap.Map: geemap.Map object with the layer added
        """
        if isinstance(visualization_config, str):
            config = self.visualization_configs.get(visualization_config, self.visualization_configs["default"])
        else:
            config = visualization_config

        map_object.addLayer(image, config, layer_name)
        self.logger.info(f"Added {layer_name} to map")

        return map_object

    def generate_tiles_for_month(
        self,
        date: str | ee.Date,
        export=True,
        visualize=False,
        map_object=None,
        visualization_config: dict | str = "default",
        limit: int | None = None,
    ):
        """
        Process the tile images for the given date and bands
        Args:
            date (str | ee.Date): date to process
            export (bool, optional): whether to export the tiles to gdrive [default: True].
            visualize (bool, optional): whether to visualize the tiles on a map [default: False].
            map_object (geemap.Map, optional): geemap.Map object to visualize the tiles. Creates one with geemap.Map() if not provided.
            visualization_config (dict | str, optional): visualization configuration to use for map styling [default: "default"]
            limit (int | None, optional): limit the number of tiles to process per band [default: None]
        Returns:
            geemap.Map: geemap.Map object with the layer added if visualize is True, otherwise None
        """
        if map_object is None and visualize:
            map_object = geemap.Map()

        # Process each band
        pbar = tqdm(self.bands, desc="Processing bands", leave=False)
        for band in pbar:
            pbar.set_description(f"Processing band: {band}")
            date = ee.Date(date) if isinstance(date, str) else date
            mosaic, date, next_month = self.generate_mosaic_for_month(date, band)
            tile_features = self.tiles.getInfo()["features"]
            new_pbar = tqdm(tile_features, desc="Processing tiles", leave=False)
            tile_count = 0
            for tile in new_pbar:
                if limit is not None:
                    if tile_count >= limit:
                        break
                    tile_count += 1
                new_pbar.set_description(f"Loading tile: {tile['properties']['hv']}")
                tile_feature = ee.Feature(tile)
                tile_geometry = tile_feature.geometry()
                tile_hv = tile["properties"]["hv"]

                clipped_image = mosaic.clip(tile_geometry)
                layer_name = self.form_layer_name(date, tile_hv, band)
                new_pbar.set_description(f"Processing layer: {layer_name}")

                if export:
                    self.export_to_gdrive(clipped_image, layer_name, tile_geometry)
                    pbar.set_description(f"Started export for layer: {layer_name}")

                if visualize:
                    map_object = self.visualize_tile(clipped_image, layer_name, map_object, visualization_config)
        if visualize:
            # Center the map on the first tile
            bounds = self.tiles.geometry().bounds()
            map_object.centerObject(bounds)
            return map_object

    def generate_ee_date_list(self, start_date: str, end_date: str) -> ee.List:
        """
        Generate a list of monthly dates between start and end dates
        Args:
            start_date (str): start month in YYYY-MM-DD format (floored to the first day of the month)
            end_date (str): end month in YYYY-MM-DD format (floored to the first day of the month)
        Returns:
            list of ee.Date objects representing the first day of each month between start and end dates
        """
        start_date = ee.Date(start_date)
        end_date = ee.Date(end_date)
        date_list = ee.List.sequence(0, end_date.difference(start_date, "month"))
        return date_list.map(lambda month: start_date.advance(month, "month"))

    def generate_date_list(self, start_date: str, end_date: str) -> list[str]:
        """
        Generate a list of monthly dates between start and end dates
        Args:
            start_date (str): start month in YYYY-MM-DD format (floored to the first day of the month)
            end_date (str): end month in YYYY-MM-DD format (floored to the first day of the month)
        Returns:
            list of str objects representing the first day of each month between start and end dates
        """
        start = datetime.strptime(start_date, "%Y-%m-01")
        end = datetime.strptime(end_date, "%Y-%m-01")

        dates = []
        current = start
        while current < end:
            dates.append(current.strftime("%Y-%m-%d"))
            current += relativedelta(months=1)

        return dates

    def generate_tiles_for_date_list(
        self,
        date_list: list[str],
        export: bool = True,
        visualize: bool = False,
        map_object=None,
        visualization_config: dict | str = "default",
    ):
        """
        Process the tile images for the given date list and bands
        Args:
            date_list (list[str]): list of dates to process
            export (bool, optional): whether to export the tiles to gdrive [default: True].
            visualize (bool, optional): whether to visualize the tiles on a map [default: False].
            map_object (geemap.Map, optional): geemap.Map object to visualize the tiles. Creates one with geemap.Map() if not provided.
            visualization_config (dict | str, optional): visualization configuration to use for map styling [default: "default"]
        """
        pbar = tqdm(date_list, desc="Processing dates", leave=False)
        for date in pbar:
            pbar.set_description(f"Processing date: {date}")
            self.generate_tiles_for_month(date, export, visualize, map_object, visualization_config)

    def generate_tiles_for_date_range(
        self,
        start_date: str,
        end_date: str,
        export: bool = True,
        visualize: bool = False,
        map_object=None,
        visualization_config: dict | str = "default",
    ):
        """
        Process the tile images for the given date range and bands
        Args:
            start_date (str): start month in YYYY-MM-DD format (floored to the first day of the month)
            end_date (str): end month in YYYY-MM-DD format (floored to the first day of the month)
            export (bool, optional): whether to export the tiles to gdrive [default: True].
            visualize (bool, optional): whether to visualize the tiles on a map [default: False].
            map_object (geemap.Map, optional): geemap.Map object to visualize the tiles. Creates one with geemap.Map() if not provided.
            visualization_config (dict | str, optional): visualization configuration to use for map styling [default: "default"]
        """
        date_list = self.generate_date_list(start_date, end_date)
        self.generate_tiles_for_date_list(date_list, export, visualize, map_object, visualization_config)

    def get_gdrive_folder_id(self, folder_name: str | None = None) -> str:
        """
        Get the id of the folder in Google Drive by name
        Args:
            folder_name (str | None, optional): name of the gdrive folder. Defaults to self.gdrive_folder.
        Returns:
            str: id of the gdrive folder
        """
        if folder_name is None:
            folder_name = self.gdrive_folder

        query = f"title='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        folder_listing = self.drive.ListFile({"q": query}).GetList()

        if not folder_listing:
            raise ValueError(f"Folder '{folder_name}' not found in Google Drive")

        return folder_listing[0]["id"]

    def list_gdrive_files(self, folder_id: str | None = None) -> list[dict[str, Any]]:
        """
        List the files in the gdrive folder
        Args:
            folder_id (str): id of the gdrive folder
        Returns:
            list of files in the gdrive folder
        """
        if folder_id is None:
            folder_id = self.get_gdrive_folder_id()

        return self.drive.ListFile({"q": f"'{folder_id}' in parents and trashed=false"}).GetList()

    def download_from_gdrive(self, file_id: str, local_path: str, overwrite: bool = False) -> str:
        """
        Download the file from the gdrive folder
        Args:
            file_id (str): id of the file to download
            local_path (str): path to download the file to
            overwrite (bool, optional): whether to overwrite the file if it already exists [default: False]
        Returns:
            str: path to the downloaded file
        """
        # Create parent directory if it doesn't exist
        parent_dir = os.path.dirname(local_path)
        if parent_dir and not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)

        # Skip if the file already exists
        if os.path.exists(local_path) and not overwrite:
            self.logger.info(f"File {local_path} already exists, skipping download")
            return

        self.logger.info(f"Downloading file {file_id} to {local_path}")

        file = self.drive.CreateFile({"id": file_id})
        file.GetContentFile(local_path)

        return file_id

    def download_all_from_gdrive(self, output_dir: str | None = None, overwrite: bool = False) -> list[dict[str, Any]]:
        """
        Download all the files from the gdrive folder
        Args:
            output_dir (str | None, optional): path to download the files to. Defaults to self.temp_local_folder.
            overwrite (bool, optional): whether to overwrite the files if they already exist [default: False]
        Returns:
            list[dict[str, Any]]: files in the gdrive folder
        """
        if output_dir is None:
            output_dir = self.temp_local_folder

        files = self.list_gdrive_files()
        pbar = tqdm(files, desc=f"Downloading files from gdrive folder {self.gdrive_folder}", leave=False)
        files = []
        for file in pbar:
            file_name = file["title"]
            output_path = os.path.join(output_dir, file_name)
            pbar.set_description(f"Downloading file: {file_name}")
            self.download_from_gdrive(file["id"], output_path, overwrite)
            files.append(file)
        return files

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
            list[str]: paths to the uploaded files
        """
        if output_dir is None:
            output_dir = self.temp_local_folder

        files = os.listdir(output_dir)
        pbar = tqdm(files, desc=f"Uploading files to aws bucket s3://{self.aws_bucket}", leave=False)
        for file in pbar:
            file_path = os.path.join(output_dir, file)
            pbar.set_description(f"Uploading file: {file}")
            self.upload_to_aws(file_path, overwrite)

    def transfer_gdrive_file_to_aws(
        self,
        file_id: str,
        file_name: str,
        overwrite: bool = False,
        delete_from_gdrive: bool = False,
        delete_from_local: bool = False,
    ):
        """
        Transfer the file from the gdrive folder to the aws bucket
        Args:
            file_id (str): id of the file to transfer
            file_name (str): name of the file to transfer
            overwrite (bool, optional): whether to overwrite the file if it already exists [default: False]
            delete_from_gdrive (bool, optional): whether to delete the file from the gdrive folder after uploading [default: False]
            delete_from_local (bool, optional): whether to delete the file from the local folder after uploading [default: False]
        Returns:
            str: name of the uploaded file
        """
        # Check if the file already exists in the aws bucket
        if not overwrite and self.check_if_s3_key_exists(file_name):
            self.logger.info(f"File {file_name} already exists, skipping transfer")
            return

        if not os.path.exists(self.temp_local_folder):
            os.makedirs(self.temp_local_folder, exist_ok=True)

        local_path = os.path.join(self.temp_local_folder, file_name)
        self.download_from_gdrive(file_id, local_path, overwrite)
        if not os.path.exists(local_path):
            raise FileNotFoundError(f"File {file_name} not found in gdrive folder {self.gdrive_folder}")

        self.upload_to_aws(local_path, overwrite)
        # Verify that the file exists in the aws bucket (only check if delete_from_gdrive is True)
        if delete_from_gdrive and not self.check_if_s3_key_exists(file_name):
            raise FileNotFoundError(f"File {file_name} not found in aws bucket {self.aws_bucket}")

        if delete_from_gdrive:
            self.drive.CreateFile({"id": file_id}).Delete()
            self.logger.info(f"Deleted file {file_name} from gdrive folder {self.gdrive_folder}")

        if delete_from_local:
            os.remove(local_path)
            self.logger.info(f"Deleted local file {local_path}")

    def transfer_gdrive_to_aws(
        self, overwrite: bool = False, delete_from_gdrive: bool = False, delete_from_local: bool = False
    ):
        """
        Transfer the gdrive folder to the aws bucket
        Args:
            overwrite (bool, optional): whether to overwrite the files if they already exist [default: False]
            delete_from_gdrive (bool, optional): whether to delete the files from the gdrive folder after uploading [default: False]
        """
        files = self.list_gdrive_files()
        pbar = tqdm(
            files,
            desc=f"Transferring files from gdrive folder {self.gdrive_folder} to aws bucket {self.aws_bucket}",
            leave=False,
        )
        for file in pbar:
            file_name = file["title"]
            pbar.set_description(f"Transferring: {file_name}")
            self.transfer_gdrive_file_to_aws(file["id"], file_name, overwrite, delete_from_gdrive, delete_from_local)
        self.logger.info(
            f"Transferred {len(files)} files from gdrive folder {self.gdrive_folder} to aws bucket {self.aws_bucket}"
        )
