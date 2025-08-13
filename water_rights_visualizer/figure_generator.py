import logging
from datetime import datetime
from os.path import join, exists, splitext, basename
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from .generate_figure import generate_figure
from .summary_figure_generator import generate_summary_figure
from .ROI_area import ROI_area
import geopandas as gpd
from .constants import WGS84
from .plotting_helpers import MetricETUnit, ImperialETUnit, AcreFeetETUnit

logger = logging.getLogger(__name__)


def calculate_year_bounds(year_df: pd.DataFrame, file: str, variable: str, abs: bool = False) -> tuple[float, float]:
    if variable not in year_df.columns:
        logger.warning(f"'{variable}' not in column names for {file}. Excluding from min/max calculation.")
        return None, None
    if abs:
        # Just get absolute min and max
        year_vmin = np.nanmin(year_df[variable])
        year_vmax = np.nanmax(year_df[variable])
    else:
        # Get mean and 2 standard deviations
        year_mean = np.nanmean(year_df[variable])
        year_sd = np.nanstd(year_df[variable])
        year_vmin = max(year_mean - 2 * year_sd, 0)
        year_vmax = year_mean + 2 * year_sd

    return year_vmin, year_vmax


def generate_all_figures(
    ROI_name: str,
    ROI: str,
    output_directory: str,
    start_year: int,
    end_year: int,
    start_month: int = 1,
    end_month: int = 12,
    status_filename: str = None,
    requestor: dict[str, str] = None,
):
    """
    Generate figures for all years in the specified range, handling both metric and imperial units.
    This function handles all the common setup tasks like calculating vmin/vmax and preparing the data.

    Args:
        ROI_name (str): Base name of the ROI
        ROI (str): Path to the ROI file
        output_directory (str): Directory to save figures
        start_year (int): Start year for figure generation
        end_year (int): End year for figure generation
        start_month (int, optional): Start month. Defaults to 1.
        end_month (int, optional): End month. Defaults to 12.
        status_filename (str, optional): File to write status updates. Defaults to None.
        requestor (dict[str, str], optional): Requestor information. Defaults to None.
    """
    monthly_nan_directory = Path(f"{output_directory}/monthly_nan/{ROI_name}")
    monthly_sums_directory = Path(f"{output_directory}/monthly/{ROI_name}")
    subset_directory = Path(f"{output_directory}/subset/{ROI_name}")
    monthly_means_directory = Path(f"{output_directory}/monthly_means/{ROI_name}")
    figure_directory = Path(f"{output_directory}/figures/{ROI_name}")

    # Read ROI data
    ROI_latlon = gpd.read_file(ROI).to_crs(WGS84).geometry[0]
    ROI_acres = round(ROI_area(ROI, figure_directory), 2)
    creation_date = datetime.today()

    # Calculate vmin and vmax across all years
    et_vmin = None
    et_vmax = None

    # Everything showing on first plot ("ET", "PET", "ET_MIN", "ET_MAX")
    combined_abs_min = None
    combined_abs_max = None

    ppt_min = None
    ppt_max = None

    cloud_cover_min = None
    cloud_cover_max = None

    # Monthly means files contain: Year, Month, ET, PET
    for file in Path(monthly_means_directory).glob("*.csv"):
        year_df = pd.read_csv(file)

        try:
            # if ends with _combined, skip
            if not file.stem.endswith("_combined"):
                current_year = int(file.stem.split("_")[0])
                # Expand the year range if more data is available
                if current_year < start_year:
                    start_year = current_year
                elif current_year > end_year:
                    end_year = current_year
        except (ValueError, IndexError):
            logger.warning(f"Could not parse year from filename: {file.stem}")

        # Get absolute min and max for all variables
        for variable in ["ET", "PET"]:
            year_vmin, year_vmax = calculate_year_bounds(year_df, file, variable, abs=True)
            if year_vmin is None:
                continue
            combined_abs_min = year_vmin if combined_abs_min is None else min(combined_abs_min, year_vmin)
            combined_abs_max = year_vmax if combined_abs_max is None else max(combined_abs_max, year_vmax)

        year_vmin, year_vmax = calculate_year_bounds(year_df, file, "ET")
        # Skip if no ET data
        if year_vmin is None:
            continue
        et_vmin = year_vmin if et_vmin is None else min(et_vmin, year_vmin)
        et_vmax = year_vmax if et_vmax is None else max(et_vmax, year_vmax)

    # Monthly nan files contain: year, month, percent_nan, avg_min (ET_MIN), avg_max (ET_MAX), ppt_avg
    for file in Path(monthly_nan_directory).glob("*.csv"):
        year_df = pd.read_csv(file)

        for variable in ["avg_min", "avg_max"]:
            year_vmin, year_vmax = calculate_year_bounds(year_df, file, variable, abs=True)
            if year_vmin is None:
                continue
            combined_abs_min = year_vmin if combined_abs_min is None else min(combined_abs_min, year_vmin)
            combined_abs_max = year_vmax if combined_abs_max is None else max(combined_abs_max, year_vmax)

        year_ppt_min, year_ppt_max = calculate_year_bounds(year_df, file, "ppt_avg", abs=True)
        ppt_min = year_ppt_min if ppt_min is None else min(ppt_min, year_ppt_min)
        ppt_max = year_ppt_max if ppt_max is None else max(ppt_max, year_ppt_max)

        year_cloud_cover_min, year_cloud_cover_max = calculate_year_bounds(year_df, file, "percent_nan", abs=True)
        if year_cloud_cover_min is not None and not pd.isna(year_cloud_cover_min):
            cloud_cover_min = year_cloud_cover_min if cloud_cover_min is None else min(cloud_cover_min, year_cloud_cover_min)
        if year_cloud_cover_max is not None and not pd.isna(year_cloud_cover_max):
            cloud_cover_max = year_cloud_cover_max if cloud_cover_max is None else max(cloud_cover_max, year_cloud_cover_max)

    # Ensure cloud cover min and max are not NaN
    cloud_cover_min = cloud_cover_min if not pd.isna(cloud_cover_min) else 0
    cloud_cover_max = cloud_cover_max if not pd.isna(cloud_cover_max) else 100

    # Generate figures for each year
    years = range(start_year, end_year + 1)
    for year in years:
        # Prepare main_df
        nd_filename = f"{monthly_nan_directory}/{year}.csv"
        if exists(nd_filename):
            nd = pd.read_csv(nd_filename)
        else:
            nd = pd.DataFrame(columns=["year", "month", "percent_nan", "avg_min", "avg_max"])

        mm_filename = f"{monthly_means_directory}/{year}_monthly_means.csv"
        if exists(mm_filename):
            mm = pd.read_csv(mm_filename)
        else:
            mm = pd.DataFrame(columns=["Year", "Month", "ET", "PET"])

        idx = {"Months": range(start_month, end_month + 1)}
        df1 = pd.DataFrame(idx, columns=["Months"])
        main_dfa = pd.merge(left=df1, right=mm, how="left", left_on="Months", right_on="Month")
        main_df = pd.merge(left=main_dfa, right=nd, how="left", left_on="Months", right_on="month")

        if "Year" not in main_df.columns and "Year_x" in main_df.columns:
            main_df = main_df.rename(columns={"Year_x": "Year"})
        main_df = main_df.replace(np.nan, 100)

        # Get affine transform from subset file
        affine = None
        subsets = Path(subset_directory).glob(f"*_{ROI_name}_ET_subset.tif")
        subsets = list(subsets)
        for file in subsets:
            with rasterio.open(str(file)) as src:
                affine = src.transform
                break

        if affine is None:
            logger.error(f"no subset found for year {year} and ROI {ROI_name}")
            continue

        # Generate figures for all units
        figure_filename = join(figure_directory, f"{year}_{ROI_name}.png")
        for units in [MetricETUnit(), ImperialETUnit(), AcreFeetETUnit(acres=ROI_acres)]:
            logger.info(f"generating figure for year {year} ROI {ROI_name} units: {units}")
            generate_figure(
                ROI_name=ROI_name,
                ROI_latlon=ROI_latlon,
                ROI_acres=ROI_acres,
                creation_date=creation_date,
                year=year,
                et_vmin=et_vmin,
                et_vmax=et_vmax,
                combined_abs_min=combined_abs_min,
                combined_abs_max=combined_abs_max,
                ppt_min=ppt_min,
                ppt_max=ppt_max,
                cloud_cover_min=cloud_cover_min,
                cloud_cover_max=cloud_cover_max,
                affine=affine,
                main_df=main_df,
                monthly_sums_directory=monthly_sums_directory,
                figure_filename=figure_filename,
                start_month=start_month,
                end_month=end_month,
                status_filename=status_filename,
                requestor=requestor,
                units=units,
            )

    # Generate summary figure
    summary_figure_filename = join(figure_directory, f"summary_{ROI_name}.png")
    for units in [MetricETUnit(), ImperialETUnit(), AcreFeetETUnit(acres=ROI_acres)]:
        logger.info(f"generating summary figure for ROI {ROI_name} units: {units}")
        generate_summary_figure(
            ROI_name=ROI_name,
            ROI_acres=ROI_acres,
            creation_date=creation_date,
            start_year=start_year,
            end_year=end_year,
            et_vmin=et_vmin,
            et_vmax=et_vmax,
            combined_abs_min=combined_abs_min,
            combined_abs_max=combined_abs_max,
            ppt_min=ppt_min,
            ppt_max=ppt_max,
            cloud_cover_min=cloud_cover_min,
            cloud_cover_max=cloud_cover_max,
            monthly_means_directory=str(monthly_means_directory),
            monthly_nan_directory=str(monthly_nan_directory),
            figure_filename=summary_figure_filename,
            status_filename=status_filename,
            requestor=requestor,
            units=units,
        )
