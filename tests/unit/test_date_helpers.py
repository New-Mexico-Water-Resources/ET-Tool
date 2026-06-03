import pytest
from datetime import date

from water_rights_visualizer.date_helpers import (
    calculate_hours_of_sunlight,
    get_days_in_month,
    get_days_in_year,
    get_one_month_slice,
)
from shapely.geometry import Polygon


@pytest.mark.unit
class TestDateHelpers:
    def test_get_one_month_slice_january(self):
        start, end = get_one_month_slice(2021, 1)
        assert start == 0
        assert end == 31

    def test_get_one_month_slice_february_non_leap(self):
        start, end = get_one_month_slice(2021, 2)
        assert start == 31
        assert end == 59

    def test_get_days_in_month_matches_slice(self):
        for month in range(1, 13):
            start, end = get_one_month_slice(2024, month)
            assert get_days_in_month(2024, month) == end - start

    def test_get_days_in_year(self):
        assert get_days_in_year(2020) == 366
        assert get_days_in_year(2021) == 365

    def test_calculate_hours_of_sunlight_increases_toward_summer(self):
        roi = Polygon([(-106.77, 32.20), (-106.76, 32.20), (-106.76, 32.21), (-106.77, 32.21)])
        january_hours = calculate_hours_of_sunlight(roi, date(2021, 1, 15))
        june_hours = calculate_hours_of_sunlight(roi, date(2021, 6, 15))
        assert january_hours < june_hours
        assert 9 <= january_hours <= 11
        assert 13 <= june_hours <= 15
