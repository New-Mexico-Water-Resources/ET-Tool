import logging
from datetime import datetime
from os.path import join, exists, splitext, basename
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from .generate_figure import generate_figure
from .ROI_area import ROI_area
import geopandas as gpd
from .constants import WGS84

logger = logging.getLogger(__name__)


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
    vmin = None
    vmax = None
    for file in Path(monthly_means_directory).glob("*.csv"):
        year_df = pd.read_csv(file)
        if "ET" not in year_df.columns:
            logger.warning(f"'ET' not in column names for {file}. Excluding from min/max calculation.")
            continue
        year_mean = np.nanmean(year_df["ET"])
        year_sd = np.nanstd(year_df["ET"])
        year_vmin = max(year_mean - 2 * year_sd, 0)
        year_vmax = year_mean + 2 * year_sd
        vmin = year_vmin if vmin is None else min(vmin, year_vmin)
        vmax = year_vmax if vmax is None else max(vmax, year_vmax)

    # Generate figures for each year
    years = range(start_year, end_year + 1)
    for year in years:
        # Prepare main_df
        if exists(f"{monthly_nan_directory}/{year}.csv"):
            nd = pd.read_csv(f"{monthly_nan_directory}/{year}.csv")
        else:
            nd = pd.DataFrame(columns=["year", "month", "percent_nan"])

        mm = pd.read_csv(f"{monthly_means_directory}/{year}_monthly_means.csv")
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

        # Generate both metric and imperial figures
        figure_filename = join(figure_directory, f"{year}_{ROI_name}.png")
        for metric_units in [True, False]:
            logger.info(f"generating figure for year {year} ROI {ROI_name} metric_units: {metric_units}")
            generate_figure(
                ROI_name=ROI_name,
                ROI_latlon=ROI_latlon,
                ROI_acres=ROI_acres,
                creation_date=creation_date,
                year=year,
                vmin=vmin,
                vmax=vmax,
                affine=affine,
                main_df=main_df,
                monthly_sums_directory=monthly_sums_directory,
                figure_filename=figure_filename,
                start_month=start_month,
                end_month=end_month,
                status_filename=status_filename,
                requestor=requestor,
                metric_units=metric_units,
            )
