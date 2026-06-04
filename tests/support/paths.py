from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TESTS_ROOT = PROJECT_ROOT / "tests"
TEST_DATA_ROOT = PROJECT_ROOT / "test_data"
VARIABLES_YAML = PROJECT_ROOT / "variables.yaml"
MANIFEST_CSV = PROJECT_ROOT / "water_rights_visualizer" / "S3_filenames.csv"
ARD_TILES_GEOJSON = PROJECT_ROOT / "water_rights_visualizer" / "ARD_tiles.geojson"
MANIFEST_COVERAGE_RULES = TESTS_ROOT / "manifest_coverage_rules.yaml"
TESTS_OUTPUT_DIR = TESTS_ROOT / "output"
MANIFEST_COVERAGE_GAPS_CSV = TESTS_OUTPUT_DIR / "manifest_coverage_gaps.csv"
TEST_TARGET_GEOJSON = TEST_DATA_ROOT / "TestCaseRegion.geojson"
INTEGRATION_REPORT_OUTPUT_DIR = TESTS_OUTPUT_DIR / "integration_report"
DATA_QUALITY_OUTPUT_DIR = TESTS_OUTPUT_DIR

MM_PER_INCH = 25.4
MAX_ET_MM_PER_MONTH = 1500
MAX_ETO_MM_PER_MONTH = 1500
MAX_PPT_MM_PER_MONTH = 1500
