from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pytest

from tests.support.paths import LANDSAT_PASS_CACHE_DIR, TEST_TARGET_GEOJSON
from water_rights_visualizer.constants import WGS84
from water_rights_visualizer.landsat_pass_count import (
    _fetch_monthly_cloud_coverage_from_planetary_computer,
    get_landsat_month_stats,
)
from water_rights_visualizer.landsat_pass_layers import (
    aggregate_landsat_pass_stats_from_layers,
    landsat_pass_layer_path,
)

YEAR = 2024
MONTH = 1
TILE_HV = "010014"
CLOUD_COVERAGE_TOLERANCE_PP = 1.0


@pytest.fixture(scope="module")
def test_region_polygon():
    return gpd.read_file(TEST_TARGET_GEOJSON).to_crs(WGS84).geometry.union_all()


@pytest.fixture(scope="module")
def january_2024_tile_cache_path():
    cache_path = Path(landsat_pass_layer_path(str(LANDSAT_PASS_CACHE_DIR), TILE_HV, YEAR, MONTH))
    if not cache_path.exists():
        pytest.skip(f"Missing Landsat pass COG fixture: {cache_path}")
    return cache_path


def _report_metrics(stats: dict) -> dict[str, float | int | None]:
    cloud = stats.get("mean_cloud_coverage")
    return {
        "days_with_landsat_passes": stats.get("pass_count"),
        "cloud_coverage_plus_missing_data_percent": round(cloud, 2) if cloud is not None else None,
    }


def test_january_2024_cog_fixture_exists(january_2024_tile_cache_path):
    import rasterio

    with rasterio.open(january_2024_tile_cache_path) as src:
        assert src.count == 3
        assert src.descriptions == (
            "total_observations",
            "non_cloudy_observations",
            "pass_days",
        )
        assert src.tags().get("hv") == TILE_HV
        assert int(src.tags().get("year", 0)) == YEAR
        assert int(src.tags().get("month", 0)) == MONTH


def test_cog_cache_report_metrics_for_test_case_region(test_region_polygon, january_2024_tile_cache_path, capsys):
    stats = aggregate_landsat_pass_stats_from_layers(
        test_region_polygon,
        MONTH,
        YEAR,
        cache_directory=str(LANDSAT_PASS_CACHE_DIR),
    )
    metrics = _report_metrics(stats)

    print(
        "COG cache report metrics for TestCaseRegion.geojson:",
        f"Days with Landsat Passes={metrics['days_with_landsat_passes']},",
        f"Cloud Coverage + Missing Data (%)={metrics['cloud_coverage_plus_missing_data_percent']}",
    )

    assert stats is not None
    assert stats["source"] == "layer_cache"
    assert metrics["days_with_landsat_passes"] is not None
    assert metrics["days_with_landsat_passes"] > 0
    assert metrics["cloud_coverage_plus_missing_data_percent"] is not None
    assert metrics["cloud_coverage_plus_missing_data_percent"] > 0


def test_get_landsat_month_stats_writes_cloud_coverage_cache(test_region_polygon, january_2024_tile_cache_path, tmp_path):
    stats = get_landsat_month_stats(
        test_region_polygon,
        MONTH,
        YEAR,
        subset_directory=str(tmp_path),
        layer_cache_directory=str(LANDSAT_PASS_CACHE_DIR),
    )

    cache_path = tmp_path / "cloud_coverage_cache" / f"cloud_coverage_{YEAR}_{MONTH:02d}.json"
    assert cache_path.exists()

    cached = json.loads(cache_path.read_text())
    assert cached["pass_count"] == stats["pass_count"]
    assert cached["pass_count"] > 0


@pytest.mark.integration
def test_cog_cache_matches_planetary_computer_for_test_case_region(test_region_polygon, capsys):
    cached_stats = aggregate_landsat_pass_stats_from_layers(
        test_region_polygon,
        MONTH,
        YEAR,
        cache_directory=str(LANDSAT_PASS_CACHE_DIR),
    )

    try:
        live_stats = _fetch_monthly_cloud_coverage_from_planetary_computer(
            test_region_polygon,
            MONTH,
            YEAR,
            write_json_cache=False,
        )
    except Exception as exc:
        pytest.skip(f"Planetary Computer unavailable for comparison: {exc}")

    if live_stats.get("mean_cloud_coverage") is None:
        pytest.skip("Planetary Computer returned no cloud coverage for comparison")

    cached_metrics = _report_metrics(cached_stats)
    live_metrics = _report_metrics(live_stats)

    print("Comparison for TestCaseRegion.geojson January 2024:")
    print(
        f"  COG cache        -> pass_days={cached_metrics['days_with_landsat_passes']},"
        f" cloud%={cached_metrics['cloud_coverage_plus_missing_data_percent']}"
    )
    print(
        f"  Planetary PC     -> pass_count={live_metrics['days_with_landsat_passes']},"
        f" cloud%={live_metrics['cloud_coverage_plus_missing_data_percent']}"
    )

    assert cached_metrics["days_with_landsat_passes"] == live_metrics["days_with_landsat_passes"]
    assert cached_metrics["cloud_coverage_plus_missing_data_percent"] == pytest.approx(
        live_metrics["cloud_coverage_plus_missing_data_percent"],
        abs=CLOUD_COVERAGE_TOLERANCE_PP,
    )
