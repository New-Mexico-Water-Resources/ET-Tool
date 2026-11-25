import calendar
import time

import numpy as np
import planetary_computer
import pystac_client
from logging import getLogger
from pystac_client.stac_api_io import StacApiIO
from requests.adapters import HTTPAdapter, Retry
from shapely.geometry import MultiPolygon, Polygon

logger = getLogger(__name__)


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
    cloud_confidence = (qa_array >> 3) & 0b11
    cloud_shadow = (qa_array >> 5) & 0b1
    cloud_mask = cloud_confidence >= 2
    cloud_shadow_mask = cloud_shadow == 1
    return cloud_mask | cloud_shadow_mask
