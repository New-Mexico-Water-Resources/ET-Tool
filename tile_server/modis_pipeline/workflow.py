import os
from pyhdf.SD import SD, SDC
import numpy as np
from osgeo import gdal, osr
import re
import datetime
from tqdm import tqdm


def get_env_path(key, default):
    """Get path from environment variable or use default."""
    path = os.getenv(key, default)
    return os.path.expanduser(path)


# Get paths from environment variables
DOWNLOAD_FOLDER = get_env_path("MODIS_DOWNLOAD_DIR", "~/data/modis_net_et_8_day/downloads")
INPUT_DIR = get_env_path("MODIS_INPUT_DIR", "~/data/modis_net_et_8_day/et_tiffs")
BASE_DATA_PRODUCT = os.getenv("MODIS_BASE_DATA_PRODUCT", "MOD16A2")


def convert_date(yyyyddd):
    """Convert YYYYDDD to YYYYMMDD."""
    year = int(yyyyddd[:4])
    day_of_year = int(yyyyddd[4:])
    date = datetime.datetime(year, 1, 1) + datetime.timedelta(days=day_of_year - 1)
    return date.strftime("%Y%m%d")


def extract_band_name(hdf_file, band_name="ET_500m", output_tif=None):
    """
    Extract the band name from the HDF file name.

    Args:
        hdf_file: Path to the HDF file
        band_name: Name of the band to extract (default: "ET_500m")
        output_tif: Path to save the output TIFF (if None, will be derived from hdf_file)
    """
    hdf = SD(hdf_file, SDC.READ)

    data = hdf.select(band_name)[:]

    data = np.where(data == -32767, np.nan, data)
    data = np.where(data > 32700, np.nan, data)

    # Get geo info
    metadata = hdf.attributes()
    struct_metadata = metadata["StructMetadata.0"]

    ul_match = re.search(r"UpperLeftPointMtrs=\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)", struct_metadata)
    lr_match = re.search(r"LowerRightMtrs=\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)", struct_metadata)

    if ul_match and lr_match:
        ulx, uly = map(float, ul_match.groups())
    else:
        raise ValueError("Failed to extract UpperLeftPointMtrs or LowerRightMtrs")

    # Size of the pixel
    geotransform = (ulx, 463.312716527917246, 0, uly, 0, -463.312716527917246)

    driver = gdal.GetDriverByName("GTiff")
    rows, cols = data.shape
    dst_ds = driver.Create(output_tif, cols, rows, 1, gdal.GDT_Float32)

    dst_ds.SetGeoTransform(geotransform)

    srs = osr.SpatialReference()
    srs.ImportFromProj4("+proj=sinu +R=6371007.181 +nadgrids=@null +wktext")
    dst_ds.SetProjection(srs.ExportToWkt())

    dst_ds.GetRasterBand(1).WriteArray(data)
    dst_ds.FlushCache()
    dst_ds = None


def process_hdf_files(band_name="ET_500m"):
    """Process downloaded HDF files into TIFFs.

    Args:
        band_name: Name of the band to extract (default: "ET_500m")
    """
    et_tile_folder = INPUT_DIR
    pattern = (
        rf"{BASE_DATA_PRODUCT}(?:GF)?\.A(\d{{7}})\.(h\d{{2}}v\d{{2}})"
        if BASE_DATA_PRODUCT == "MOD16A2"
        else rf"{BASE_DATA_PRODUCT}\.A(\d{{7}})\.(h\d{{2}}v\d{{2}})"
    )

    for hdf_file in tqdm(os.listdir(DOWNLOAD_FOLDER), desc="Processing HDF files"):
        if hdf_file.endswith(".hdf"):
            match = re.search(pattern, hdf_file)
            if not match:
                print(f"Skipping {hdf_file}")
                continue

            yyyyddd, tile_id = match.groups()
            date_str = convert_date(yyyyddd)

            output_dir = os.path.join(et_tile_folder, date_str)
            os.makedirs(output_dir, exist_ok=True)

            output_tif = os.path.join(output_dir, f"{BASE_DATA_PRODUCT}_{band_name}_{date_str}_{tile_id}.tif")
            hdf_path = os.path.join(DOWNLOAD_FOLDER, hdf_file)

            if not os.path.exists(output_tif):
                extract_band_name(hdf_path, band_name, output_tif)
