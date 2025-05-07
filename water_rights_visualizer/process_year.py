import sys
import logging
from datetime import datetime
from os import makedirs
from os.path import splitext, basename, join, exists, dirname
from pathlib import Path
from tkinter import Tk, Text
from tkinter.scrolledtext import ScrolledText

import geopandas as gpd
import numpy as np
import pandas as pd

import cl
from .file_path_source import FilepathSource
from .ROI_area import ROI_area
from .calculate_percent_nan import calculate_percent_nan
from .calculate_cloud_coverage_percent import calculate_cloud_coverage_percent
from .constants import WGS84, START_MONTH, END_MONTH, START_YEAR, END_YEAR
from .data_source import DataSource
from .display_image_tk import display_image_tk

# from .display_text_tk import display_text_tk
from .generate_figure import generate_figure
from .generate_stack import generate_stack
from .process_monthly import process_monthly
from .write_status import write_status
from .variable_types import get_available_variable_source_for_date
from .figure_generator import generate_all_figures

logger = logging.getLogger(__name__)


def generate_monthly_means_df(monthly_means_directory: str, year: int):
    month_means = []
    mm = pd.read_csv(f"{monthly_means_directory}/{year}_monthly_means.csv")
    month_means.append(mm)
    return pd.concat(month_means, axis=0)


def process_year(
    year: int,
    dates_available,
    ROI,
    ROI_latlon,
    ROI_acres,
    ROI_for_nan,
    input_datastore: DataSource = None,
    output_directory: str = None,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    start_month: int = START_MONTH,
    end_month: int = END_MONTH,
    ROI_name: str = None,
    input_directory: str = None,
    figure_directory: str = None,
    working_directory: str = None,
    subset_directory: str = None,
    nan_subset_directory: str = None,
    stack_directory: str = None,
    monthly_sums_directory: str = None,
    monthly_means_directory: str = None,
    monthly_nan_directory: str = None,
    target_CRS: str = None,
    remove_working_directory: bool = True,
    root: Tk = None,
    image_panel: Text = None,
    text_panel: ScrolledText = None,
    status_filename: str = None,
    debug: bool = False,
    requestor: dict[str, str] = None,
    use_stack: bool = False,
):
    logger.info(f"processing year {cl.time(year)} at ROI {cl.name(ROI_name)}")
    message = f"processing: {year}"

    # Skip year if we've already generated the figure and monthly means
    figure_filename = join(figure_directory, f"{year}_{ROI_name}.png")
    monthly_means_filename = join(monthly_means_directory, f"{year}_monthly_means.csv")
    if exists(figure_filename) and exists(monthly_means_filename):
        logger.info(f"figure already exists: {cl.file(figure_filename)}, skipping...")
        write_status(
            message=f"figure exists in working directory\n",
            status_filename=status_filename,
            text_panel=text_panel,
            root=root,
        )

        return generate_monthly_means_df(monthly_means_directory, year)

    write_status(message=f"{message}\n", status_filename=status_filename, text_panel=text_panel, root=root)

    stack_filename = join(stack_directory, f"{year:04d}_{ROI_name}_stack.h5")

    daily_interpolation = True
    variable_source = get_available_variable_source_for_date("ET", datetime(year, 1, 1).date())
    if variable_source and variable_source.monthly:
        daily_interpolation = False

    try:
        if use_stack:
            write_status(
                message == f"loading stack: {stack_filename}\n",
                status_filename=status_filename,
                text_panel=text_panel,
                root=root,
            )

        ET_stack, PET_stack, affine = generate_stack(
            ROI_name=ROI_name,
            ROI_latlon=ROI_latlon,
            year=year,
            ROI_acres=ROI_acres,
            input_datastore=input_datastore,
            subset_directory=subset_directory,
            dates_available=dates_available,
            stack_filename=stack_filename,
            target_CRS=target_CRS,
            use_stack=use_stack,
            daily_interpolation=daily_interpolation,
        )
    except Exception as e:
        logger.exception(e)
        logger.warning(f"unable to generate stack for year {cl.time(year)} at ROI {cl.name(ROI_name)}")

        if debug:
            sys.exit(1)

        return None

    monthly_means_df = process_monthly(
        ET_stack=ET_stack,
        PET_stack=PET_stack,
        ROI_latlon=ROI_latlon,
        ROI_name=ROI_name,
        subset_affine=affine,
        CRS=target_CRS,
        year=year,
        start_month=start_month,
        end_month=end_month,
        monthly_sums_directory=monthly_sums_directory,
        monthly_means_directory=monthly_means_directory,
        daily_interpolation=daily_interpolation,
    )

    write_status(message="Calculating uncertainty\n", status_filename=status_filename, text_panel=text_panel, root=root)

    # Check the variable to see if it's monthly
    variable_source = get_available_variable_source_for_date("ET", datetime(year, 1, 1).date())
    if variable_source and variable_source.monthly:
        logger.info(f"ET variable is monthly, calculating cloud coverage percent for year {year}")
        calculate_cloud_coverage_percent(ROI_for_nan, subset_directory, nan_subset_directory, monthly_nan_directory, year)
    else:
        logger.info(f"ET variable is not monthly, calculating percent nan for year {year}")
        calculate_percent_nan(ROI_for_nan, subset_directory, nan_subset_directory, monthly_nan_directory, year)

    write_status(message="Generating figure\n", status_filename=status_filename, text_panel=text_panel, root=root)

    # Generate figures for this year
    generate_all_figures(
        ROI_name=ROI_name,
        ROI=ROI,
        output_directory=output_directory,
        start_year=year,
        end_year=year,
        start_month=start_month,
        end_month=end_month,
        status_filename=status_filename,
        requestor=requestor,
    )

    logger.info(f"finished processing year {year}")
    return monthly_means_df
