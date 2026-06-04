from __future__ import annotations

import os
import sys
import warnings
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import pytest

from tests.support.paths import INTEGRATION_REPORT_OUTPUT_DIR, TEST_TARGET_GEOJSON

try:
    from dotenv import load_dotenv

    load_dotenv(_PROJECT_ROOT / ".env")
except ImportError:
    pass


@pytest.fixture(scope="session")
def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def test_target_geojson() -> Path:
    return TEST_TARGET_GEOJSON


@pytest.fixture(scope="session")
def integration_report_output(integration_test_year):
    """Run one single-year report shared by integration and product tests."""
    from tests.support.report_outputs import build_combined_csv_from_outputs
    from tests.support.report_runner import (
        aws_credentials_available,
        prepare_integration_report_output_dir,
        roi_name_from_geojson,
        run_single_year_report,
    )

    if not aws_credentials_available():
        pytest.skip("AWS credentials or S3 bucket access not available")

    output_directory = prepare_integration_report_output_dir()
    run_single_year_report(
        output_directory,
        year=integration_test_year,
        geojson_path=TEST_TARGET_GEOJSON,
    )
    roi_name = roi_name_from_geojson(TEST_TARGET_GEOJSON)
    build_combined_csv_from_outputs(output_directory, roi_name, integration_test_year)

    warnings.warn(
        f"Integration report written to: {output_directory.resolve()}",
        UserWarning,
        stacklevel=1,
    )

    return {
        "output_directory": output_directory,
        "roi_name": roi_name,
        "year": integration_test_year,
    }


@pytest.fixture
def test_roi_polygon(test_target_geojson):
    import geopandas as gpd

    return gpd.read_file(test_target_geojson).geometry.iloc[0]


@pytest.fixture
def synthetic_tile_hv() -> str:
    return "010014"


@pytest.fixture
def synthetic_datastore(tmp_path, synthetic_tile_hv) -> Path:
    from tests.support.synthetic_raster import build_synthetic_openet_year

    datastore_root = tmp_path / "synthetic_datastore"
    build_synthetic_openet_year(datastore_root, synthetic_tile_hv, year=2021)
    return datastore_root


@pytest.fixture(scope="session")
def integration_test_year() -> int:
    return int(os.environ.get("INTEGRATION_TEST_YEAR", "2021"))


def pytest_configure(config):
    config.addinivalue_line("markers", "unit: offline tests")
    config.addinivalue_line("markers", "integration: requires AWS S3")
    config.addinivalue_line("markers", "data_quality: requires live reference APIs")


def pytest_collection_modifyitems(config, items):
    for item in items:
        if "unit/" in str(item.fspath):
            item.add_marker(pytest.mark.unit)
        if "integration/" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
        if "data_quality/" in str(item.fspath):
            item.add_marker(pytest.mark.data_quality)
