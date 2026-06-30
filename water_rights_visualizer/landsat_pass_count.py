import os
import time
import json
import datetime
import calendar
import pystac_client
import planetary_computer
import geopandas as gpd
import numpy as np
import rasterio
from rasterio.mask import mask
from rasterio.crs import CRS
from rasterio.features import geometry_mask
from requests.adapters import HTTPAdapter, Retry
from pystac_client.stac_api_io import StacApiIO
import pyproj
from shapely.ops import transform
from rasterio.warp import transform_geom

# Set environment variables to fix PROJ database issues
os.environ.setdefault("GTIFF_SRS_SOURCE", "EPSG")


from shapely.geometry import Polygon, MultiPolygon, shape
from logging import getLogger

logger = getLogger(__name__)

WGS84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
DEFAULT_SAT_IDS = ["landsat-5", "landsat-7", "landsat-8", "landsat-9"]


def normalize_roi_geometries(roi: Polygon | list[Polygon] | MultiPolygon) -> list[Polygon]:
    if isinstance(roi, Polygon):
        return [roi]
    if isinstance(roi, MultiPolygon):
        return list(roi.geoms)
    return list(roi)


def search_catalog_with_retries(catalog, bbox, datetime, collections=["landsat-c2-l2"], retries=3):
    for i in range(retries):
        try:
            return catalog.search(collections=collections, bbox=bbox, datetime=datetime)
        except Exception as e:
            logger.error(f"Error searching for Landsat passes: {e}")
            time.sleep(i + 1)
            continue
    raise Exception("Failed to search for Landsat passes")


def get_items_with_retries(search, retries=3):
    for i in range(retries):
        try:
            return search.items()
        except Exception as e:
            logger.error(f"Error getting items: {e}")
            time.sleep(i + 1)
            continue


def create_planetary_computer_catalog() -> tuple[pystac_client.Client, StacApiIO]:
    stac_api_io = StacApiIO()
    retries = Retry(total=5, backoff_factor=1, status_forcelist=[502, 503, 504])
    stac_api_io.session.mount("http://", HTTPAdapter(max_retries=retries))
    stac_api_io.session.mount("https://", HTTPAdapter(max_retries=retries))

    catalog = pystac_client.Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1",
        modifier=planetary_computer.sign_inplace,
        stac_io=stac_api_io,
    )
    return catalog, stac_api_io


def fetch_landsat_items_for_geometry(catalog, geometry: Polygon, month: int, year: int):
    start_date = f"{year}-{month:02d}-01"
    end_date = f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]}"

    search = search_catalog_with_retries(catalog, geometry.bounds, f"{start_date}/{end_date}")
    for i in range(3):
        try:
            items = get_items_with_retries(search, retries=3)
            return list(items) if items else []
        except Exception as e:
            logger.error(f"Error getting items: {e}")
            time.sleep(i + 1)
            continue
    return []


def get_landsat_month_stats(
    roi: Polygon | list[Polygon] | MultiPolygon,
    month: int,
    year: int,
    subset_directory: str = "",
    sat_ids: list[str] | None = None,
    target_crs: str = "EPSG:4326",
    tiles_geojson: str | None = None,
    layer_cache_directory: str | None = None,
    s3_bucket: str | None = None,
    s3_key_prefix: str = "",
    s3_client=None,
    prefer_layer_cache: bool = True,
    write_json_cache: bool = True,
) -> dict:
    """
    Return monthly Landsat pass and cloud-coverage statistics for an ROI.

    Uses pre-generated monthly Landsat pass COG layers when available for all
    intersecting ARD tiles, otherwise falls back to querying the Planetary Computer directly.
    """
    if sat_ids is None:
        sat_ids = DEFAULT_SAT_IDS

    cache_directory = layer_cache_directory or os.environ.get("LANDSAT_PASS_LAYER_DIR") or subset_directory or "."
    stats = None
    if prefer_layer_cache:
        from .landsat_pass_layers import aggregate_landsat_pass_stats_from_layers

        cached_stats = aggregate_landsat_pass_stats_from_layers(
            roi,
            month,
            year,
            cache_directory=cache_directory,
            tiles_geojson=tiles_geojson,
            s3_bucket=s3_bucket,
            s3_key_prefix=s3_key_prefix,
            s3_client=s3_client,
        )
        if cached_stats is not None:
            logger.info(
                f"Retrieved Landsat pass stats for {year}-{month:02d} from layer cache "
                f"(pass_count={cached_stats.get('pass_count')})"
            )
            stats = cached_stats

    if stats is None:
        stats = _fetch_monthly_cloud_coverage_from_planetary_computer(
            roi,
            month,
            year,
            subset_directory=subset_directory,
            sat_ids=sat_ids,
            target_crs=target_crs,
            write_json_cache=False,
        )
        stats["source"] = "planetary_computer"
    elif "source" not in stats:
        stats["source"] = "layer_cache"

    if write_json_cache and subset_directory:
        _write_cloud_coverage_cache(stats, subset_directory)

    return stats


def count_landsat_passes_for_month(
    roi: Polygon | list[Polygon] | MultiPolygon,
    month: int,
    year: int,
    subset_directory: str = "",
    sat_ids: list[str] | None = None,
    tiles_geojson: str | None = None,
    s3_bucket: str | None = None,
    s3_key_prefix: str = "",
    s3_client=None,
) -> int:
    """
    Count the number of unique Landsat passes for a given month and year within a specified region of interest (ROI).

    Args:
        roi (Polygon | list[Polygon] | MultiPolygon): The region of interest as a shapely geometry.
        month (int): The month for which to count the passes.
        year (int): The year for which to count the passes.
        subset_directory (str): Base directory for cached monthly Landsat pass layers and legacy JSON cache.
        sat_ids (list): List of satellite IDs to include in the count.
    """
    stats = get_landsat_month_stats(
        roi,
        month,
        year,
        subset_directory=subset_directory,
        sat_ids=sat_ids,
        tiles_geojson=tiles_geojson,
        s3_bucket=s3_bucket,
        s3_key_prefix=s3_key_prefix,
        s3_client=s3_client,
    )
    return stats.get("pass_count", 0) or 0


def extract_cloud_mask_from_qa(qa_array: np.ndarray) -> np.ndarray:
    """
    Extract cloud and cloud shadow mask from Landsat Collection 2 QA_PIXEL band.

    For Landsat Collection 2 Level 2, cloud and cloud shadow information is in:
    - Bit 3: Cloud confidence bit 0
    - Bit 4: Cloud confidence bit 1
    - Bit 5: Cloud shadow confidence

    Cloud confidence values:
    - 00 (0): No confidence level set (not determined)
    - 01 (1): Low confidence cloud
    - 10 (2): Medium confidence cloud
    - 11 (3): High confidence cloud

    Cloud shadow confidence:
    - 0: No cloud shadow
    - 1: Cloud shadow

    Args:
        qa_array (np.ndarray): QA_PIXEL band array

    Returns:
        np.ndarray: Boolean array where True indicates cloud or cloud shadow pixels
    """
    # Extract bits 3-4 for cloud confidence
    cloud_confidence = (qa_array >> 3) & 0b11

    # Extract bit 5 for cloud shadow
    cloud_shadow = (qa_array >> 5) & 0b1

    # Consider medium and high confidence as clouds (values 2 and 3)
    cloud_mask = cloud_confidence >= 2

    # Include cloud shadows in the mask
    cloud_shadow_mask = cloud_shadow == 1

    # Combine cloud and cloud shadow masks
    combined_mask = cloud_mask | cloud_shadow_mask

    return combined_mask


def calculate_monthly_cloud_coverage(
    roi: Polygon | list[Polygon] | MultiPolygon,
    month: int,
    year: int,
    subset_directory: str = "",
    sat_ids: list[str] | None = None,
    target_crs: str = "EPSG:4326",
    tiles_geojson: str | None = None,
    layer_cache_directory: str | None = None,
    s3_bucket: str | None = None,
    s3_key_prefix: str = "",
    s3_client=None,
) -> dict:
    """
    Calculate average cloud and cloud shadow coverage for a given month using QA_PIXEL band.

    For each pixel in the ROI, determines the ratio of cloudy/shadowed observations
    to total observations during the specified month. This includes:
    - Cloud pixels (low, medium, high confidence)
    - Cloud shadow pixels
    - Missing data pixels (treated as cloudy)

    Args:
        roi (Polygon | list[Polygon]): The region of interest as a shapely geometry
        month (int): The month for which to calculate cloud coverage
        year (int): The year for which to calculate cloud coverage
        subset_directory (str): Directory to cache results
        sat_ids (list): List of satellite IDs to include
        target_crs (str): Target CRS for reprojection

    Returns:
        dict: Contains 'mean_cloud_coverage', 'total_observations', 'cloudy_observations'
              where cloudy_observations includes clouds, cloud shadows, and missing data
    """
    return get_landsat_month_stats(
        roi,
        month,
        year,
        subset_directory=subset_directory,
        sat_ids=sat_ids,
        target_crs=target_crs,
        tiles_geojson=tiles_geojson,
        layer_cache_directory=layer_cache_directory,
        s3_bucket=s3_bucket,
        s3_key_prefix=s3_key_prefix,
        s3_client=s3_client,
    )


def _legacy_pass_count_cache_path(subset_directory: str, year: int, month: int) -> str:
    if not subset_directory:
        cache_directory = "landsat_pass_count_cache"
    else:
        cache_directory = os.path.join(subset_directory, "landsat_pass_count_cache")
    os.makedirs(cache_directory, exist_ok=True)
    return f"{cache_directory}/landsat_pass_count_{year}_{month:02d}.json"


def _legacy_cloud_coverage_cache_path(subset_directory: str, year: int, month: int) -> str:
    if not subset_directory:
        cache_directory = "cloud_coverage_cache"
    else:
        cache_directory = os.path.join(subset_directory, "cloud_coverage_cache")
    os.makedirs(cache_directory, exist_ok=True)
    return f"{cache_directory}/cloud_coverage_{year}_{month:02d}.json"


def _write_cloud_coverage_cache(stats: dict, subset_directory: str) -> None:
    year = int(stats["year"])
    month = int(stats["month"])
    cache_filename = _legacy_cloud_coverage_cache_path(subset_directory, year, month)
    cache_payload = {
        "year": year,
        "month": month,
        "mean_cloud_coverage": stats.get("mean_cloud_coverage"),
        "total_observations": stats.get("total_observations", 0) or 0,
        "cloudy_observations": stats.get("cloudy_observations", 0) or 0,
        "pass_count": stats.get("pass_count", 0) or 0,
        "pass_list": stats.get("pass_list", []),
        "date_fetched": stats.get("date_fetched") or str(datetime.datetime.now()),
        "source": stats.get("source"),
    }
    with open(cache_filename, "w") as cache_writer:
        logger.info(
            f"Writing cloud coverage to cache: {cache_filename} "
            f"(pass_count={cache_payload['pass_count']})"
        )
        cache_writer.write(json.dumps(cache_payload))


def _fetch_monthly_cloud_coverage_from_planetary_computer(
    roi: Polygon | list[Polygon] | MultiPolygon,
    month: int,
    year: int,
    subset_directory: str = "",
    sat_ids: list[str] | None = None,
    target_crs: str = "EPSG:4326",
    write_json_cache: bool = True,
) -> dict:
    start_time = time.time()
    if sat_ids is None:
        sat_ids = DEFAULT_SAT_IDS

    cache_filename = _legacy_cloud_coverage_cache_path(subset_directory, year, month)
    if write_json_cache and os.path.exists(cache_filename):
        with open(cache_filename, "r") as cache_reader:
            try:
                metadata = json.load(cache_reader)
                logger.info(
                    f"Retrieved cached cloud coverage: {metadata.get('mean_cloud_coverage', 'N/A')}% for {year}-{month:02d} from {os.path.abspath(cache_filename)}"
                )
                return metadata
            except:
                pass

    catalog, stac_api_io = create_planetary_computer_catalog()
    rois = normalize_roi_geometries(roi)

    total_observations = None
    cloudy_observations = None
    unique_dates = set()
    pass_list = []

    try:
        for area in rois:
            items = fetch_landsat_items_for_geometry(catalog, area, month, year)
            if not items:
                continue

            for item in items:
                platform = item.properties.get("platform")
                if platform not in sat_ids:
                    continue

                unique_dates.add(f"{item.properties.get('platform')}-{item.datetime.strftime('%m-%d-%Y')}")
                pass_list.append({"date": str(item.datetime.date()), "satellite": platform, "id": item.id})

                try:
                    qa_asset = item.assets.get("qa_pixel")
                    if not qa_asset:
                        logger.warning(f"No QA_PIXEL asset found for item {item.id}")
                        continue

                    qa_href = planetary_computer.sign(qa_asset.href)

                    with rasterio.open(qa_href) as qa_src:
                        try:
                            roi_for_masking = area
                            if qa_src.crs is not None and qa_src.crs != CRS.from_string(target_crs):
                                roi_dict = {"type": "Polygon", "coordinates": [list(area.exterior.coords)]}
                                roi_transformed = transform_geom(target_crs, qa_src.crs, roi_dict)
                                roi_for_masking = shape(roi_transformed)

                            qa_data_masked, qa_transform = mask(qa_src, [roi_for_masking], crop=True, filled=False)
                            qa_data = qa_data_masked[0]

                            if qa_data.mask.all():
                                continue

                            cloud_mask = extract_cloud_mask_from_qa(qa_data.data)

                            if total_observations is None or qa_data.shape != total_observations.shape:
                                total_observations = np.zeros(qa_data.shape, dtype=np.int32)
                                cloudy_observations = np.zeros(qa_data.shape, dtype=np.int32)

                            inside_roi = geometry_mask(
                                [roi_for_masking],
                                out_shape=qa_data.shape,
                                transform=qa_transform,
                                invert=True,
                            )
                            if not np.any(inside_roi):
                                continue

                            total_observations[inside_roi] += 1

                            valid_pixels = ~qa_data.mask
                            cloudy_pixels = inside_roi & ((valid_pixels & cloud_mask) | qa_data.mask)
                            if cloudy_observations is not None:
                                cloudy_observations[cloudy_pixels] += 1

                        except Exception as e:
                            logger.warning(f"Error processing QA data for item {item.id}: {e}")
                            continue

                except Exception as e:
                    logger.error(f"Error accessing QA data for item {item.id}: {e}")
                    continue
    finally:
        stac_api_io.session.close()

    if total_observations is None:
        logger.warning(f"No valid observations found for {year}-{month:02d}")
        result = {
            "year": year,
            "month": month,
            "mean_cloud_coverage": None,
            "total_observations": 0,
            "cloudy_observations": 0,
            "pass_count": len(unique_dates),
            "pass_list": pass_list,
            "date_fetched": str(datetime.datetime.now()),
        }
    else:
        with np.errstate(divide="ignore", invalid="ignore"):
            cloud_coverage_per_pixel = np.where(
                total_observations > 0,
                (cloudy_observations / total_observations) * 100 if cloudy_observations is not None else np.nan,
                np.nan,
            )

        valid_pixels = total_observations > 0
        if np.any(valid_pixels):
            mean_cloud_coverage = np.nanmean(cloud_coverage_per_pixel[valid_pixels])
        else:
            mean_cloud_coverage = None

        result = {
            "year": year,
            "month": month,
            "mean_cloud_coverage": float(mean_cloud_coverage) if mean_cloud_coverage is not None else None,
            "total_observations": int(np.sum(total_observations)) if total_observations is not None else 0,
            "cloudy_observations": int(np.sum(cloudy_observations)) if cloudy_observations is not None else 0,
            "pass_count": len(unique_dates),
            "pass_list": pass_list,
            "date_fetched": str(datetime.datetime.now()),
        }

    if write_json_cache:
        with open(cache_filename, "w") as cache_writer:
            logger.info(f"Writing cloud coverage to cache: {cache_filename}")
            cache_writer.write(json.dumps(result))

    cloud_coverage_str = f"{result['mean_cloud_coverage']:.2f}%" if result["mean_cloud_coverage"] is not None else "N/A"
    logger.info(
        f"Year: {year}, Month: {month:02d}, Mean Cloud Coverage: {cloud_coverage_str}, Time: {time.time() - start_time:.2f} seconds"
    )

    return result


if __name__ == "__main__":
    ROI = "../Example.geojson"
    ROI_latlon = gpd.read_file(ROI).to_crs(WGS84).geometry[0]
    month = 6
    year = 2023

    pass_count = count_landsat_passes_for_month(ROI_latlon, month, year)
    print(f"Landsat passes for {month}/{year}: {pass_count}")
