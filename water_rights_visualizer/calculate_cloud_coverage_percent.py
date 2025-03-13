from typing import Union
from os import makedirs, listdir, remove
from os.path import exists, isfile, join, basename, splitext
from glob import glob
import csv
import numpy as np
import pandas as pd
from shapely.geometry import Polygon
import rasterio
from rasterio.mask import mask, raster_geometry_mask
from logging import getLogger
import re
import datetime

logger = getLogger(__name__)

NUMBER_OF_MODELS = 6


def get_days_in_month(year, month):
    # Calculate the first day of the next month
    if month == 12:
        next_month = datetime.date(year + 1, 1, 1)
    else:
        next_month = datetime.date(year, month + 1, 1)

    # Subtract one day to get the last day of the current month
    last_day_of_month = next_month - datetime.timedelta(days=1)

    return last_day_of_month.day


def get_nan_tiff_roi_average(tiff_file, ROI_geometry, dir) -> Union[float, None]:
    """
    Get the average of the non-NaN values in the subset file within the given directory.

    Args:
        tiff_file (str): The subset file to calculate the average of non-NaN values.
        ROI_geometry (Polygon): The region of interest polygon used for masking the subset files.
        dir (str): The directory containing the subset files.

    Returns:
        Union[float, None]: The average of the non-NaN values in the subset file or None if an error occurs.
    """
    filename = basename(tiff_file)

    if not tiff_file or not exists(tiff_file):
        logger.error(f"File '{tiff_file}' does not exist")
        return None

    nan_masked_subset_file = None
    with rasterio.open(tiff_file) as subset_tiles:
        # Masking the ET subset file with the ROI_for_nan polygon
        out_image, out_transform = mask(subset_tiles, ROI_geometry, crop=False)
        out_meta = subset_tiles.meta.copy()
        out_meta.update(
            {
                "driver": "GTiff",
                "height": out_image.shape[1],
                "width": out_image.shape[2],
                "transform": out_transform,
            }
        )
        nan_masked_subset_file = splitext(dir + "/" + basename(subset_tiles.name))[0] + "_nan.tif"
        # Saving the masked subset as a new file in the nan_subset_directory
        with rasterio.open(nan_masked_subset_file, "w", **out_meta) as dest:
            dest.write(out_image)

    if not nan_masked_subset_file:
        logger.error(f"Failed to create nan masked subset file for {filename}")
        return None

    with rasterio.open(nan_masked_subset_file) as src:
        data = src.read(1)
        data = data[data != src.nodata]
        data = data[~np.isnan(data)]
        return np.mean(data)


def calculate_cloud_coverage_percent(
    ROI_geometry: Polygon, subset_directory: str, nan_subset_directory: str, monthly_nan_directory: str
):
    """
    Calculate the percentage of NaN values in each subset file within the given directory based on CCOUNT data.

    Args:
        ROI_geometry (Polygon): The region of interest polygon used for masking the subset files.
        year (int): The year for which to calculate the cloud coverage percentage.
        monthly_nan_directory (str): The directory to save the monthly average NaN values.

    Returns:
        None
    """
    if not exists(monthly_nan_directory):
        makedirs(monthly_nan_directory)

    if not exists(nan_subset_directory):
        makedirs(nan_subset_directory)

    yearly_ccount_percentages = {}

    year_month = {}
    uncertainty_variables = ["ET_MIN", "ET_MAX", "COUNT", "PPT"]
    for variable in uncertainty_variables:
        subset_files = glob(f"{subset_directory}/*_{variable}_subset.tif")
        for subset_file in subset_files:
            filename = basename(subset_file)
            match = re.match(rf"(\d{{4}})\.(\d{{2}})\.(\d{{2}}).*_{variable}_subset\.tif", filename)
            year = match.group(1)
            month = match.group(2)
            key = f"{year}-{month}"
            if not year_month.get(key):
                year_month[key] = {"year": year, "month": month}
            year_month[key][variable] = subset_file

    for key, variable_files in year_month.items():
        year = variable_files["year"]
        month = variable_files["month"]

        ccount_subset_file = variable_files.get("COUNT", "")
        et_min_subset_file = variable_files.get("ET_MIN", "")
        et_max_subset_file = variable_files.get("ET_MAX", "")
        ppt_subset_file = variable_files.get("PPT", "")

        if not yearly_ccount_percentages.get(year):
            yearly_ccount_percentages[year] = {}

        days_in_month = get_days_in_month(int(year), int(month))

        ccount_average = get_nan_tiff_roi_average(ccount_subset_file, ROI_geometry, nan_subset_directory)
        if ccount_average is None:
            logger.error(f"Failed to calculate cloud coverage percentage for {year}-{month} ({ccount_subset_file})")

        et_min_average = get_nan_tiff_roi_average(et_min_subset_file, ROI_geometry, nan_subset_directory)
        if et_min_average is None:
            logger.error(f"Failed to calculate ET min average for {year}-{month} ({et_min_subset_file})")

        et_max_average = get_nan_tiff_roi_average(et_max_subset_file, ROI_geometry, nan_subset_directory)
        if et_max_average is None:
            logger.error(f"Failed to calculate ET max average for {year}-{month} ({et_max_subset_file})")

        ppt_average = get_nan_tiff_roi_average(ppt_subset_file, ROI_geometry, nan_subset_directory)
        if ppt_average is None:
            logger.error(f"Failed to calculate PPT average for {year}-{month} ({ppt_subset_file})")

        yearly_ccount_percentages[year][month] = {
            "avg_cloud_count": ccount_average,
            "days_in_month": days_in_month,
            "avg_min": et_min_average,
            "avg_max": et_max_average,
            "ppt_avg": ppt_average,
        }

    for year, month_percentages in yearly_ccount_percentages.items():
        # If there's already a CSV file for the year, fill that in, but prefer the new data
        monthly_ccount_percent_csv = f"{monthly_nan_directory}/{year}.csv"
        existing_nan_percent_csv = None
        if exists(monthly_ccount_percent_csv):
            existing_nan_percent_csv = pd.read_csv(monthly_ccount_percent_csv)

        monthly_ccount = pd.DataFrame(columns=["year", "month", "percent_nan", "avg_min", "avg_max", "ppt_avg"])
        for month in range(1, 13):
            # Pad month with 0 if less than 10
            month_key = f"{month:02d}"
            percentages = month_percentages.get(month_key, {})

            percentage = None
            if percentages and percentages.get("avg_cloud_count") is not None and percentages.get("days_in_month"):
                percentage = (percentages["days_in_month"] - percentages["avg_cloud_count"]) / percentages["days_in_month"]
            if percentage is None and existing_nan_percent_csv is not None:
                existing_row = existing_nan_percent_csv.loc[existing_nan_percent_csv["month"] == month_key]
                if not existing_row.empty:
                    percentage = existing_row["percent_nan"].values[0]

            if percentage is None:
                percentage = 1

            rounded_percentage = round(percentage * 100, 2)
            avg_min = percentages.get("avg_min") or 0
            avg_max = percentages.get("avg_max") or 0
            ppt_avg = percentages.get("ppt_avg") or 0
            rounded_avg_min = round(avg_min, 2)
            rounded_avg_max = round(avg_max, 2)
            rounded_ppt_avg = round(ppt_avg, 2)
            monthly_ccount.loc[len(monthly_ccount)] = [
                str(year),
                month,
                rounded_percentage,
                rounded_avg_min,
                rounded_avg_max,
                rounded_ppt_avg,
            ]

        monthly_ccount.to_csv(monthly_ccount_percent_csv, index=False)
