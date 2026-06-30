import calendar
import datetime
import json
import os
import time
from collections import defaultdict
from contextlib import contextmanager
from logging import getLogger
from os.path import exists, join

import geopandas as gpd
import numpy as np
import planetary_computer
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.features import geometry_mask
from rasterio.mask import mask
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_geom
from shapely.geometry import MultiPolygon, Polygon, mapping, shape

from .constants import ARD_TILES_FILENAME, CELL_SIZE_DEGREES, WGS84
from .landsat_pass_count import (
    create_planetary_computer_catalog,
    extract_cloud_mask_from_qa,
    fetch_landsat_items_for_geometry,
    normalize_roi_geometries,
)

logger = getLogger(__name__)

PRODUCT_PREFIX = "LANDSAT_PASS"
DEFAULT_LAYER_SUBDIR = "landsat_pass_layers"
DEFAULT_SAT_IDS = ["landsat-5", "landsat-7", "landsat-8", "landsat-9"]

BAND_TOTAL_OBSERVATIONS = 1
BAND_NON_CLOUDY_OBSERVATIONS = 2
BAND_PASS_DAYS = 3

BAND_DESCRIPTIONS = {
    BAND_TOTAL_OBSERVATIONS: "total_observations",
    BAND_NON_CLOUDY_OBSERVATIONS: "non_cloudy_observations",
    BAND_PASS_DAYS: "pass_days",
}


@contextmanager
def _clear_broken_proj_data_env():
    """Avoid bundled PROJ databases that break EPSG lookups in some environments."""
    saved_proj_data = os.environ.pop("PROJ_DATA", None)
    saved_proj_lib = os.environ.pop("PROJ_LIB", None)
    try:
        yield
    finally:
        if saved_proj_data is not None:
            os.environ["PROJ_DATA"] = saved_proj_data
        if saved_proj_lib is not None:
            os.environ["PROJ_LIB"] = saved_proj_lib


def month_date_bounds(year: int, month: int) -> tuple[str, str]:
    start_date = f"{year}-{month:02d}-01"
    end_date = f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]}"
    return start_date, end_date


def landsat_pass_layer_basename(hv: str, year: int, month: int) -> str:
    start_date, end_date = month_date_bounds(year, month)
    start_tag = start_date.replace("-", "")
    end_tag = end_date.replace("-", "")
    return f"{PRODUCT_PREFIX}_{hv}_{start_tag}_{end_tag}"


def landsat_pass_layer_path(cache_directory: str, hv: str, year: int, month: int) -> str:
    basename = landsat_pass_layer_basename(hv, year, month)
    layer_directory = join(cache_directory, DEFAULT_LAYER_SUBDIR)
    return join(layer_directory, f"{basename}.tif")


def tile_reference_grid(geometry: Polygon, cell_size: float = CELL_SIZE_DEGREES) -> tuple[int, int, Affine, str]:
    minx, miny, maxx, maxy = geometry.bounds
    width = max(1, int(np.ceil((maxx - minx) / cell_size)))
    height = max(1, int(np.ceil((maxy - miny) / cell_size)))
    transform = from_bounds(minx, miny, maxx, maxy, width, height)
    return height, width, transform, WGS84


def _reproject_scene_qa_to_grid(
    qa_href: str,
    mask_geometry: Polygon,
    ref_transform: Affine,
    ref_crs: str,
    ref_height: int,
    ref_width: int,
    raster_crs: str | None = None,
) -> tuple[np.ndarray, np.ndarray] | None:
    with _clear_broken_proj_data_env():
        with rasterio.open(qa_href) as qa_src:
            src_crs = qa_src.crs
            if src_crs is None and raster_crs:
                src_crs = CRS.from_string(str(raster_crs))
            if src_crs is None:
                logger.warning(f"QA raster has no CRS: {qa_href}")
                return None

            try:
                roi_transformed = transform_geom("EPSG:4326", src_crs, mapping(mask_geometry))
                roi_for_masking = shape(roi_transformed)
            except Exception as exc:
                logger.warning(f"Failed to transform mask geometry for QA mask: {exc}")
                return None

            try:
                qa_masked, qa_transform = mask(qa_src, [roi_for_masking], crop=True, filled=False)
            except Exception as exc:
                logger.warning(f"Failed to mask QA raster {qa_href}: {exc}")
                return None

            qa_data = qa_masked[0]
            if qa_data.mask.all():
                return None

            cloud_mask = extract_cloud_mask_from_qa(qa_data.data)
            valid_pixels = ~qa_data.mask
            inside_geometry = geometry_mask(
                [roi_for_masking],
                out_shape=qa_data.shape,
                transform=qa_transform,
                invert=True,
                all_touched=True,
            )
            if not np.any(inside_geometry):
                return None

            # Match live Planetary Computer semantics: every pixel inside the
            # scene footprint counts as an observation; nodata and clouds are cloudy.
            scene_total = np.where(inside_geometry, 1, 0).astype(np.float32)
            scene_clear = np.where(inside_geometry & valid_pixels & ~cloud_mask, 1, 0).astype(np.float32)

            dest_total = np.zeros((ref_height, ref_width), dtype=np.float32)
            dest_clear = np.zeros((ref_height, ref_width), dtype=np.float32)
            for source, destination in (
                (scene_total, dest_total),
                (scene_clear, dest_clear),
            ):
                reproject(
                    source=source,
                    destination=destination,
                    src_transform=qa_transform,
                    src_crs=src_crs,
                    dst_transform=ref_transform,
                    dst_crs=ref_crs,
                    resampling=Resampling.nearest,
                )

            return dest_total.astype(np.uint16), dest_clear.astype(np.uint16)


def accumulate_landsat_observations_for_tile(
    tile_geometry: Polygon,
    month: int,
    year: int,
    sat_ids: list[str] | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict], set[str]] | None:
    if sat_ids is None:
        sat_ids = DEFAULT_SAT_IDS

    ref_height, ref_width, ref_transform, ref_crs = tile_reference_grid(tile_geometry)
    total_observations = np.zeros((ref_height, ref_width), dtype=np.uint16)
    non_cloudy_observations = np.zeros((ref_height, ref_width), dtype=np.uint16)
    pass_days = np.zeros((ref_height, ref_width), dtype=np.uint16)

    pass_list: list[dict] = []
    unique_passes: set[str] = set()
    items_by_date: dict[datetime.date, list] = defaultdict(list)

    catalog, stac_api_io = create_planetary_computer_catalog()
    try:
        items = fetch_landsat_items_for_geometry(catalog, tile_geometry, month, year)
        for item in items:
            platform = item.properties.get("platform")
            if platform not in sat_ids:
                continue

            pass_key = f"{platform}-{item.datetime.strftime('%m-%d-%Y')}"
            unique_passes.add(pass_key)
            pass_list.append({"date": str(item.datetime.date()), "satellite": platform, "id": item.id})
            items_by_date[item.datetime.date()].append(item)

        for acquisition_date in sorted(items_by_date):
            day_covered = np.zeros((ref_height, ref_width), dtype=bool)
            for item in items_by_date[acquisition_date]:
                qa_asset = item.assets.get("qa_pixel")
                if not qa_asset:
                    logger.warning(f"No QA_PIXEL asset found for item {item.id}")
                    continue

                try:
                    scene_geometry = shape(item.geometry)
                    mask_geometry = tile_geometry.intersection(scene_geometry)
                    if mask_geometry.is_empty:
                        continue

                    qa_href = planetary_computer.sign(qa_asset.href)
                    scene_crs = item.properties.get("proj:code") or item.properties.get("proj:epsg")
                    scene_counts = _reproject_scene_qa_to_grid(
                        qa_href,
                        mask_geometry,
                        ref_transform,
                        ref_crs,
                        ref_height,
                        ref_width,
                        raster_crs=scene_crs,
                    )
                    if scene_counts is None:
                        continue

                    scene_total, scene_clear = scene_counts
                    total_observations += scene_total
                    non_cloudy_observations += scene_clear
                    day_covered |= scene_total > 0
                except Exception as exc:
                    logger.warning(f"Error processing QA data for item {item.id}: {exc}")
                    continue

            pass_days[day_covered] += 1
    finally:
        stac_api_io.session.close()

    if not np.any(total_observations):
        return None

    return total_observations, non_cloudy_observations, pass_days, pass_list, unique_passes


def write_landsat_pass_cog(
    layer_path: str,
    total_observations: np.ndarray,
    non_cloudy_observations: np.ndarray,
    pass_days: np.ndarray,
    transform: Affine,
    crs: str,
    hv: str,
    year: int,
    month: int,
    pass_list: list[dict],
    unique_passes: set[str],
    sat_ids: list[str],
) -> None:
    os.makedirs(os.path.dirname(layer_path), exist_ok=True)

    profile = {
        "driver": "COG",
        "height": total_observations.shape[0],
        "width": total_observations.shape[1],
        "count": 3,
        "dtype": "uint16",
        "crs": crs,
        "transform": transform,
        "compress": "DEFLATE",
        "predictor": 2,
        "blocksize": 512,
        "overview_resampling": "nearest",
        "nodata": 0,
    }

    with rasterio.open(layer_path, "w", **profile) as dst:
        dst.write(total_observations, BAND_TOTAL_OBSERVATIONS)
        dst.write(non_cloudy_observations, BAND_NON_CLOUDY_OBSERVATIONS)
        dst.write(pass_days, BAND_PASS_DAYS)
        for band_index, description in BAND_DESCRIPTIONS.items():
            dst.set_band_description(band_index, description)
        dst.update_tags(
            hv=hv,
            year=year,
            month=month,
            pass_count=len(unique_passes),
            pass_days_max=int(pass_days.max()),
            sat_ids=",".join(sat_ids),
            date_generated=str(datetime.datetime.now()),
            pass_list=json.dumps(pass_list),
        )

    file_size_mb = os.path.getsize(layer_path) / (1024 * 1024)
    logger.info(
        f"Wrote Landsat pass COG for tile {hv} {year}-{month:02d}: "
        f"{layer_path} ({len(unique_passes)} passes, {file_size_mb:.2f} MB)"
    )


def generate_landsat_pass_layer_for_tile(
    tile_geometry: Polygon,
    hv: str,
    month: int,
    year: int,
    cache_directory: str,
    sat_ids: list[str] | None = None,
    overwrite: bool = False,
) -> str | None:
    if sat_ids is None:
        sat_ids = DEFAULT_SAT_IDS

    layer_path = landsat_pass_layer_path(cache_directory, hv, year, month)
    if exists(layer_path) and not overwrite:
        logger.info(f"Using existing Landsat pass layer for tile {hv} {year}-{month:02d}: {layer_path}")
        return layer_path

    start_time = time.time()
    accumulation = accumulate_landsat_observations_for_tile(
        tile_geometry,
        month,
        year,
        sat_ids=sat_ids,
    )

    if accumulation is None:
        logger.warning(f"No valid Landsat observations found for tile {hv} {year}-{month:02d}")
        return None

    total_observations, non_cloudy_observations, pass_days, pass_list, unique_passes = accumulation
    _, _, transform, crs = tile_reference_grid(tile_geometry)
    write_landsat_pass_cog(
        layer_path,
        total_observations,
        non_cloudy_observations,
        pass_days,
        transform,
        crs,
        hv,
        year,
        month,
        pass_list,
        unique_passes,
        sat_ids,
    )
    logger.info(
        f"Generated Landsat pass COG for tile {hv} {year}-{month:02d} "
        f"with {len(unique_passes)} passes in {time.time() - start_time:.2f} seconds"
    )
    return layer_path


def load_tiles_geojson(
    tiles_geojson: str | None = None,
    tile_ids: list[str] | None = None,
) -> gpd.GeoDataFrame:
    tiles_geojson = tiles_geojson or ARD_TILES_FILENAME
    tiles_gdf = gpd.read_file(tiles_geojson).to_crs(WGS84)
    if tile_ids:
        normalized_ids = {tile_id.lower().replace("cu", "") for tile_id in tile_ids}
        tiles_gdf = tiles_gdf[tiles_gdf["hv"].astype(str).isin(normalized_ids)]
    return tiles_gdf


def generate_landsat_pass_layers(
    year: int,
    month: int,
    cache_directory: str,
    tiles_geojson: str | None = None,
    tile_ids: list[str] | None = None,
    sat_ids: list[str] | None = None,
    overwrite: bool = False,
) -> list[str]:
    tiles_gdf = load_tiles_geojson(tiles_geojson=tiles_geojson, tile_ids=tile_ids)
    generated_layers: list[str] = []

    for _, feature in tiles_gdf.iterrows():
        hv = str(feature["hv"])
        layer_path = generate_landsat_pass_layer_for_tile(
            feature.geometry,
            hv,
            month,
            year,
            cache_directory,
            sat_ids=sat_ids,
            overwrite=overwrite,
        )
        if layer_path is not None:
            generated_layers.append(layer_path)

    return generated_layers


def _try_download_layer_from_s3(
    s3_client,
    bucket: str,
    key_prefix: str,
    layer_path: str,
    hv: str,
    year: int,
    month: int,
) -> bool:
    basename = landsat_pass_layer_basename(hv, year, month)
    layer_key = join(key_prefix, f"{basename}.tif").lstrip("/")

    try:
        os.makedirs(os.path.dirname(layer_path), exist_ok=True)
        s3_client.download_file(bucket, layer_key, layer_path)
        return True
    except Exception as exc:
        logger.debug(f"Unable to download Landsat pass layer for tile {hv} from S3: {exc}")
        if exists(layer_path):
            os.remove(layer_path)
        return False


def resolve_landsat_pass_layer(
    hv: str,
    year: int,
    month: int,
    cache_directory: str,
    s3_bucket: str | None = None,
    s3_key_prefix: str = "",
    s3_client=None,
) -> str | None:
    layer_path = landsat_pass_layer_path(cache_directory, hv, year, month)
    if exists(layer_path):
        return layer_path

    if s3_bucket and s3_client is not None:
        if _try_download_layer_from_s3(
            s3_client,
            bucket,
            s3_key_prefix,
            layer_path,
            hv,
            year,
            month,
        ):
            return layer_path

    return None


def _roi_union(roi: Polygon | list[Polygon] | MultiPolygon) -> Polygon | MultiPolygon:
    geometries = normalize_roi_geometries(roi)
    if len(geometries) == 1:
        return geometries[0]
    return MultiPolygon(geometries)


def _tiles_for_roi(roi: Polygon | list[Polygon] | MultiPolygon, tiles_geojson: str | None = None) -> gpd.GeoDataFrame:
    from .select_tiles import select_tiles

    roi_geometry = _roi_union(roi)
    tile_hvs = select_tiles(roi_geometry)
    if not tile_hvs:
        return gpd.GeoDataFrame()

    tiles_gdf = load_tiles_geojson(tiles_geojson=tiles_geojson)
    return tiles_gdf[tiles_gdf["hv"].astype(str).isin(tile_hvs)]


def _pixel_cloud_fractions_from_bands(
    total_observations: np.ndarray,
    non_cloudy_observations: np.ndarray,
    roi_geometry: Polygon | list[Polygon] | MultiPolygon,
    transform: Affine,
) -> tuple[np.ndarray, int, int, int]:
    geometries = normalize_roi_geometries(roi_geometry)
    roi_mask = geometry_mask(geometries, out_shape=total_observations.shape, transform=transform, invert=True)
    valid_pixels = roi_mask & (total_observations > 0)

    if not np.any(valid_pixels):
        return np.array([], dtype=np.float64), 0, 0, 0

    total = total_observations[valid_pixels].astype(np.int64)
    clear = non_cloudy_observations[valid_pixels].astype(np.int64)
    cloudy = total - clear

    with np.errstate(divide="ignore", invalid="ignore"):
        cloud_coverage_per_pixel = (cloudy / total) * 100

    return (
        cloud_coverage_per_pixel.astype(np.float64),
        int(total.sum()),
        int(cloudy.sum()),
        int(valid_pixels.sum()),
    )


def aggregate_landsat_pass_stats_from_layers(
    roi: Polygon | list[Polygon] | MultiPolygon,
    month: int,
    year: int,
    cache_directory: str,
    tiles_geojson: str | None = None,
    s3_bucket: str | None = None,
    s3_key_prefix: str = "",
    s3_client=None,
) -> dict | None:
    tiles_gdf = _tiles_for_roi(roi, tiles_geojson=tiles_geojson)
    if tiles_gdf.empty:
        return None

    roi_geometry = _roi_union(roi)
    pixel_cloud_fractions: list[np.ndarray] = []
    total_observations = 0
    cloudy_observations = 0
    pass_days_values: list[int] = []
    pass_list: list[dict] = []
    unique_passes: set[str] = set()

    for _, tile in tiles_gdf.iterrows():
        hv = str(tile["hv"])
        layer_path = resolve_landsat_pass_layer(
            hv,
            year,
            month,
            cache_directory,
            s3_bucket=s3_bucket,
            s3_key_prefix=s3_key_prefix,
            s3_client=s3_client,
        )
        if layer_path is None:
            logger.info(f"Missing Cloud Coverage Landsat pass layer for tile {hv} {year}-{month:02d}")
            return None

        with rasterio.open(layer_path) as src:
            total_band = src.read(BAND_TOTAL_OBSERVATIONS)
            clear_band = src.read(BAND_NON_CLOUDY_OBSERVATIONS)
            pass_days_band = src.read(BAND_PASS_DAYS)
            fractions, tile_total_obs, tile_cloudy_obs, _ = _pixel_cloud_fractions_from_bands(
                total_band,
                clear_band,
                roi_geometry,
                src.transform,
            )

            if fractions.size > 0:
                pixel_cloud_fractions.append(fractions)
            total_observations += tile_total_obs
            cloudy_observations += tile_cloudy_obs

            geometries = normalize_roi_geometries(roi_geometry)
            roi_mask = geometry_mask(geometries, out_shape=pass_days_band.shape, transform=src.transform, invert=True)
            roi_pass_days = pass_days_band[roi_mask & (total_band > 0)]
            if roi_pass_days.size > 0:
                pass_days_values.append(int(np.max(roi_pass_days)))

            if src.tags().get("pass_list"):
                for pass_entry in json.loads(src.tags()["pass_list"]):
                    pass_key = f"{pass_entry['satellite']}-{pass_entry['date']}"
                    if pass_key not in unique_passes:
                        unique_passes.add(pass_key)
                        pass_list.append(pass_entry)

    pass_count = max(pass_days_values) if pass_days_values else 0

    if not pixel_cloud_fractions and total_observations == 0:
        return {
            "year": year,
            "month": month,
            "mean_cloud_coverage": None,
            "total_observations": 0,
            "cloudy_observations": 0,
            "pass_count": pass_count,
            "pass_list": pass_list,
            "source": "layer_cache",
        }

    all_fractions = np.concatenate(pixel_cloud_fractions) if pixel_cloud_fractions else np.array([], dtype=np.float64)
    mean_cloud_coverage = float(np.nanmean(all_fractions)) if all_fractions.size > 0 else None
    return {
        "year": year,
        "month": month,
        "mean_cloud_coverage": mean_cloud_coverage,
        "total_observations": total_observations,
        "cloudy_observations": cloudy_observations,
        "pass_count": pass_count,
        "pass_list": pass_list,
        "source": "layer_cache",
    }
