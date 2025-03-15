import math
import datetime
import logging

from dateutil.relativedelta import relativedelta


logger = logging.getLogger(__name__)


def get_one_month_slice(year: int, month: int) -> slice:
    """
    Get the start (inclusive) and end (not inclusive) indices for a given month.

    Args:
        year (int): The year for which the slice is generated.
        month (int): The month for which the slice is generated (1-12).

    Returns:
        (start_index, end): The slice for the given month (start <= x < end).
    """
    start = datetime.datetime(year, month, 1).date()
    start_index = start.timetuple().tm_yday - 1

    end = start + relativedelta(months=1) - relativedelta(days=1)
    end_index = end.timetuple().tm_yday

    return start_index, end_index


def get_days_in_month(year: int, month: int) -> int:
    """
    Get the number of days in a month.
    """
    start, end = get_one_month_slice(year, month)

    return end - start


def get_days_in_year(year: int) -> int:
    """
    Get the number of days in a year.
    """
    start = datetime.datetime(year, 1, 1).date()
    end = datetime.datetime(year, 12, 31).date()

    return (end - start).days + 1


def get_day_of_year(year: int, month: int, day: int) -> int:
    """
    Get the day of the year for a given date.
    """
    day_of_year = (datetime.datetime(year, month, day) - datetime.datetime(year, 1, 1)).days

    return day_of_year


# Daylight calculations adapted from OpenET PTJPL library to not rely on Earth Engine:
# https://github.com/Open-ET/openet-ptjpl/blob/main/openet/ptjpl/daylight_hours.py
def day_angle_rad_from_doy(doy):
    """
    Calculate day angle in radians from day of year between 1 and 365.
    Args:
        doy: Day of year between 1 and 365.
    Returns:
        Day angle in radians.
    """
    return (2 * math.pi * (doy - 1)) / 365


def solar_dec_deg_from_day_angle_rad(day_angle_rad):
    """
    Calculate solar declination in degrees from day angle in radians.
    Args:
        day_angle_rad: Day angle in radians.
    Returns:
        Solar declination in degrees.
    """
    return (
        0.006918
        - 0.399912 * math.cos(day_angle_rad)
        + 0.070257 * math.sin(day_angle_rad)
        - 0.006758 * math.cos(2 * day_angle_rad)
        + 0.000907 * math.sin(2 * day_angle_rad)
        - 0.002697 * math.cos(3 * day_angle_rad)
        + 0.00148 * math.sin(3 * day_angle_rad)
    ) * (180 / math.pi)


def sha_deg_from_doy_lat(doy, latitude):
    """
    Calculate sunrise hour angle in degrees from latitude in degrees
    and day of year between 1 and 365.
    Args:
        doy: Day of year between 1 and 365.
        latitude: Latitude in degrees.
    Returns:
        Sunrise Hour Angle (SHA) in degrees.
    """
    # Calculate day angle in radians
    day_angle_rad = day_angle_rad_from_doy(doy)

    # Calculate solar declination in degrees
    solar_dec_deg = solar_dec_deg_from_day_angle_rad(day_angle_rad)

    # Convert latitude and solar declination to radians
    latitude_rad = math.radians(latitude)
    solar_dec_rad = math.radians(solar_dec_deg)

    # Calculate cosine of sunrise angle at latitude and solar declination
    sunrise_cos = -math.tan(latitude_rad) * math.tan(solar_dec_rad)

    # Apply polar correction
    if sunrise_cos >= 1:
        return 0  # No sunrise
    elif sunrise_cos <= -1:
        return 180  # No sunset

    # Calculate sunrise angle in radians from cosine
    sunrise_rad = math.acos(sunrise_cos)

    # Convert to degrees
    return math.degrees(sunrise_rad)


def sunrise_from_sha(sha_deg):
    """
    Calculate sunrise hour from sunrise hour angle in degrees.

    Args:
        sha_deg: Sunrise Hour Angle (SHA) in degrees.
    Returns:
        Sunrise hour.
    """
    return 12.0 - (sha_deg / 15.0)


def daylight_from_sha(sha_deg):
    """
    Calculate daylight hours from sunrise hour angle in degrees.

    Args:
        sha_deg: Sunrise Hour Angle (SHA) in degrees.
    Returns:
        Number of daylight hours.
    """
    return (2.0 / 15.0) * sha_deg


def calculate_hours_of_sunlight(ROI_latlon, date_step: datetime.date):
    """
    Calculate the number of hours of sunlight for a given date and location.

    Args:
        ROI_latlon: The region of interest as a shapely geometry.
        date_step: The date for which to calculate the hours of sunlight.
    Returns:
        hours: The estimated number of hours of sunlight.
    """

    doy = date_step.timetuple().tm_yday
    latitude = ROI_latlon.centroid.y

    sha_deg = sha_deg_from_doy_lat(doy, latitude)

    daylight_hours = daylight_from_sha(sha_deg)

    return daylight_hours
