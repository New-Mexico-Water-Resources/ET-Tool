from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from rasterio.io import MemoryFile
from rasterio.warp import transform_geom
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
import rasterio
import os
import re
import datetime
import mercantile
import shapely

import json
from rasterio.windows import Window
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

import boto3

from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ET_PROCESSED_DIR = os.environ.get("ET_PROCESSED_DIR", "/root/data/modis/raw_et")
PET_PROCESSED_DIR = os.environ.get("PET_PROCESSED_DIR", "/root/data/modis/raw_pet")
BASE_DATA_PRODUCT = os.environ.get("MODIS_BASE_DATA_PRODUCT", "MOD16A2")
BUCKET_PREFIX = os.environ.get("MODIS_S3_BUCKET_PREFIX", "modis/")

AWS_PROFILE = os.environ.get("AWS_PROFILE", None)
S3_INPUT_BUCKET = os.environ.get("S3_INPUT_BUCKET", "ose-dev-inputs")

BANDS = ["ET", "PET", "ESI"]
TILE_SIZE = 256
ET_COLORMAP = LinearSegmentedColormap.from_list("ET", ["#f6e8c3", "#d8b365", "#99974a", "#53792d", "#6bdfd2", "#1839c5"])
DIFF_COLORMAP = LinearSegmentedColormap.from_list("DIFF", ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"])


@app.get("/ts_v1/tiles/modis-dates")
async def get_modis_dates():
    if not os.path.exists(ET_PROCESSED_DIR):
        os.makedirs(ET_PROCESSED_DIR, exist_ok=True)

    # Return a list of available MODIS dates
    dates = []
    for tiff_file in os.listdir(ET_PROCESSED_DIR):
        matches = re.match(rf"{BASE_DATA_PRODUCT}_MERGED_(\d{{8}})_.+\.tif", tiff_file)
        if not matches:
            continue
        raw_date = matches.group(1)
        formatted_date = datetime.datetime.strptime(raw_date, "%Y%m%d").strftime("%Y-%m-%d")
        if formatted_date not in dates:
            dates.append(formatted_date)

    # Now check the S3 bucket
    if S3_INPUT_BUCKET:
        try:
            session = boto3.Session(profile_name=AWS_PROFILE)
            s3 = session.client("s3")
            paginator = s3.get_paginator("list_objects_v2")
            pages = paginator.paginate(Bucket=S3_INPUT_BUCKET, Prefix=BUCKET_PREFIX)

            for response in pages:
                for obj in response.get("Contents", []):
                    key = obj["Key"]
                    matches = re.match(rf"{BUCKET_PREFIX}{BASE_DATA_PRODUCT}_MERGED_(\d{{8}})_.+\.tif", key)
                    if not matches:
                        continue
                    raw_date = matches.group(1)
                    formatted_date = datetime.datetime.strptime(raw_date, "%Y%m%d").strftime("%Y-%m-%d")
                    if formatted_date not in dates:
                        dates.append(formatted_date)
        except Exception as e:
            print("Error checking S3 bucket for MODIS dates", e)

    dates.sort()

    return dates


def get_tile(path: str, z: int, x: int, y: int):
    """Get a tile from a GeoTIFF file."""
    # Load New Mexico boundary
    try:
        with open("rois/nm.json", "r") as nm_shape:
            nm = json.load(nm_shape)
    except Exception as e:
        print(f"Failed to load New Mexico boundary: {e}")
        return None

    nm_geom4326 = nm["features"][0]["geometry"]

    # reproject from 4326 to 3857
    nm_geom3857 = transform_geom(
        "EPSG:4326",
        "EPSG:3857",
        nm_geom4326,
        precision=6,
    )

    # build a Shapely polygon in Web Mercator
    nm_poly = shapely.geometry.shape(nm_geom3857)

    with rasterio.open(path) as src:
        # Convert Leaflet Y to TMS Y
        tms_y = (2**z - 1) - y

        # Get tile bounds in mercator coordinates
        tile_bounds = mercantile.xy_bounds(x, tms_y, z)
        x_min, y_min, x_max, y_max = tile_bounds

        # Check if tile intersects with raster
        raster_bounds = src.bounds
        if (
            x_max < raster_bounds.left
            or x_min > raster_bounds.right
            or y_max < raster_bounds.bottom
            or y_min > raster_bounds.top
        ):
            return None

        tile_poly = shapely.geometry.box(x_min, y_min, x_max, y_max)
        # Check if tile_bounds intersects with New Mexico boundary
        if not tile_poly.intersects(nm_poly):
            return None

        # Convert bounds to pixel coordinates
        px_min, py_max = ~src.transform * (x_min, y_min)
        px_max, py_min = ~src.transform * (x_max, y_max)

        # Round and clamp to valid pixel coordinates
        row_min = max(0, min(src.height - 1, int(round(py_min))))
        row_max = max(0, min(src.height - 1, int(round(py_max))))
        col_min = max(0, min(src.width - 1, int(round(px_min))))
        col_max = max(0, min(src.width - 1, int(round(px_max))))

        # Check if we're at the edge of the raster
        at_bottom_edge = py_max >= src.height - 1
        at_top_edge = py_min <= 0
        at_right_edge = px_max >= src.width - 1

        # Create window
        window = Window.from_slices((row_min, row_max), (col_min, col_max))

        y_offset = 0

        # Calculate the actual height we should read based on the data available
        if at_bottom_edge:
            # Calculate what portion of the tile should actually contain data
            tile_mercator_height = tile_bounds.top - tile_bounds.bottom
            data_mercator_height = tile_bounds.top - raster_bounds.bottom
            if data_mercator_height <= 0:
                return None

            # Calculate proportional output height
            output_height = int((data_mercator_height / tile_mercator_height) * TILE_SIZE)
            output_height = max(1, min(output_height, TILE_SIZE))
        elif at_top_edge:
            # Calculate proportion for top edge
            tile_mercator_height = tile_bounds.top - tile_bounds.bottom
            data_mercator_height = raster_bounds.top - tile_bounds.bottom
            if data_mercator_height <= 0:
                return None

            output_height = int((data_mercator_height / tile_mercator_height) * TILE_SIZE)
            output_height = max(1, min(output_height, TILE_SIZE))
            y_offset = TILE_SIZE - output_height
        else:
            output_height = TILE_SIZE

        output_width = TILE_SIZE
        if at_right_edge:
            # Calculate proportion for right edge
            tile_mercator_width = tile_bounds.right - tile_bounds.left
            data_mercator_width = raster_bounds.right - tile_bounds.left
            if data_mercator_width <= 0:
                return None

            output_width = int((data_mercator_width / tile_mercator_width) * TILE_SIZE)
            output_width = max(1, min(output_width, TILE_SIZE))

        resampling_method = rasterio.enums.Resampling.rms
        if z > 9:
            resampling_method = rasterio.enums.Resampling.cubic_spline

        # Read and resample data
        data = src.read(1, window=window, out_shape=(output_height, output_width), resampling=resampling_method)

        full_data = np.full((TILE_SIZE, TILE_SIZE), np.nan)

        tile_transform = from_bounds(x_min, y_min, x_max, y_max, width=TILE_SIZE, height=TILE_SIZE)

        if at_top_edge:
            if at_right_edge:
                full_data[y_offset:, :output_width] = data
            else:
                full_data[y_offset:, :] = data
        elif at_bottom_edge:
            if at_right_edge:
                full_data[:output_height, :output_width] = data
            else:
                full_data[:output_height, :] = data
        elif at_right_edge:
            full_data[:, :output_width] = data
        else:
            full_data = data

        # Handle nodata values
        nodata_value = 32700
        full_data = np.where(full_data >= nodata_value, np.nan, full_data)

        mask = geometry_mask(
            [nm_geom3857],
            out_shape=(TILE_SIZE, TILE_SIZE),
            transform=tile_transform,
            invert=True,
        )

        full_data[~mask] = np.nan

        return full_data


@app.get("/ts_v1/tiles/stats/{band}/{time}/{comparison_mode}")
async def get_stats(band: str, time: str, comparison_mode: str = "absolute"):
    if band not in BANDS:
        raise HTTPException(status_code=404, detail="Band not found")

    if not re.match(r"\d{4}-\d{2}-\d{2}", time):
        raise HTTPException(status_code=404, detail="Time must be in format: YYYY-MM-DD")

    time_str = datetime.datetime.strptime(time, "%Y-%m-%d").strftime("%Y%m%d")
    esi_mode = band == "ESI"
    bands = [band] if not esi_mode else ["ET", "PET"]
    band_data = {}
    for band in bands:
        path = os.path.join(ET_PROCESSED_DIR, f"{BASE_DATA_PRODUCT}_MERGED_{time_str}_{band}.tif")

        if not os.path.exists(path):
            if S3_INPUT_BUCKET:
                s3 = boto3.Session(profile_name=AWS_PROFILE).client("s3")
                key = f"{BUCKET_PREFIX}{BASE_DATA_PRODUCT}_MERGED_{time_str}_{band}.tif"

                try:
                    await s3.download_file(S3_INPUT_BUCKET, key, path)
                except Exception as e:
                    raise HTTPException(status_code=404, detail="Tile not found")
            else:
                raise HTTPException(status_code=404, detail="Tile not found")

        with rasterio.open(path) as src:
            band_data[band] = src.read(1)
            # Filter out nodata values
            band_data[band] = np.where(band_data[band] >= 32700, np.nan, band_data[band])

    # ESI can only be a max of 1
    current_data = band_data[band] if not esi_mode else np.divide(band_data["ET"], band_data["PET"])
    if esi_mode:
        current_data = np.clip(current_data, 0, 1)

    # Get min/max values for the TIFF if comparison mode is absolute
    if comparison_mode == "absolute":
        if esi_mode:
            min_val = round(float(np.nanmin(current_data)), 2)
            max_val = round(float(np.nanmax(current_data)), 2)
        else:
            min_val = int(np.nanmin(current_data))
            max_val = int(np.nanmax(current_data))
    else:
        # Get min/max values for the TIFF if comparison mode is prevPass
        prev_date = None
        available_dates = await get_modis_dates()
        if available_dates:
            current_index = available_dates.index(time) if time in available_dates else -1
            if current_index > 0:
                prev_date = available_dates[current_index - 1]
            else:
                raise HTTPException(status_code=404, detail="Previous date not found")
        prev_time_str = datetime.datetime.strptime(prev_date, "%Y-%m-%d").strftime("%Y%m%d")
        prev_bands = ["ET", "PET"] if esi_mode else [band]
        prev_bands_data = {}
        for prev_band in prev_bands:
            prev_path = os.path.join(ET_PROCESSED_DIR, f"{BASE_DATA_PRODUCT}_MERGED_{prev_time_str}_{prev_band}.tif")
            # Open both files, subtract, get min/max diff
            with rasterio.open(prev_path) as src:
                prev_bands_data[prev_band] = src.read(1)
                # Filter out nodata values
                prev_bands_data[prev_band] = np.where(
                    prev_bands_data[prev_band] >= 32700, np.nan, prev_bands_data[prev_band]
                )

        if esi_mode:
            prev_data = np.divide(prev_bands_data["ET"], prev_bands_data["PET"])
        else:
            prev_data = prev_bands_data[band]
        diff = current_data - prev_data
        if esi_mode:
            min_val = round(float(np.nanmin(diff)), 2)
            max_val = round(float(np.nanmax(diff)), 2)
        else:
            min_val = int(np.floor(np.nanmin(diff)))
            max_val = int(np.ceil(np.nanmax(diff)))

    return {"min": min_val, "max": max_val}


@app.get("/ts_v1/tiles/dynamic/{band}/{time}/{z}/{x}/{y}.png")
async def serve_dynamic_tile(
    band: str,
    time: str,
    z: int,
    x: int,
    y: int,
    color_min: float = None,
    color_max: float = None,
    comparison_mode: str = "absolute",
):
    if band not in BANDS:
        raise HTTPException(status_code=404, detail="Band not found")

    if not re.match(r"\d{4}-\d{2}-\d{2}", time):
        raise HTTPException(status_code=404, detail="Time must be in format: YYYY-MM-DD")

    time_str = datetime.datetime.strptime(time, "%Y-%m-%d").strftime("%Y%m%d")
    esi_mode = band == "ESI"

    bands = [band] if not esi_mode else ["ET", "PET"]

    band_data = {}
    for band in bands:
        path = os.path.join(ET_PROCESSED_DIR, f"{BASE_DATA_PRODUCT}_MERGED_{time_str}_{band}.tif")
        if not os.path.exists(path):
            if S3_INPUT_BUCKET:
                s3 = boto3.Session(profile_name=AWS_PROFILE).client("s3")
                key = f"{BUCKET_PREFIX}{BASE_DATA_PRODUCT}_MERGED_{time_str}_{band}.tif"

                try:
                    await s3.download_file(S3_INPUT_BUCKET, key, path)
                except Exception as e:
                    raise HTTPException(status_code=404, detail="Tile not found")
            else:
                raise HTTPException(status_code=404, detail="Tile not found")

        full_data = get_tile(path, z, x, y)

        if full_data is None or np.isnan(full_data).all():
            return Response(content=b"", media_type="image/png", status_code=404)

        band_data[band] = full_data

    # If ESI mode, calculate by dividing ET by PET
    full_data = band_data[band] if not esi_mode else np.divide(band_data["ET"], band_data["PET"])
    if esi_mode:
        full_data = np.clip(full_data, 0, 1)

    if comparison_mode == "prevPass":
        # Get date of previous pass from available dates
        prev_date = None
        available_dates = await get_modis_dates()
        if available_dates:
            current_index = available_dates.index(time) if time in available_dates else -1
            if current_index > 0:
                prev_date = available_dates[current_index - 1]
            else:
                prev_date = None
        prev_time_str = datetime.datetime.strptime(prev_date, "%Y-%m-%d").strftime("%Y%m%d")
        prev_bands = ["ET", "PET"] if esi_mode else [band]
        prev_bands_data = {}
        for prev_band in prev_bands:
            prev_path = os.path.join(ET_PROCESSED_DIR, f"{BASE_DATA_PRODUCT}_MERGED_{prev_time_str}_{prev_band}.tif")
            prev_bands_data[prev_band] = get_tile(prev_path, z, x, y)
            if prev_bands_data[prev_band] is None or np.isnan(prev_bands_data[prev_band]).all():
                return Response(content=b"", media_type="image/png", status_code=404)

        prev_data = prev_bands_data[prev_band] if not esi_mode else np.divide(prev_bands_data["ET"], prev_bands_data["PET"])
        if esi_mode:
            prev_data = np.clip(prev_data, 0, 1)
        full_data = full_data - prev_data

    # Scale data
    min_val = color_min if color_min is not None else 0
    max_val = color_max if color_max is not None else (200 if not esi_mode else 1)

    # Create alpha channel
    alpha = np.where(np.isnan(full_data), 0, 255).astype(np.uint8)

    # Scale data to 0-255 range
    if max_val - min_val > 0:
        scaled_data = np.clip(((full_data - min_val) / (max_val - min_val) * 255), 0, 255)
    else:
        scaled_data = np.zeros_like(full_data)

    scaled_data = np.nan_to_num(scaled_data, nan=0).astype(np.uint8)
    colored_data = ET_COLORMAP(scaled_data) if comparison_mode == "absolute" else DIFF_COLORMAP(scaled_data)
    rgb_data = (colored_data[:, :, :3] * 255).astype(np.uint8)

    # Create RGBA tile
    rgba_tile = np.dstack([rgb_data, alpha])

    # Save to PNG
    with MemoryFile() as memfile:
        with memfile.open(driver="PNG", height=TILE_SIZE, width=TILE_SIZE, count=4, dtype=np.uint8, nodata=0) as dataset:
            for i in range(4):
                dataset.write(rgba_tile[:, :, i], i + 1)
        return Response(content=memfile.read(), media_type="image/png")


@app.get("/ts_v1/tiles/static/{band}/{time}/{z}/{x}/{y}.png")
async def serve_tile(band: str, time: str, z: int, x: int, y: int):
    """Serve a tile."""
    if band not in BANDS:
        raise HTTPException(status_code=404, detail="Band not found")

    # time must match format: "YYYY-MM-DD"
    if not re.match(r"\d{4}-\d{2}-\d{2}", time):
        raise HTTPException(status_code=404, detail="Time must be in format: YYYY-MM-DD")

    time_str = datetime.datetime.strptime(time, "%Y-%m-%d").strftime("%Y%m%d")
    path = f"~/data/modis_net_et_8_day/et_tiles/{time_str}/tiles/{z}/{x}/{y}.png"
    path = os.path.expanduser(path)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return Response(content=f.read(), media_type="image/png")
    else:
        return Response(content=b"", media_type="image/png", status_code=404)


@app.get("/ts_v1")
async def root():
    """Root endpoint."""
    return {"message": "Tile server is running. Use /ts_v1/tiles/{z}/{x}/{y}.png"}
