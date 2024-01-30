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

logger = getLogger(__name__)

# Defining the function calculate_percent_nan
def calculate_percent_nan(
        ROI_for_nan: Polygon,
        subset_directory: str,
        nan_subset_directory: str,
        monthly_nan_directory: str):
    """
    Calculate the percentage of NaN values in each subset file within the given directory.

    Args:
        ROI_for_nan (Polygon): The region of interest polygon used for masking the subset files.
        subset_directory (str): The directory containing the subset files.
        nan_subset_directory (str): The directory to save the masked subset files with NaN values.
        monthly_nan_directory (str): The directory to save the monthly average NaN values.

    Returns:
        None
    """
    # Creating the nan_subset_directory if it doesn't exist
    if not exists(nan_subset_directory):
        makedirs(nan_subset_directory)
    
    nan_subsets = (nan_subset_directory)

    # Looping through the files in the subset_directory
    for items in listdir(subset_directory):
        # Checking if the file is a valid ET subset file
        if items.endswith('_ET_subset.tif') and isfile(join(subset_directory, items)):
            # Opening the ET subset file
            with rasterio.open(join(subset_directory, items)) as p:
                # Masking the ET subset file with the ROI_for_nan polygon
                out_image, out_transform = mask(p, ROI_for_nan, crop=False)
                out_meta = p.meta.copy()
                out_meta.update({"driver": "GTiff",
                                    "height": out_image.shape[1],
                                    "width": out_image.shape[2],
                                    "transform": out_transform})
                # Saving the masked subset as a new file in the nan_subset_directory
                with rasterio.open(splitext(nan_subsets + "/" + basename(p.name))[0] + "_nan.tif", "w",
                                    **out_meta) as dest:
                    dest.write(out_image)

    # Opening the first ET subset file in the subset_directory
    a_subset = rasterio.open(subset_directory + "/" + listdir(subset_directory)[0])

    # Masking the area outside the ROI_for_nan polygon
    out_image, out_transform = mask(a_subset, ROI_for_nan, invert=True)
    out_meta = a_subset.meta.copy()
    out_meta.update({"driver": "GTiff",
                        "height": out_image.shape[1],
                        "width": out_image.shape[2],
                        "transform": out_transform})
    # Saving the masked area as a new file in the subset_directory
    with rasterio.open(subset_directory + "/masked_area.tif", "w", **out_meta) as dest2:
        dest2.write(out_image)

    # Creating a mask for the ROI_for_nan polygon
    roi_mask = raster_geometry_mask(a_subset, ROI_for_nan, invert=True)
    open_mask = (rasterio.open(subset_directory + "/masked_area.tif"))
    area_mask = open_mask.read()
    # Counting the number of pixels with value 0 (outside the ROI_for_nan polygon)
    area = np.count_nonzero(((area_mask[0][roi_mask[0]])) == 0)
    ET_subset = rasterio.open(nan_subsets + "/" + listdir(nan_subsets)[0])
    base_name = basename(ET_subset.name)
    file_name = splitext(base_name)[0]
    subset_in_mskdir = (rasterio.open(nan_subsets + '/' + file_name + ".tif"))
    percent_nan = []
    msk_subsets = glob(join(nan_subsets, '*.tif'))

    # Function to read a raster file
    def read_file(file):
        with rasterio.open(file) as src:
            return (src.read())

    # Creating a list of arrays, each representing a masked subset
    array_list = [read_file(x) for x in msk_subsets]
    
    # Looping through the array_list and calculating the percentage of NaN values
    for subsets in array_list:
        nan = np.count_nonzero((np.isnan(subsets[0][roi_mask[0]])))
        count_nan = []
        count_nan.append(nan)

        for nans in count_nan:
            if area == 0:
                ratio_of_nan = (nans / 1)
                percent_of_nan = ratio_of_nan * 100
                percent_nan.append(percent_of_nan)
            else:
                ratio_of_nan = (nans / area)
                percent_of_nan = ratio_of_nan * 100
                percent_nan.append(percent_of_nan)

    # Extracting the dates from the file names
    dates = []

    for msk_subset in msk_subsets:
        with rasterio.open(msk_subset) as t:
            paths = basename(t.name)
            date_split = paths.split("_")[0]
            dates.append(date_split)

    years = []
    months = []
    days = []

    # Splitting the dates into year, month, and day
    for date_time in dates:
        msk_year = date_time.split(".")[0]
        years.append(msk_year)
        msk_month = date_time.split(".")[1]
        months.append(msk_month)
        msk_day = date_time.split(".")[2]
        days.append(msk_day)

    # Creating the monthly_nan_directory if it doesn't exist
    if not exists(monthly_nan_directory):
        makedirs(monthly_nan_directory)

    nan_csv = "nan_avg.csv"
    nan_monthly_csv = "nan_monthly_avg.csv"
    nan_folder = join(monthly_nan_directory, nan_csv)
    nan_monthly_folder = join(monthly_nan_directory, nan_monthly_csv)

    # Writing the percent_nan, year, and month to a CSV file
    with open(nan_folder, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['percent_nan', 'year', 'month'])
        rows = zip(percent_nan, years, months)

        for row in rows:
            writer.writerow(row)

    nan_avg = list()
    nanavg = pd.read_csv(nan_folder)
    group = nanavg.groupby(['year', 'month'])
    monthavg = group.aggregate({'percent_nan': np.mean})
    nan_avg.append(monthavg)
    conavg = pd.concat(nan_avg, ignore_index=False)
    conavg.to_csv(nan_monthly_folder)
    sort_order = pd.read_csv(nan_monthly_folder)
    sort_ascend = sort_order.sort_values('year', ascending=False)
    nan_monthly_avg = pd.read_csv(nan_monthly_folder)
    cols_nan = nan_monthly_avg.columns
    nan_monthly_avg['Year'] = nan_monthly_avg['year']

    # Splitting the data into separate CSV files for each year
    for years in set(nan_monthly_avg.Year):
        new_csv_by_year = monthly_nan_directory + '/' + str(years) + ".csv"
        nan_monthly_avg.loc[nan_monthly_avg.Year == years].to_csv(new_csv_by_year, index=False, columns=cols_nan)
    
    # Removing the temporary CSV files
    remove(nan_monthly_folder)
    remove(nan_folder)
