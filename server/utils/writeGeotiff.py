#!/usr/bin/env python3

import sys

import numpy as np
import rasterio
from rasterio.windows import Window

NODATA_THRESHOLD = 32700


def identify_nodata_value(src):
    if src.nodata is not None:
        return src.nodata
    if np.issubdtype(src.dtypes[0], np.floating):
        return np.nan
    return NODATA_THRESHOLD


def filter_nodata(data, nodata):
    clipped = data >= NODATA_THRESHOLD
    if not clipped.any():
        return data

    if np.issubdtype(data.dtype, np.floating) and isinstance(nodata, float) and np.isnan(nodata):
        return np.where(clipped, np.nan, data)

    return np.where(clipped, nodata, data)


def valid_pixel_mask(data, nodata):
    mask = data < NODATA_THRESHOLD

    if np.issubdtype(data.dtype, np.floating):
        mask &= np.isfinite(data)

    if nodata is not None and not (isinstance(nodata, float) and np.isnan(nodata)):
        mask &= data != nodata

    return mask


def crop_to_valid_extent(data, src, nodata):
    valid = valid_pixel_mask(data, nodata)
    if not valid.any():
        raise ValueError("No valid pixels after clip")

    rows = np.any(valid, axis=1)
    cols = np.any(valid, axis=0)
    row_indices = np.where(rows)[0]
    col_indices = np.where(cols)[0]

    row_min, row_max = int(row_indices[0]), int(row_indices[-1])
    col_min, col_max = int(col_indices[0]), int(col_indices[-1])

    window = Window(
        col_min,
        row_min,
        col_max - col_min + 1,
        row_max - row_min + 1,
    )
    cropped = data[window.toslices()]

    return cropped, src.window_transform(window)


def main():
    source_path = sys.argv[1]
    output_path = sys.argv[2]
    bin_path = sys.argv[3]
    width = int(sys.argv[4])
    height = int(sys.argv[5])
    crop = len(sys.argv) <= 6 or sys.argv[6] != "full"

    values = np.fromfile(bin_path, dtype=np.float64).reshape((height, width))

    with rasterio.open(source_path) as src:
        nodata = identify_nodata_value(src)
        data = values.astype(src.dtypes[0])
        data = filter_nodata(data, nodata)

        if crop:
            output_data, output_transform = crop_to_valid_extent(data, src, nodata)
        else:
            output_data = data
            output_transform = src.transform

        profile = {
            "driver": "GTiff",
            "height": output_data.shape[0],
            "width": output_data.shape[1],
            "count": 1,
            "dtype": src.dtypes[0],
            "crs": src.crs,
            "transform": output_transform,
            "nodata": nodata,
            "compress": src.profile.get("compress") or "deflate",
        }

        with rasterio.open(output_path, "w", **profile) as dst:
            dst.write(output_data, 1)


if __name__ == "__main__":
    main()
