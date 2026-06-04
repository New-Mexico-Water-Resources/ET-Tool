from __future__ import annotations

import os
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
import rasterio
from rasterio.features import geometry_mask
from rasterio.mask import mask as rasterio_mask
from rasterio.windows import from_bounds, transform as window_transform

from tests.support.paths import TEST_TARGET_GEOJSON

_gridmet_monthly_paths_cache: dict[tuple[int, str], list[str]] = {}


def _valid_raster_values(values: np.ndarray, nodata) -> np.ndarray:
    if nodata is not None:
        values = values[values != nodata]
    return values[~np.isnan(values)]


def mean_raster_under_roi(
    raster_path: Path | str,
    geojson_path: Path = TEST_TARGET_GEOJSON,
    all_touched: bool = True,
) -> float:
    polygon_gdf = gpd.read_file(geojson_path)
    if polygon_gdf.crs is None:
        polygon_gdf = polygon_gdf.set_crs("EPSG:4326")

    with rasterio.open(raster_path) as dataset:
        roi_geometry = polygon_gdf.to_crs(dataset.crs).geometry.iloc[0]
        data = None
        subset_transform = dataset.transform

        minx, miny, maxx, maxy = roi_geometry.bounds
        pixel_width = abs(dataset.transform.a)
        pixel_height = abs(dataset.transform.e)
        minx -= pixel_width
        miny -= pixel_height
        maxx += pixel_width
        maxy += pixel_height

        try:
            window = from_bounds(minx, miny, maxx, maxy, dataset.transform)
            window = window.intersection(rasterio.windows.Window(0, 0, dataset.width, dataset.height))
            if window.width > 0 and window.height > 0:
                data = dataset.read(1, window=window)
                subset_transform = window_transform(window, dataset.transform)
        except rasterio.errors.WindowError:
            data = None

        if data is None:
            data = dataset.read(1)

        for touched in (all_touched, True):
            pixel_mask = geometry_mask(
                [roi_geometry],
                out_shape=data.shape,
                transform=subset_transform,
                invert=True,
                all_touched=touched,
            )
            values = _valid_raster_values(data[pixel_mask], dataset.nodata)
            if len(values) > 0:
                return float(np.mean(values))

        if data.shape[0] <= 100 and data.shape[1] <= 100:
            values = _valid_raster_values(data, dataset.nodata)
            if len(values) > 0:
                return float(np.mean(values))

        raise RuntimeError(f"No raster values found under ROI for {raster_path}")


def mean_raster_under_roi_like_report(
    raster_path: Path | str,
    geojson_path: Path = TEST_TARGET_GEOJSON,
) -> float:
    """Match get_nan_tiff_roi_average masking used when building report CSVs."""
    polygon_gdf = gpd.read_file(geojson_path)
    if polygon_gdf.crs is None:
        polygon_gdf = polygon_gdf.set_crs("EPSG:4326")

    with rasterio.open(raster_path) as dataset:
        roi_geometry = polygon_gdf.to_crs(dataset.crs)
        clipped, _ = rasterio_mask(dataset, roi_geometry.geometry, crop=False, nodata=np.nan)
        values = clipped[0]
        if dataset.nodata is not None:
            values = values[values != dataset.nodata]
        values = values[~np.isnan(values)]
        if len(values) == 0:
            raise RuntimeError(f"No raster values found under ROI for {raster_path}")
        return float(np.mean(values))


def fetch_s3_variable_monthly_mean_mm(
    variable: str,
    year: int,
    month: int,
    temporary_directory: Path,
    geojson_path: Path = TEST_TARGET_GEOJSON,
    *,
    match_report_masking: bool = False,
) -> float:
    """Fetch one monthly tile from S3 and average under the ROI."""
    from water_rights_visualizer.select_tiles import select_tiles

    from tests.support.report_runner import build_s3_source

    polygon = gpd.read_file(geojson_path).geometry.iloc[0]
    tiles = select_tiles(polygon)
    if not tiles:
        raise RuntimeError(f"No S3 tiles found for ROI near {geojson_path}")

    s3 = build_s3_source(temporary_directory)
    acquisition_date = date(year, month, 1)
    mean_fn = mean_raster_under_roi_like_report if match_report_masking else mean_raster_under_roi

    last_error: Exception | None = None
    for tile in tiles:
        try:
            with s3.get_filename(tile, variable, acquisition_date) as raster_path:
                return mean_fn(raster_path, geojson_path)
        except Exception as error:
            last_error = error
            continue

    raise RuntimeError(
        f"Unable to fetch S3 {variable} for {year}-{month:02d} from tiles {tiles}"
    ) from last_error


def fetch_ppt_monthly_mean_mm(
    year: int,
    month: int,
    output_directory: Path,
    roi_name: str,
    geojson_path: Path = TEST_TARGET_GEOJSON,
) -> float:
    """Recompute PPT from the pipeline's ROI-masked subset output."""
    nan_subset_path = (
        output_directory
        / "nan_subsets"
        / roi_name
        / f"{year:04d}.{month:02d}.01_{roi_name}_PPT_subset_nan.tif"
    )
    if nan_subset_path.exists():
        with rasterio.open(nan_subset_path) as dataset:
            values = _valid_raster_values(dataset.read(1), dataset.nodata)
            if len(values) > 0:
                return float(np.mean(values))

    subset_path = (
        output_directory
        / "subset"
        / roi_name
        / f"{year:04d}.{month:02d}.01_{roi_name}_PPT_subset.tif"
    )
    if not subset_path.exists():
        raise RuntimeError(f"Missing report PPT subset: {subset_path}")
    return mean_raster_under_roi(subset_path, geojson_path, all_touched=True)


def fetch_s3_ppt_tile_mean_mm(
    year: int,
    month: int,
    temporary_directory: Path,
    geojson_path: Path = TEST_TARGET_GEOJSON,
) -> float | None:
    """Raw S3 PRISM tile average (best effort; informational only)."""
    try:
        return fetch_s3_variable_monthly_mean_mm(
            "PPT",
            year,
            month,
            temporary_directory,
            geojson_path,
            match_report_masking=False,
        )
    except Exception:
        return None


def fetch_gridmet_monthly_mean_mm(
    year: int,
    month: int,
    geojson_path: Path = TEST_TARGET_GEOJSON,
) -> float:
    from pipelines.gridmet.gridmet_pipeline import GridMETPipeline

    cache_key = (year, "pet")
    if cache_key not in _gridmet_monthly_paths_cache:
        pipeline = GridMETPipeline(bands=["pet"])
        netcdf_paths = pipeline.fetch_year_netcdf(year)
        if not netcdf_paths:
            raise RuntimeError(f"Unable to download gridMET data for {year}")
        _gridmet_monthly_paths_cache[cache_key] = pipeline.process_netcdf(
            netcdf_paths[0]["path"],
            netcdf_paths[0]["band"],
            year,
        )

    month_path = next(
        path
        for path in _gridmet_monthly_paths_cache[cache_key]
        if path.endswith(f"_{month:02d}.tif")
    )
    return mean_raster_under_roi(month_path, geojson_path)


def _exterior_coordinates(geometry) -> list[tuple[float, float]]:
    if geometry.geom_type == "MultiPolygon":
        geometry = max(geometry.geoms, key=lambda part: part.area)
    if geometry.geom_type != "Polygon":
        raise ValueError(f"Unsupported geometry type for OpenET API: {geometry.geom_type}")
    return list(geometry.exterior.coords)


class OpenETApiClient:
    def __init__(self, api_key: str | None = None, base_url: str = "https://openet-api.org"):
        self.api_key = api_key or os.environ.get("OPENET_API_KEY")
        self.base_url = base_url.rstrip("/")

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def polygon_geometry(self, geojson_path: Path = TEST_TARGET_GEOJSON) -> list[float]:
        geometry = gpd.read_file(geojson_path).geometry.iloc[0]
        flat = []
        for lon, lat in _exterior_coordinates(geometry):
            flat.extend([float(lon), float(lat)])
        return flat

    def monthly_polygon_mean(
        self,
        variable: str,
        start_date: str,
        end_date: str,
        geojson_path: Path = TEST_TARGET_GEOJSON,
    ) -> list[dict]:
        if not self.is_configured:
            raise RuntimeError("OPENET_API_KEY is not configured")

        payload = {
            "date_range": [start_date, end_date],
            "interval": "monthly",
            "geometry": self.polygon_geometry(geojson_path),
            "model": "ensemble",
            "variable": variable,
            "reference_et": "gridmet",
            "reducer": "mean",
            "units": "mm",
            "file_format": "json",
            "version": 2.1,
        }
        response = requests.post(
            f"{self.base_url}/raster/timeseries/polygon",
            headers={"Authorization": self.api_key, "Content-Type": "application/json"},
            json=payload,
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        if isinstance(payload, list):
            return payload
        raise RuntimeError(f"Unexpected OpenET API response format: {payload}")


def parse_openet_monthly_values(rows: list[dict], value_keys: tuple[str, ...]) -> dict[int, float]:
    by_month = {}
    for row in rows:
        time_value = row.get("time") or row.get("date") or row.get("start_date")
        if time_value is None:
            continue
        month = int(str(time_value)[5:7])
        for key in value_keys:
            if key in row and row[key] is not None:
                by_month[month] = float(row[key])
                break
    return by_month


def relative_difference(reference: float, actual: float) -> float:
    if reference == 0:
        return abs(actual)
    return abs(actual - reference) / abs(reference)


def openet_api_available() -> bool:
    return bool(os.environ.get("OPENET_API_KEY"))
