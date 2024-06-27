from datetime import date
from logging import getLogger
from os.path import exists
from typing import Union

import geopandas as gpd
import numpy as np
import rasterio
from affine import Affine
from rasterio.warp import reproject
from rasterio.windows import Window
from rasterio.windows import transform as window_transform
from shapely import Point

import raster as rt
from raster import Raster, RasterGrid

import cl
from .constants import WGS84, CELL_SIZE_DEGREES
from .data_source import DataSource
from .errors import BlankOutput
from .select_tiles import select_tiles
from .colors import ET_COLORMAP

logger = getLogger(__name__)


def generate_subset(
    input_datastore: DataSource,
    acquisition_date: Union[date, str],
    ROI_name: str,
    ROI_latlon,
    ROI_acres: float,
    variable_name: str,
    subset_filename: str,
    cell_size: float = None,
    buffer_size: float = None,
    target_CRS: str = None,
    # allow_blank: bool = True) -> (np.ndarray, Affine):
    allow_blank: bool = True,
    output_padding_percentage: float = 0.25,
) -> Raster:
    """
    This function generates a subset of a raster based on a region of interest (ROI).

    Parameters:
    raster_directory (str): The directory where the raster files are located.
    ROI_latlon (Polygon): The region of interest in latitude and longitude coordinates.
    ROI_acres (float): The size of the region of interest in acres.
    variable_name (str): The name of the variable to be subsetted.
    subset_filename (str): The filename for the output subset.
    cell_size (float, optional): The cell size for the output raster. Defaults to None.
    buffer_size (float, optional): The buffer size for the output raster. Defaults to None.
    target_CRS (str, optional): The coordinate reference system for the output raster. Defaults to None.
    allow_blank (bool, optional): Whether to allow blank output. Defaults to True.
    output_padding_percentage (float, optional): Percentage of padding around the ROI relative to max side length to add to the output raster. Defaults to 0.25.

    Returns:
    np.ndarray: The subsetted raster.
    Affine: The affine transformation for the subsetted raster.
    """
    logger.info(f"generating {variable_name} subset")

    # Make square bounding box around ROI with even size and treat this as the ROI to adjust for buffer size
    # and compensate for weird polygons

    # roi_size = round(ROI_acres, 2)

    # if roi_size <= 4:
    #     buffer_degrees = 0.005
    # elif 4 < roi_size <= 10:
    #     buffer_degrees = 0.005
    # elif 10 < roi_size <= 30:
    #     roi_filter = roi_size / 4
    #     buffer_degrees = roi_filter / 1000
    # elif 30 < roi_size <= 60:
    #     roi_filter = roi_size / 6
    #     buffer_degrees = roi_filter / 1000
    # else:
    #     roi_filter = roi_size / 8
    #     buffer_degrees = roi_filter / 1000

    if cell_size is None:
        cell_size = CELL_SIZE_DEGREES

    # if buffer_size is None:
    #     buffer_size = buffer_degrees

    if target_CRS is None:
        target_CRS = WGS84

    if exists(subset_filename):
        logger.info(f"loading existing {cl.name(variable_name)} subset file: {cl.file(subset_filename)}")
        subset = Raster.open(subset_filename)

        return subset

        # with rasterio.open(subset_filename, "r") as f:
        #     subset = f.read(1)
        #     affine = f.transform

        # return subset, affine

    tiles = select_tiles(ROI_latlon)

    if len(tiles) == 0:
        logger.warning(f"no tiles found for date {acquisition_date} variable {variable_name} ROI {ROI_name}")

    logger.info(
        f"generating subset for date {cl.time(acquisition_date)} variable {cl.name(variable_name)} ROI {cl.name(ROI_name)} from tiles: {', '.join(tiles)}"
    )
    ROI_projected = gpd.GeoDataFrame({}, geometry=[ROI_latlon], crs=WGS84).to_crs(target_CRS).geometry[0]
    # centroid = ROI_projected.centroid
    # x_min = centroid.x - buffer_size
    # x_max = centroid.x + buffer_size
    # y_min = centroid.y - buffer_size
    # y_max = centroid.y + buffer_size

    centroid = ROI_projected.centroid
    x_min, y_min, x_max, y_max = ROI_projected.bounds
    width = x_max - x_min
    height = y_max - y_min

    max_side = max(width, height)

    zoom_padding = max_side * output_padding_percentage
    padding = max_side / 2 + zoom_padding

    x_min = centroid.x - padding
    x_max = centroid.x + padding
    y_min = centroid.y - padding
    y_max = centroid.y + padding

    target_affine = Affine(cell_size, 0, x_min, 0, -cell_size, y_max)

    width_meters = x_max - x_min
    target_cols = int(width_meters / cell_size)
    height_meters = y_max - y_min
    target_rows = int(height_meters / cell_size)

    target_geometry = RasterGrid.from_affine(affine=target_affine, rows=target_rows, cols=target_cols, crs=target_CRS)

    target_raster = None

    for tile in tiles:
        with input_datastore.get_filename(
            tile=tile, variable_name=variable_name, acquisition_date=acquisition_date
        ) as input_filename:
            tile_raster = Raster.open(input_filename, geometry=target_geometry, cmap=ET_COLORMAP)

        if target_raster is None:
            target_raster = tile_raster
        else:
            target_raster = rt.where(np.isnan(target_raster), tile_raster, target_raster)

    if not allow_blank and np.all(np.isnan(target_raster)):
        raise BlankOutput(
            f"blank output raster for date {acquisition_date} variable {variable_name} ROI {ROI_name} from tiles: {', '.join(tiles)}"
        )

    if not exists(subset_filename):
        logger.info("writing subset: {}".format(subset_filename))
        target_raster.to_geotiff(subset_filename)

    return target_raster
