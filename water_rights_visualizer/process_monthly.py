import logging
from os import makedirs
from os.path import join, exists
from datetime import datetime, timedelta
import numpy as np
from shapely.geometry import Polygon
import pandas as pd
from affine import Affine
import rasterio
from rasterio.features import geometry_mask
from dateutil.relativedelta import relativedelta
from .date_helpers import get_one_month_slice

import raster as rt

from .constants import START_MONTH, END_MONTH

logger = logging.getLogger(__name__)


def process_monthly(
    ET_stack: np.ndarray,
    PET_stack: np.ndarray,
    ROI_latlon: Polygon,
    ROI_name: str,
    subset_affine: Affine,
    CRS: str,
    year: int,
    monthly_sums_directory: str,
    monthly_means_directory: str,
    start_month: int = START_MONTH,
    end_month: int = END_MONTH,
) -> pd.DataFrame:
    """
    Process monthly values for a given year and generate monthly means.

    Args:
        ET_stack (np.ndarray): Array of ET values for each day of the year.
        PET_stack (np.ndarray): Array of PET values for each day of the year.
        ROI_latlon (Polygon): Polygon representing the region of interest.
        ROI_name (str): Name of the region of interest.
        subset_affine (Affine): Affine transformation for the subset.
        CRS (str): Coordinate reference system.
        year (int): Year for which to process the monthly values.
        monthly_sums_directory (str): Directory to store monthly sum files.
        monthly_means_directory (str): Directory to store monthly means files.

    Returns:
        pd.DataFrame: DataFrame containing the monthly means.
    """
    logger.info("generating monthly means")
    monthly_means_filename = join(monthly_means_directory, f"{year}_monthly_means.csv")

    if exists(monthly_means_filename):
        logger.info(f"loading monthly means: {monthly_means_filename}")
        monthly_means_df = pd.read_csv(monthly_means_filename)
    else:
        days, rows, cols = ET_stack.shape
        subset_shape = (rows, cols)
        logger.info("rasterizing ROI")
        mask = geometry_mask([ROI_latlon], subset_shape, subset_affine, invert=True)

        logger.info(f"processing monthly values for year: {year}")
        monthly_means = []

        for j, month in enumerate(range(start_month, end_month + 1)):
            logger.info(f"processing monthly values for month {month} year {year}")
            if not exists(monthly_sums_directory):
                makedirs(monthly_sums_directory)

            ET_monthly_filename = join(monthly_sums_directory, f"{year:04d}_{month:02d}_{ROI_name}_ET_monthly_sum.tif")

            start_index, end_index = get_one_month_slice(year, month)
            ET_month_stack = ET_stack[start_index:end_index, :, :]
            ET_monthly = np.nansum(ET_month_stack, axis=0)

            logger.info(f"writing monthly ET: {ET_monthly_filename}, avg: {ET_monthly.mean()}")
            subset_geometry = rt.RasterGrid.from_affine(subset_affine, rows, cols, CRS)
            ET_monthly_raster = rt.Raster(array=ET_monthly, geometry=subset_geometry)
            ET_monthly_raster.to_geotiff(ET_monthly_filename)

            PET_monthly_filename = join(monthly_sums_directory, f"{year:04d}_{month:02d}_{ROI_name}_PET_monthly_sum.tif")

            PET_month_stack = PET_stack[start_index:end_index, :, :]
            PET_monthly = np.nansum(PET_month_stack, axis=0)

            logger.info(f"writing monthly PET: {PET_monthly_filename}, avg: {PET_monthly.mean()}")
            subset_geometry = rt.RasterGrid.from_affine(subset_affine, rows, cols, CRS)
            PET_monthly_raster = rt.Raster(array=PET_monthly, geometry=subset_geometry)
            PET_monthly_raster.to_geotiff(PET_monthly_filename)

            ET_values = np.array(ET_monthly[mask]).flatten()
            PET_values = np.array(PET_monthly[mask]).flatten()

            ET_monthly_mean = np.nanmean(ET_values) if len(ET_values) > 0 else 0
            PET_monthly_mean = np.nanmean(PET_values) if len(PET_values) > 0 else 0

            # Remove mask from the mean calculation if we don't have any (small ROI). This is ONLY done for PET as this is an upper bound
            # and PET is lower resolution for later years
            if PET_monthly_mean == 0:
                logger.warning(
                    f"Monthly PET mean is zero for year {year}, month {month}. Expanding the mask to include the full subset."
                )
                PET_monthly_mean = np.nanmean(np.array(PET_monthly).flatten()) or 0
                logger.info(f"New PET monthly mean: {PET_monthly_mean}, PET value count: {len(PET_values)}")

            monthly_means.append([year, month, ET_monthly_mean, PET_monthly_mean])

        if not exists(monthly_means_directory):
            makedirs(monthly_means_directory)

        monthly_means_df = pd.DataFrame(monthly_means, columns=["Year", "Month", "ET", "PET"])
        logger.info(f"writing monthly means: {monthly_means_filename}")
        monthly_means_df.to_csv(monthly_means_filename)

    return monthly_means_df
