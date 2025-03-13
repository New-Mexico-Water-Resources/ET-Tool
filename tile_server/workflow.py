import os
from pyhdf.SD import SD, SDC
import numpy as np
from osgeo import gdal, osr
import re
import datetime
from tqdm import tqdm


def convert_date(yyyyddd):
    """Convert YYYYDDD to YYYYMMDD."""
    year = int(yyyyddd[:4])
    day_of_year = int(yyyyddd[4:])
    date = datetime.datetime(year, 1, 1) + datetime.timedelta(days=day_of_year - 1)
    return date.strftime("%Y%m%d")


def extract_band_name(hdf_file, band_name, output_tif):
    """
    Extract the band name from the HDF file name.
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


if __name__ == "__main__":
    # modis_folder = "/Users/rstonebr/data/modis_net_et_8_day/MOD16A2_061-20250117_195929"
    modis_folder = "/Users/rstonebr/Documents/Programming/Water-Rights-Visualizer/tile_server/modis_downloads"
    et_tile_folder = "/Users/rstonebr/data/modis_net_et_8_day/et_tiffs"

    for hdf_file in tqdm(os.listdir(modis_folder)):
        if hdf_file.endswith(".hdf"):
            match = re.search(r"MOD16A2(?:GF)?\.A(\d{7})\.(h\d{2}v\d{2})", hdf_file)
            if not match:
                print(f"Skipping {hdf_file}")
                continue

            yyyyddd, tile_id = match.groups()
            date_str = convert_date(yyyyddd)
            year_month = date_str[:6]

            if not os.path.exists(os.path.join(et_tile_folder, date_str)):
                os.makedirs(os.path.join(et_tile_folder, date_str))

            output_tif = os.path.join(et_tile_folder, date_str, f"MOD16A2_ET_500m_{date_str}_{tile_id}.tif")
            hdf_file = os.path.join(modis_folder, hdf_file)

            extract_band_name(hdf_file, "ET_500m", output_tif)
