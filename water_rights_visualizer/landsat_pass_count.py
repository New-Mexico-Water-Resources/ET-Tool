import os
import time
import json
import datetime
import pystac_client
import planetary_computer
import calendar
import geopandas as gpd
import numpy as np
import rasterio
from rasterio.mask import mask
from rasterio.warp import reproject, Resampling
from rasterio.crs import CRS
from requests.adapters import HTTPAdapter, Retry
from pystac_client.stac_api_io import StacApiIO
import pyproj
from shapely.ops import transform
from rasterio.warp import transform_geom

# Set environment variables to fix PROJ database issues
os.environ.setdefault("GTIFF_SRS_SOURCE", "EPSG")
# Try to use pyproj's PROJ data if available
try:
    import pyproj

    pyproj_data_path = os.path.join(os.path.dirname(pyproj.__file__), "proj_dir", "share", "proj")
    if os.path.exists(pyproj_data_path):
        os.environ.setdefault("PROJ_DATA", pyproj_data_path)
except:
    pass


from shapely.geometry import Polygon, MultiPolygon, shape
from shapely import to_geojson
from logging import getLogger

logger = getLogger(__name__)

WGS84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"


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


def count_landsat_passes_for_month(
    roi: Polygon | list[Polygon],
    month: int,
    year: int,
    subset_directory: str = "",
    sat_ids=["landsat-5", "landsat-7", "landsat-8", "landsat-9"],
) -> int:
    """
    Count the number of unique Landsat passes for a given month and year within a specified region of interest (ROI).

    Args:
        roi (Polygon | list[Polygon]): The region of interest as a shapely geometry.
        month (int): The month for which to count the passes.
        year (int): The year for which to count the passes.
        subset_directory (str): The directory to cache month layers to reduce repeat calls to the planetary computer.
        sat_ids (list): List of satellite IDs to include in the count. Default is ["landsat-5", "landsat-7", "landsat-8"].
    """
    start_time = time.time()
    if not subset_directory:
        subset_directory = "landsat_pass_count_cache"
    else:
        subset_directory = os.path.join(subset_directory, "landsat_pass_count_cache")

    if not os.path.exists(subset_directory):
        os.makedirs(subset_directory, exist_ok=True)

    cache_filename = f"{subset_directory}/landsat_pass_count_{year}_{month:02d}.json"
    if os.path.exists(cache_filename):
        with open(cache_filename, "r") as cache_reader:
            try:
                metadata = json.load(cache_reader)
            except:
                metadata = {}
            pass_count = metadata.get("pass_count")
            if pass_count is not None:
                logger.info(f"Retrieved cached pass count: {pass_count} for {year}-{month:02d} from {cache_filename}")
                return pass_count

    stac_api_io = StacApiIO()
    retries = Retry(total=5, backoff_factor=1, status_forcelist=[502, 503, 504])
    stac_api_io.session.mount("http://", HTTPAdapter(max_retries=retries))
    stac_api_io.session.mount("https://", HTTPAdapter(max_retries=retries))

    catalog = pystac_client.Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1",
        modifier=planetary_computer.sign_inplace,
        stac_io=stac_api_io,
    )

    start_date = f"{year}-{month:02d}-01"
    end_date = f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]}"

    unique_dates = set()
    pass_list = []
    # Handle different geometry types
    if isinstance(roi, Polygon):
        rois = [roi]
    elif isinstance(roi, MultiPolygon):
        rois = list(roi.geoms)  # Extract individual polygons from MultiPolygon
    else:
        # Assume it's already a list/iterable of geometries
        rois = roi
    for area in rois:
        # Want to retry a few times if we get an error
        search = search_catalog_with_retries(catalog, area.bounds, f"{start_date}/{end_date}")
        items = None
        for i in range(3):
            try:
                items = get_items_with_retries(search, retries=3)
                # Convert to list to force evaluation
                items = list(items) if items else []
                break
            except Exception as e:
                logger.error(f"Error getting items: {e}")
                time.sleep(i + 1)
                continue

        if items is None:
            continue

        for item in items:
            platform = item.properties.get("platform")
            if platform in sat_ids:
                unique_dates.add(f"{item.properties.get('platform')}-{item.datetime.strftime('%m-%d-%Y')}")
                pass_list.append({"date": str(item.datetime.date()), "satellite": platform, "id": item.id})

    pass_count = len(unique_dates)

    stac_api_io.session.close()

    with open(cache_filename, "w") as cache_writer:
        logger.info(f"Writing Landsat pass count to cache: {cache_filename}")
        metadata = {
            "year": year,
            "month": month,
            "pass_count": pass_count,
            "sat_ids": sat_ids,
            "pass_list": pass_list,
            "date_fetched": str(datetime.datetime.now()),
        }
        cache_writer.write(json.dumps(metadata))

    logger.info(f"Year: {year}, Month: {month:02d}, Pass Count: {pass_count}, Time: {time.time() - start_time:.2f} seconds")

    return pass_count


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
    roi: Polygon | list[Polygon],
    month: int,
    year: int,
    subset_directory: str = "",
    sat_ids=["landsat-5", "landsat-7", "landsat-8", "landsat-9"],
    target_crs: str = "EPSG:4326",
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
    start_time = time.time()
    cache_directory = subset_directory
    if not cache_directory:
        cache_directory = "cloud_coverage_cache"
    else:
        cache_directory = os.path.join(subset_directory, "cloud_coverage_cache")

    if not os.path.exists(cache_directory):
        os.makedirs(cache_directory, exist_ok=True)

    cache_filename = f"{cache_directory}/cloud_coverage_{year}_{month:02d}.json"
    if os.path.exists(cache_filename):
        with open(cache_filename, "r") as cache_reader:
            try:
                metadata = json.load(cache_reader)
                logger.info(
                    f"Retrieved cached cloud coverage: {metadata.get('mean_cloud_coverage', 'N/A')}% for {year}-{month:02d} from {os.path.abspath(cache_filename)}"
                )
                return metadata
            except:
                pass

    stac_api_io = StacApiIO()
    retries = Retry(total=5, backoff_factor=1, status_forcelist=[502, 503, 504])
    stac_api_io.session.mount("http://", HTTPAdapter(max_retries=retries))
    stac_api_io.session.mount("https://", HTTPAdapter(max_retries=retries))

    catalog = pystac_client.Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1",
        modifier=planetary_computer.sign_inplace,
        stac_io=stac_api_io,
    )

    start_date = f"{year}-{month:02d}-01"
    end_date = f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]}"

    # Handle different geometry types
    if isinstance(roi, Polygon):
        rois = [roi]
    elif isinstance(roi, MultiPolygon):
        rois = list(roi.geoms)  # Extract individual polygons from MultiPolygon
    else:
        # Assume it's already a list/iterable of geometries
        rois = roi

    # Accumulate cloud and total observation counts per pixel
    total_observations = None
    cloudy_observations = None

    unique_dates = set()
    pass_list = []

    for area in rois:
        search = search_catalog_with_retries(catalog, area.bounds, f"{start_date}/{end_date}")

        items = None
        for i in range(3):
            try:
                items = get_items_with_retries(search, retries=3)
                items = list(items) if items else []
                break
            except Exception as e:
                logger.error(f"Error getting items: {e}")
                time.sleep(i + 1)
                continue

        if items is None:
            continue

        for item in items:
            platform = item.properties.get("platform")
            if platform not in sat_ids:
                continue

            unique_dates.add(f"{item.properties.get('platform')}-{item.datetime.strftime('%m-%d-%Y')}")
            pass_list.append({"date": str(item.datetime.date()), "satellite": platform, "id": item.id})

            try:
                # Get QA_PIXEL asset
                qa_asset = item.assets.get("qa_pixel")
                if not qa_asset:
                    logger.warning(f"No QA_PIXEL asset found for item {item.id}")
                    continue

                qa_href = planetary_computer.sign(qa_asset.href)

                # Open QA band and mask to ROI
                with rasterio.open(qa_href) as qa_src:
                    # Mask the QA data to the ROI
                    try:
                        # Reproject ROI to match raster CRS if needed
                        roi_for_masking = area
                        try:
                            if qa_src.crs != CRS.from_string(target_crs):
                                # Transform ROI from WGS84 to raster CRS
                                transformer = pyproj.Transformer.from_crs(target_crs, qa_src.crs, always_xy=True)
                                roi_for_masking = transform(transformer.transform, area)
                        except Exception as crs_error:
                            logger.warning(f"CRS transformation failed for item {item.id}: {crs_error}")
                            # Try alternative approach using rasterio's warp
                            try:
                                roi_dict = {"type": "Polygon", "coordinates": [list(area.exterior.coords)]}
                                roi_transformed = transform_geom(target_crs, qa_src.crs, roi_dict)
                                roi_for_masking = shape(roi_transformed)
                            except Exception as fallback_error:
                                logger.warning(
                                    f"Fallback CRS transformation also failed for item {item.id}: {fallback_error}"
                                )
                                # Skip this item if CRS transformation fails
                                logger.info(f"Skipping item {item.id} due to CRS transformation issues")
                                continue

                        qa_data_masked, qa_transform = mask(qa_src, [roi_for_masking], crop=True, filled=False)
                        qa_data = qa_data_masked[0]  # Get first band

                        # Skip if no valid data in ROI
                        if qa_data.mask.all():
                            continue

                        # Extract cloud mask
                        cloud_mask = extract_cloud_mask_from_qa(qa_data.data)

                        # Initialize accumulation arrays on first valid observation
                        if total_observations is None:
                            total_observations = np.zeros_like(cloud_mask, dtype=np.int32)
                            cloudy_observations = np.zeros_like(cloud_mask, dtype=np.int32)

                        # Count all pixels in the ROI for each pass (including masked/missing data)
                        total_observations += 1

                        # Only count pixels that aren't masked (have valid QA data) as potentially clear
                        valid_pixels = ~qa_data.mask

                        # For valid pixels, add to cloudy count if cloud/shadow detected
                        if cloudy_observations is not None:
                            cloudy_observations[valid_pixels & cloud_mask] += 1

                        # For invalid/missing pixels, treat as cloudy (add to cloudy count)
                        invalid_pixels = qa_data.mask
                        if cloudy_observations is not None:
                            cloudy_observations[invalid_pixels] += 1

                    except Exception as e:
                        logger.warning(f"Error processing QA data for item {item.id}: {e}")
                        continue

            except Exception as e:
                logger.error(f"Error accessing QA data for item {item.id}: {e}")
                continue

    stac_api_io.session.close()

    # Calculate results
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
        # Calculate cloud coverage percentage per pixel
        with np.errstate(divide="ignore", invalid="ignore"):
            cloud_coverage_per_pixel = np.where(
                total_observations > 0,
                (cloudy_observations / total_observations) * 100 if cloudy_observations is not None else np.nan,
                np.nan,
            )

        # Calculate mean cloud coverage across all pixels
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
            "date_fetched": str(datetime.datetime.now()),
        }

    # Cache results
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
