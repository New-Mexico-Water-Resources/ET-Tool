#!/usr/bin/env python
# coding: utf-8
import logging
import sys
from os import makedirs, scandir
from os.path import basename, isdir, splitext, abspath, exists, isfile, expanduser, join, dirname
from pathlib import Path

import matplotlib as mpl

import cl
from .water_rights import water_rights
from .constants import *
from .data_source import DataSource
from .file_path_source import FilepathSource
from .google_source import GoogleSource
from .generate_figure import generate_figure

import geopandas as gpd
import numpy as np
import pandas as pd
from datetime import datetime
from .ROI_area import ROI_area
import rasterio
from .write_status import write_status
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib import pyplot as plt
from glob import glob

logger = logging.getLogger(__name__)

mpl.use("Agg")

START_YEAR = 1985
END_YEAR = 2023
START_MONTH = 1
END_MONTH = 12


def water_rights_visualizer(
    boundary_filename: str,
    output_directory: str,
    figure_directory: str = None,
    monthly_means_directory: str = None,
    input_datastore: DataSource = None,
    input_directory: str = None,
    google_drive_temporary_directory: str = None,
    google_drive_key_filename: str = None,
    google_drive_client_secrets_filename: str = None,
    remove_temporary_google_files: bool = None,
    start_year: int = START_YEAR,
    end_year: int = END_YEAR,
    start_month: int = START_MONTH,
    end_month: int = END_MONTH,
    status_filename: str = None,
    debug=False,
    requestor: dict[str, str] = None,
    use_stack: bool = False,
):
    boundary_filename = abspath(expanduser(boundary_filename))
    output_directory = abspath(expanduser(output_directory))

    if not exists(boundary_filename):
        raise IOError(f"boundary filename not found: {boundary_filename}")

    logger.info(f"boundary file: {cl.file(boundary_filename)}")

    if input_datastore is None:
        if google_drive_temporary_directory is not None:
            logger.info(f"using Google Drive data source in directory: {google_drive_client_secrets_filename}")
            input_datastore = GoogleSource(
                temporary_directory=google_drive_temporary_directory,
                key_filename=google_drive_key_filename,
                client_secrets_filename=google_drive_client_secrets_filename,
                remove_temporary_files=remove_temporary_google_files,
            )
        elif input_directory is not None:
            logger.info(f"using local file path data source in directory: {input_directory}")
            input_datastore = FilepathSource(directory=input_directory)
        else:
            raise ValueError("no input data source given")

    makedirs(output_directory, exist_ok=True)
    logger.info(f"output directory: {cl.dir(output_directory)}")

    working_directory = output_directory
    logger.info(f"working directory: {cl.dir(working_directory)}")

    ROI_base = splitext(basename(boundary_filename))[0]
    DEFAULT_ROI_DIRECTORY = Path(f"{boundary_filename}")
    ROI_name = Path(f"{DEFAULT_ROI_DIRECTORY}")

    logger.info(f"target: {cl.place(ROI_name)}")

    ROI = ROI_name
    BUFFER_METERS = 2000
    # BUFFER_DEGREES = 0.001
    CELL_SIZE_DEGREES = 0.0003
    CELL_SIZE_METERS = 30
    TILE_SELECTION_BUFFER_RADIUS_DEGREES = 0.01
    ARD_TILES_FILENAME = join(abspath(dirname(__file__)), "ARD_tiles.geojson")

    if isfile(ROI):
        water_rights(
            ROI,
            input_datastore=input_datastore,
            output_directory=output_directory,
            start_year=start_year,
            end_year=end_year,
            start_month=start_month,
            end_month=end_month,
            ROI_name=None,
            figure_directory=figure_directory,
            working_directory=None,
            subset_directory=None,
            nan_subset_directory=None,
            stack_directory=None,
            monthly_sums_directory=None,
            monthly_means_directory=monthly_means_directory,
            monthly_nan_directory=None,
            target_CRS=None,
            status_filename=status_filename,
            debug=debug,
            requestor=requestor,
            use_stack=use_stack,
        )

    elif isdir(ROI):
        for items in scandir(ROI):
            if items.name.endswith(".geojson"):
                roi_name = abspath(items)
                water_rights(
                    roi_name,
                    input_datastore=input_datastore,
                    output_directory=output_directory,
                    start_year=start_year,
                    end_year=end_year,
                    start_month=start_month,
                    end_month=end_month,
                    ROI_name=None,
                    figure_directory=figure_directory,
                    working_directory=None,
                    subset_directory=None,
                    nan_subset_directory=None,
                    stack_directory=None,
                    monthly_sums_directory=None,
                    monthly_means_directory=monthly_means_directory,
                    monthly_nan_directory=None,
                    target_CRS=None,
                    status_filename=status_filename,
                    debug=debug,
                    requestor=requestor,
                    use_stack=use_stack,
                )
    else:
        logger.warning(f"invalid ROI: {ROI}")

    # Now generate figures
    monthly_nan_directory = Path(f"{output_directory}/monthly_nan/{ROI_base}")
    monthly_sums_directory = Path(f"{output_directory}/monthly/{ROI_base}")
    subset_directory = Path(f"{output_directory}/subset/{ROI_base}")
    monthly_means_directory = Path(f"{output_directory}/monthly_means/{ROI_base}")
    figure_directory = Path(f"{output_directory}/figures/{ROI_base}")

    if start_year == end_year:
        years_x = [start_year]
    else:
        years_x = [*range(int(start_year), int(end_year) + 1)]

    ROI_latlon = gpd.read_file(ROI).to_crs(WGS84).geometry[0]
    ROI_for_nan = list((gpd.read_file(ROI).to_crs(WGS84)).geometry)
    ROI_acres = round(ROI_area(ROI, working_directory), 2)
    creation_date = datetime.today()

    # month_means = []
    # mm = pd.read_csv(f"{monthly_means_directory}/{year}_monthly_means.csv")
    # month_means.append(mm)

    # idx = {"Months": range(start_month, end_month + 1)}
    # df1 = pd.DataFrame(idx, columns=["Months"])

    # main_dfa = pd.merge(left=df1, right=mm, how="left", left_on="Months", right_on="Month")
    # main_df = pd.merge(left=main_dfa, right=nd, how="left", left_on="Months", right_on="month")

    # if "Year" not in main_df.columns and "Year_x" in main_df.columns:
    #     main_df = main_df.rename(columns={"Year_x": "Year"})

    # main_df = main_df.replace(np.nan, 100)
    # monthly_means_df = pd.concat(month_means, axis=0)
    # mean = np.nanmean(monthly_means_df["ET"])
    # sd = np.nanstd(monthly_means_df["ET"])

    # # Min/Max for this year
    # vmin = max(mean - 2 * sd, 0)
    # vmax = mean + 2 * sd
    vmin = None
    vmax = None

    # Min/max for all years
    for file in Path(monthly_means_directory).glob("*.csv"):
        year_df = pd.read_csv(file)
        year_mean = np.nanmean(year_df["ET"])
        year_sd = np.nanstd(year_df["ET"])

        year_vmin = max(year_mean - 2 * year_sd, 0)
        year_vmax = year_mean + 2 * year_sd

        vmin = year_vmin if vmin is None else min(vmin, year_vmin)
        vmax = year_vmax if vmax is None else max(vmax, year_vmax)

    for i, year in enumerate(years_x):
        if exists(f"{monthly_nan_directory}/{year}.csv"):
            nd = pd.read_csv(f"{monthly_nan_directory}/{year}.csv")
        else:
            nd = pd.DataFrame(columns=["year", "month", "percent_nan"])

        month_means = []
        mm = pd.read_csv(f"{monthly_means_directory}/{year}_monthly_means.csv")
        month_means.append(mm)

        idx = {"Months": range(start_month, end_month + 1)}
        df1 = pd.DataFrame(idx, columns=["Months"])

        main_dfa = pd.merge(left=df1, right=mm, how="left", left_on="Months", right_on="Month")
        main_df = pd.merge(left=main_dfa, right=nd, how="left", left_on="Months", right_on="month")

        if "Year" not in main_df.columns and "Year_x" in main_df.columns:
            main_df = main_df.rename(columns={"Year_x": "Year"})

        main_df = main_df.replace(np.nan, 100)

        affine = None
        ROI_name = splitext(basename(ROI))[0]
        subsets = Path(subset_directory).glob(f"*_{ROI_name}_ET_subset.tif")
        subsets = list(subsets)
        logger.info(f"Found {len(subsets)} subset files for year {year} and ROI {ROI_name} in {subset_directory}")
        for file in subsets:
            filename = str(file)
            logger.info(f"reading subset file: {filename}")
            with rasterio.open(filename) as src:
                affine = src.transform
                break

        if affine is None:
            logger.error(f"no subset found for year {year} and ROI {ROI_name}")
            continue

        figure_filename = join(figure_directory, f"{year}_{ROI_name}.png")
        if exists(figure_filename):
            logger.info(f"figure already exists: {cl.file(figure_filename)}. Regenerating.")

        for metric_units in [True, False]:
            logger.info(f"generating figure for year {cl.time(year)} ROI {cl.place(ROI_name)} metric_units: {metric_units}")

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

    # Generate PDFs
    metric_report_filename = join(figure_directory, f"{ROI_name}_Report.pdf")
    metric_report_pdf = PdfPages(metric_report_filename)

    imperial_report_filename = join(figure_directory, f"{ROI_name}_Imperial_Report.pdf")
    imperial_report_pdf = PdfPages(imperial_report_filename)

    png_glob = glob(join(figure_directory, "*.png"))
    sorted_years = []
    for png_path in png_glob:
        png_filename = basename(png_path)
        if len(png_filename.split("_")) > 1:
            year = int(png_filename.split("_")[0])
            if year:
                sorted_years.append(year)

    sorted_years = sorted(set(sorted_years))
    for year in sorted_years:
        metric_figure_filename = join(figure_directory, f"{year}_{ROI_name}.png")
        metric_figure_image = plt.imread(metric_figure_filename)

        fig = plt.figure(figsize=(19.2, 14.4), tight_layout=True)
        ax = fig.add_axes([0, 0, 1, 1])
        ax.imshow(metric_figure_image)
        ax.axis("off")
        metric_report_pdf.savefig(fig, bbox_inches="tight", pad_inches=0)
        plt.close(fig)

        imperial_figure_filename = join(figure_directory, f"{year}_{ROI_name}_in.png")
        imperial_figure_image = plt.imread(imperial_figure_filename)

        fig = plt.figure(figsize=(19.2, 14.4), tight_layout=True)
        ax = fig.add_axes([0, 0, 1, 1])
        ax.imshow(imperial_figure_image)
        ax.axis("off")
        imperial_report_pdf.savefig(fig, bbox_inches="tight", pad_inches=0)
        plt.close(fig)

    metric_report_pdf.close()
    logger.info(f"metric report saved to: {cl.file(metric_report_filename)}")
    imperial_report_pdf.close()
    logger.info(f"imperial report saved to: {cl.file(imperial_report_filename)}")


def main(argv=sys.argv):
    if "--boundary-filename" in argv:
        boundary_filename = str(argv[argv.index("--boundary-filename") + 1])
    else:
        boundary_filename = None

    if "--output-directory" in argv:
        output_directory = str(argv[argv.index("--output-directory") + 1])
    else:
        output_directory = None

    if "--input-directory" in argv:
        input_directory = str(argv[argv.index("--input-directory") + 1])
    else:
        input_directory = None

    if "--google-drive-temporary-directory" in argv:
        google_drive_temporary_directory = str(argv[argv.index("--google-drive-temporary-directory") + 1])
    else:
        google_drive_temporary_directory = None

    if "--google-drive-key-filename" in argv:
        google_drive_key_filename = str(argv[argv.index("--google-drive-key-filename") + 1])
    else:
        google_drive_key_filename = None

    if "--google-drive-client-secrets-filename" in argv:
        google_drive_client_secrets_filename = str(argv[argv.index("--google-drive-client-secrets-filename") + 1])
    else:
        google_drive_client_secrets_filename = None

    if "--start-year" in argv:
        start_year = str(argv[argv.index("--start-year") + 1])
    else:
        start_year = None

    if "--end-year" in argv:
        end_year = str(argv[argv.index("--end-year") + 1])
    else:
        end_year = None

    debug = "--debug" in argv

    water_rights_visualizer(
        boundary_filename=boundary_filename,
        output_directory=output_directory,
        input_directory=input_directory,
        google_drive_temporary_directory=google_drive_temporary_directory,
        google_drive_key_filename=google_drive_key_filename,
        google_drive_client_secrets_filename=google_drive_client_secrets_filename,
        start_year=start_year,
        end_year=end_year,
        debug=debug,
    )


if __name__ == "__main__":
    sys.exit(main(argv=sys.argv))
