import os
import json
import datetime
import pystac_client
import planetary_computer
import calendar
import geopandas as gpd
from requests.adapters import HTTPAdapter, Retry
from pystac_client.stac_api_io import StacApiIO


from shapely.geometry import Polygon
from logging import getLogger

logger = getLogger(__name__)

WGS84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"


def search_catalog_with_retries(catalog, bbox, datetime, collections=["landsat-c2-l2"], retries=3):
    for _ in range(retries):
        try:
            return catalog.search(collections=collections, bbox=bbox, datetime=datetime)
        except Exception as e:
            logger.error(f"Error searching for Landsat passes: {e}")
            continue
    raise Exception("Failed to search for Landsat passes")


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
    if not subset_directory:
        subset_directory = "landsat_pass_count_cache"
    else:
        subset_directory = os.path.join(subset_directory, "landsat_pass_count_cache")

    if not os.path.exists(subset_directory):
        os.makedirs(subset_directory, exist_ok=True)

    cache_filename = f"{subset_directory}/landsat_pass_count_{year}_{month}.json"
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

    catalog = pystac_client.Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1",
        modifier=planetary_computer.sign_inplace,
        stac_io=stac_api_io,
    )

    start_date = f"{year}-{month:02d}-01"
    end_date = f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]}"

    unique_dates = set()
    pass_list = []
    rois = [roi] if isinstance(roi, Polygon) else roi
    for area in rois:
        # Want to retry a few times if we get an error
        search = search_catalog_with_retries(catalog, area.bounds, f"{start_date}/{end_date}")

        for item in search.items():
            platform = item.properties.get("platform")
            if platform in sat_ids:
                unique_dates.add(item.datetime.date())
                pass_list.append({"date": str(item.datetime.date()), "satellite": platform, "id": item.id})

    pass_count = len(unique_dates)

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

    return pass_count


if __name__ == "__main__":
    ROI = "../Example.geojson"
    ROI_latlon = gpd.read_file(ROI).to_crs(WGS84).geometry[0]
    month = 6
    year = 2023

    pass_count = count_landsat_passes_for_month(ROI_latlon, month, year)
    print(f"Landsat passes for {month}/{year}: {pass_count}")
