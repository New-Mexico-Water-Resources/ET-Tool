import logging
from datetime import datetime
from os import makedirs
from os.path import splitext, basename, join, exists
from pathlib import Path
from tkinter import Tk, Text
from matplotlib import pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from tkinter.scrolledtext import ScrolledText

import time
from PIL import Image
import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob

import cl
from .file_path_source import FilepathSource
from .ROI_area import ROI_area
from .calculate_percent_nan import calculate_percent_nan
from .constants import WGS84, START_MONTH, END_MONTH, START_YEAR, END_YEAR
from .data_source import DataSource
from .display_image_tk import display_image_tk

# from .display_text_tk import display_text_tk
from .generate_figure import generate_figure
from .generate_stack import generate_stack
from .process_monthly import process_monthly
from .process_year import process_year
from .write_status import write_status
from .pdf_report_generator import generate_metric_report, generate_imperial_report

logger = logging.getLogger(__name__)


def water_rights(
    ROI,
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
    ROI_base = splitext(basename(ROI))[0]
    DEFAULT_FIGURE_DIRECTORY = Path(f"{output_directory}/figures/{ROI_base}")
    DEFAULT_SUBSET_DIRECTORY = Path(f"{output_directory}/subset/{ROI_base}")
    DEFAULT_NAN_SUBSET_DIRECTORY = Path(f"{output_directory}/nan_subsets/{ROI_base}")
    DEFAULT_MONTHLY_DIRECTORY = Path(f"{output_directory}/monthly/{ROI_base}")
    DEFAULT_STACK_DIRECTORY = Path(f"{output_directory}/stack/{ROI_base}")
    DEFAULT_MONTHLY_NAN_DIRECTORY = Path(f"{output_directory}/monthly_nan/{ROI_base}")
    DEFAULT_MONTHLY_MEANS_DIRECTORY = Path(f"{output_directory}/monthly_means/{ROI_base}")

    if ROI_name is None:
        ROI_name = splitext(basename(ROI))[0]

    if working_directory is None:
        working_directory = ROI_name

    if output_directory is None:
        output_directory = working_directory

    if input_datastore is None and input_directory is not None:
        input_datastore = FilepathSource(directory=input_directory)

    if remove_working_directory is None:
        remove_working_directory = True

    if subset_directory is None:
        subset_directory = join(working_directory, DEFAULT_SUBSET_DIRECTORY)

    if nan_subset_directory is None:
        nan_subset_directory = join(working_directory, DEFAULT_NAN_SUBSET_DIRECTORY)

    if monthly_sums_directory is None:
        monthly_sums_directory = join(working_directory, DEFAULT_MONTHLY_DIRECTORY)

    if stack_directory is None:
        stack_directory = join(working_directory, DEFAULT_STACK_DIRECTORY)

    if monthly_means_directory is None:
        monthly_means_directory = join(working_directory, DEFAULT_MONTHLY_MEANS_DIRECTORY)

    if monthly_nan_directory is None:
        monthly_nan_directory = join(working_directory, DEFAULT_MONTHLY_NAN_DIRECTORY)

    if figure_directory is None:
        figure_directory = DEFAULT_FIGURE_DIRECTORY

    if target_CRS is None:
        target_CRS = WGS84

    str_time = datetime.now().strftime("%H%M")

    write_status(message=f"Start Time:{str_time}\n", status_filename=status_filename, text_panel=text_panel, root=root)

    year_range = start_year if start_year == end_year else f"{start_year} - {end_year}"

    write_status(
        message=f"Generating ET for {ROI_name}:\n{year_range}\n",
        status_filename=status_filename,
        text_panel=text_panel,
        root=root,
    )

    logger.info(f"ROI name: {ROI_name}")
    logger.info(f"loading ROI: {ROI}")
    ROI_latlon = gpd.read_file(ROI).to_crs(WGS84).geometry[0]
    ROI_for_nan = list((gpd.read_file(ROI).to_crs(WGS84)).geometry)
    ROI_acres = round(ROI_area(ROI, working_directory), 2)

    years_available, dates_available = input_datastore.inventory()
    monthly_means = []

    if start_year is None:
        start_year = sorted(years_available)[0]

    if end_year is None:
        end_year = sorted(years_available)[-1]

    if start_year == end_year:
        years_x = [start_year]
    else:
        years_x = [*range(int(start_year), int(end_year) + 1)]

    for i, year in enumerate(years_x):
        year_start_time = time.time()

        monthly_means_df = process_year(
            year=year,
            dates_available=dates_available,
            ROI=ROI,
            ROI_latlon=ROI_latlon,
            ROI_acres=ROI_acres,
            ROI_for_nan=ROI_for_nan,
            input_datastore=input_datastore,
            input_directory=input_directory,
            output_directory=output_directory,
            start_year=start_year,
            end_year=end_year,
            start_month=start_month,
            end_month=end_month,
            ROI_name=ROI_name,
            figure_directory=figure_directory,
            working_directory=working_directory,
            subset_directory=subset_directory,
            nan_subset_directory=nan_subset_directory,
            stack_directory=stack_directory,
            monthly_sums_directory=monthly_sums_directory,
            monthly_means_directory=monthly_means_directory,
            monthly_nan_directory=monthly_nan_directory,
            target_CRS=target_CRS,
            remove_working_directory=remove_working_directory,
            root=root,
            text_panel=text_panel,
            image_panel=image_panel,
            status_filename=status_filename,
            debug=debug,
            requestor=requestor,
            use_stack=use_stack,
        )

        monthly_means.append(monthly_means_df)

        year_end_time = time.time()
        total_year_time = (year_end_time - year_start_time) / 60

        write_status(
            message=f"Process Year Run Time: {total_year_time} minutes\n\n",
            status_filename=status_filename,
            text_panel=text_panel,
            root=root,
        )

    generate_metric_report(figure_directory, ROI_name, status_filename, text_panel, root)
    generate_imperial_report(figure_directory, ROI_name, status_filename, text_panel, root)

    str_time = datetime.now().strftime("%H%M")

    write_status(message=f"End Time:{str_time}\n", status_filename=status_filename, text_panel=text_panel, root=root)
