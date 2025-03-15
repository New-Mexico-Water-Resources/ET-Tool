from datetime import date, datetime
from logging import getLogger
from os import makedirs
from os.path import exists, join, dirname
from typing import List

import h5py
import numpy as np
from affine import Affine
from shapely import Polygon

from .constants import WGS84
from .data_source import DataSource
from .errors import BlankOutput, FileUnavailable
from .generate_subset import generate_subset
from .interpolate_stack import interpolate_stack
from datetime import timedelta
from .date_helpers import (
    get_days_in_year,
    get_day_of_year,
    get_one_month_slice,
    get_days_in_month,
    calculate_hours_of_sunlight,
)
from .variable_types import get_available_variable_source_for_date

logger = getLogger(__name__)


def generate_sparse_stack(total_date_steps: int, x_rows: int, y_cols: int) -> np.ndarray:
    """
    Generate an empty stack with NaN values.
    """
    return np.full((total_date_steps, x_rows, y_cols), np.nan, dtype=np.float32)


def generate_stack(
    ROI_name: str,
    ROI_latlon,
    year: int,
    ROI_acres: float,
    input_datastore: DataSource,
    subset_directory: str,
    dates_available: List[date],
    stack_filename: str,
    target_CRS: str = None,
    use_stack: bool = False,
) -> (np.ndarray, np.ndarray, Affine):
    """
    Generates a stack of data for a given region of interest (ROI) and year.

    Args:
        ROI_name (str): The name of the region of interest.
        ROI_latlon (Polygon): The polygon representing the latitude and longitude coordinates of the ROI.
        year (int): The year for which the stack is generated.
        ROI_acres (float): The area of the ROI in acres.
        source_directory (str): The directory containing the source data.
        subset_directory (str): The directory where the generated subset will be saved.
        dates_available (List[date]): A list of available dates for the data.
        stack_filename (str): The filename of the generated stack.
        target_CRS (str, optional): The target coordinate reference system (CRS) for the stack. Defaults to None.

    Returns:
        Tuple[np.ndarray, np.ndarray, Affine]: A tuple containing the generated stack, the interpolated stack, and the affine transformation.
    """
    if target_CRS is None:
        target_CRS = WGS84

    if use_stack and exists(stack_filename):
        logger.info(f"loading existing stack: {stack_filename}")

        with h5py.File(stack_filename, "r") as stack_file:
            logger.info(f"loading ET: {stack_filename}")
            ET_stack = np.array(stack_file["ET"])
            logger.info(f"loading PET: {stack_filename}")
            PET_stack = np.array(stack_file["PET"])
            affine = Affine(*list(stack_file["affine"]))

        return ET_stack, PET_stack, affine

    logger.info(f"generating stack")

    ET_sparse_stack = None
    ESI_sparse_stack = None
    PET_sparse_stack = None

    dates_in_year = [date_step for date_step in dates_available if date_step.year == year]

    dates_in_year = sorted(set(dates_in_year))

    # Process monthly PPT data first
    for month in range(1, 13):
        if not exists(subset_directory):
            logger.info(f"creating subset directory: {subset_directory}")
            makedirs(subset_directory)

        date_step = datetime(year, month, 1).date()
        ppt_source = get_available_variable_source_for_date("PPT", date_step)

        PPT_subset_filename = join(subset_directory, f"{date_step.strftime('%Y.%m.%d')}_{ROI_name}_PPT_subset.tif")
        logger.info(f"PPT subset file: {PPT_subset_filename}")

        try:
            if ppt_source and ppt_source.monthly:
                generate_subset(
                    input_datastore=input_datastore,
                    acquisition_date=date_step,
                    ROI_name=ROI_name,
                    ROI_latlon=ROI_latlon,
                    ROI_acres=ROI_acres,
                    variable_name="PPT",
                    subset_filename=PPT_subset_filename,
                    target_CRS=target_CRS,
                )
        # Just keep processing as this only causes issues with showing uncertainty on the report
        except Exception as e:
            logger.exception(e)
            logger.info(f"problem generating uncertainty subset for date: {date_step.strftime('%Y-%m-%d')}, continuing...")

    if len(dates_in_year) == 0:
        raise ValueError(f"no dates for year: {year}")

    for date_step in dates_in_year:
        logger.info(f"date: {date_step.strftime('%Y-%m-%d')}")

        if not exists(subset_directory):
            logger.info(f"creating subset directory: {subset_directory}")
            makedirs(subset_directory)

        ET_subset_filename = join(subset_directory, f"{date_step.strftime('%Y.%m.%d')}_{ROI_name}_ET_subset.tif")
        logger.info(f"ET subset file: {ET_subset_filename}")

        count_source = get_available_variable_source_for_date("COUNT", date_step)

        if count_source and count_source.monthly:
            count_subset_filename = join(subset_directory, f"{date_step.strftime('%Y.%m.%d')}_{ROI_name}_COUNT_subset.tif")
            logger.info(f"COUNT subset file: {count_subset_filename}")

            et_min_subset_filename = join(subset_directory, f"{date_step.strftime('%Y.%m.%d')}_{ROI_name}_ET_MIN_subset.tif")
            logger.info(f"ET MIN subset file: {et_min_subset_filename}")

            et_max_subset_filename = join(subset_directory, f"{date_step.strftime('%Y.%m.%d')}_{ROI_name}_ET_MAX_subset.tif")
            logger.info(f"ET MAX subset file: {et_max_subset_filename}")

        ESI_subset_filename = join(subset_directory, f"{date_step.strftime('%Y.%m.%d')}_{ROI_name}_ESI_subset.tif")
        logger.info(f"ESI subset file: {ESI_subset_filename}")

        PET_subset_filename = join(subset_directory, f"{date_step.strftime('%Y.%m.%d')}_{ROI_name}_PET_subset.tif")
        logger.info(f"PET subset file: {PET_subset_filename}")

        try:
            ET_subset = generate_subset(
                input_datastore=input_datastore,
                acquisition_date=date_step,
                ROI_name=ROI_name,
                ROI_latlon=ROI_latlon,
                ROI_acres=ROI_acres,
                variable_name="ET",
                subset_filename=ET_subset_filename,
                target_CRS=target_CRS,
            )

            affine = ET_subset.geometry.affine
        except BlankOutput as e:
            logger.warning(e)
            continue
        except FileUnavailable as e:
            logger.warning(e)
            continue
        except Exception as e:
            logger.exception(e)
            logger.info(f"problem generating ET subset for date: {date_step.strftime('%Y-%m-%d')}")
            continue

        try:
            if count_source and count_source.monthly:
                # These are just used to get error percentage
                uncertainty_variables = {
                    "ET_MIN": et_min_subset_filename,
                    "ET_MAX": et_max_subset_filename,
                    "COUNT": count_subset_filename,
                }

                for variable_name, subset_filename in uncertainty_variables.items():
                    generate_subset(
                        input_datastore=input_datastore,
                        acquisition_date=date_step,
                        ROI_name=ROI_name,
                        ROI_latlon=ROI_latlon,
                        ROI_acres=ROI_acres,
                        variable_name=variable_name,
                        subset_filename=subset_filename,
                        target_CRS=target_CRS,
                    )
        # Just keep processing as this only causes issues with showing uncertainty on the report
        except Exception as e:
            logger.exception(e)
            logger.info(f"problem generating uncertainty subset for date: {date_step.strftime('%Y-%m-%d')}, continuing...")

        subset_shape = ET_subset.shape

        PET_subset = None
        ESI_subset = None

        # Check for PET layers first, then use ESI if not available
        try:
            pet_source = get_available_variable_source_for_date("PET", date_step)
            if not pet_source:
                raise FileUnavailable(f"no PET source available for date {date_step.strftime('%Y-%m-%d')}")

            PET_subset = generate_subset(
                input_datastore=input_datastore,
                acquisition_date=date_step,
                ROI_name=ROI_name,
                ROI_latlon=ROI_latlon,
                ROI_acres=ROI_acres,
                variable_name="PET",
                subset_filename=PET_subset_filename,
                target_CRS=target_CRS,
            )

            affine = PET_subset.geometry.affine
            subset_shape = PET_subset.shape

            rows, cols = subset_shape
            month = date_step.month
            day = date_step.day

            if PET_sparse_stack is None:
                days_in_year = get_days_in_year(year)
                PET_sparse_stack = generate_sparse_stack(days_in_year, rows, cols)

            source = get_available_variable_source_for_date("PET", date_step)
            if source.monthly:
                # # Fill in the rest of the month
                day_of_year, last_doy = get_one_month_slice(year, month)
                days_in_month = get_days_in_month(year, month)

                # If the PET/ETo source isn't daylight averaged, then we need to convert from a monthly-sum to a daily 24-hour average
                # Then, convert from a daily 24-hour average to an hours-of-sunlight per day average based on DOY and latitude
                daily_pet_avg = PET_subset / days_in_month
                avg_daily_avg = np.nanmean(daily_pet_avg)
                if not source.daylight_corrected:
                    logger.info(
                        f"PET source is not daylight corrected, applying correction for {date_step} ({day_of_year}, {last_doy})"
                    )
                    for current_day in range(day_of_year, last_doy):
                        current_day_step = datetime(year, month, current_day - day_of_year + 1).date()
                        hours_of_sunlight = calculate_hours_of_sunlight(ROI_latlon, current_day_step)
                        corrected_daily_pet_avg = daily_pet_avg / 24 * hours_of_sunlight
                        PET_sparse_stack[current_day, :, :] = corrected_daily_pet_avg
                else:
                    PET_sparse_stack[day_of_year:last_doy, :, :] = daily_pet_avg
            else:
                day_of_year = get_day_of_year(year, month, day)

                PET_doy_image = PET_sparse_stack[day_of_year, :, :]
                PET_sparse_stack[day_of_year, :, :] = np.where(np.isnan(PET_doy_image), PET_subset, PET_doy_image)

        except Exception as e:
            logger.warning(e)

            try:
                ESI_subset = generate_subset(
                    input_datastore=input_datastore,
                    acquisition_date=date_step,
                    ROI_name=ROI_name,
                    ROI_latlon=ROI_latlon,
                    ROI_acres=ROI_acres,
                    variable_name="ESI",
                    subset_filename=ESI_subset_filename,
                    target_CRS=target_CRS,
                )

                affine = ESI_subset.geometry.affine
                subset_shape = ESI_subset.shape
            except BlankOutput as e:
                logger.warning(e)
            except FileUnavailable as e:
                logger.warning(e)
            except Exception as e:
                logger.exception(e)
                logger.info(f"problem generating ESI subset for date: {date_step.strftime('%Y-%m-%d')}")

        rows, cols = subset_shape
        month = date_step.month
        day = date_step.day

        if ET_sparse_stack is None:
            days_in_year = get_days_in_year(year)
            ET_sparse_stack = generate_sparse_stack(days_in_year, rows, cols)

        if ESI_sparse_stack is None:
            days_in_year = get_days_in_year(year)
            ESI_sparse_stack = generate_sparse_stack(days_in_year, rows, cols)

        day_of_year, last_doy = get_one_month_slice(year, month)
        days_in_month = get_days_in_month(year, month)

        ET_doy_image = ET_sparse_stack[day_of_year, :, :]
        ET_sparse_stack[day_of_year, :, :] = np.where(np.isnan(ET_doy_image), ET_subset, ET_doy_image)
        et_source = get_available_variable_source_for_date("ET", date_step)
        if et_source and et_source.monthly:
            # Fill in the rest of the month
            ET_sparse_stack[day_of_year:last_doy, :, :] = ET_subset / days_in_month

        if not PET_subset and PET_sparse_stack is None and ESI_subset:
            ESI_doy_image = ESI_sparse_stack[day_of_year, :, :]
            ESI_sparse_stack[day_of_year, :, :] = np.where(np.isnan(ESI_doy_image), ESI_subset, ESI_doy_image)
            source = get_available_variable_source_for_date("ESI", date_step)
            if source and source.monthly:
                # Fill in the rest of the month
                ESI_sparse_stack[day_of_year:last_doy, :, :] = ESI_subset / days_in_month

    if ET_sparse_stack is None:
        raise ValueError("no ET stack generated")

    if PET_sparse_stack is None and ESI_sparse_stack is None:
        raise ValueError("no PET or ESI stack generated")

    if PET_sparse_stack is None:
        logger.info("PET stack is None, calculating from ET and ESI")
        PET_sparse_stack = ET_sparse_stack / ESI_sparse_stack

    logger.info(f"interpolating ET stack for year: {year}")
    ET_stack = interpolate_stack(ET_sparse_stack)
    PET_stack = interpolate_stack(PET_sparse_stack)

    stack_directory = dirname(stack_filename)

    if not exists(stack_directory):
        makedirs(stack_directory)

    if use_stack:
        logger.info(f"writing stack: {stack_filename}")
        with h5py.File(stack_filename, "w") as stack_file:
            stack_file["ET"] = ET_stack
            stack_file["PET"] = PET_stack

            stack_file["affine"] = (affine.a, affine.b, affine.c, affine.d, affine.e, affine.f)

    return ET_stack, PET_stack, affine
