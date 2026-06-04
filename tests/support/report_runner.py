from __future__ import annotations

import os
from pathlib import Path
import boto3

from water_rights_visualizer.S3_source import S3Source
from water_rights_visualizer.water_rights_visualizer import water_rights_visualizer

from tests.support.paths import TEST_TARGET_GEOJSON


def aws_credentials_available() -> bool:
    bucket = os.environ.get("S3_INPUT_BUCKET", "ose-dev-inputs")
    try:
        profile = os.environ.get("AWS_PROFILE")
        session = boto3.Session(profile_name=profile) if profile else boto3.Session()
        credentials = session.get_credentials()
        if credentials is None:
            return False
        client = session.client("s3", region_name=os.environ.get("S3_REGION", "us-west-2"))
        client.head_bucket(Bucket=bucket)
        return True
    except Exception:
        return False


def build_s3_source(temporary_directory: Path) -> S3Source:
    profile = os.environ.get("AWS_PROFILE")
    return S3Source(
        bucket_name=os.environ.get("S3_INPUT_BUCKET", "ose-dev-inputs"),
        region_name=os.environ.get("S3_REGION", "us-west-2"),
        temporary_directory=str(temporary_directory),
        remove_temporary_files=False,
        aws_profile=profile,
    )


def run_single_year_report(
    output_directory: Path,
    year: int,
    geojson_path: Path = TEST_TARGET_GEOJSON,
    use_stack: bool = True,
) -> Path:
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    temp_directory = output_directory / "temp"
    temp_directory.mkdir(parents=True, exist_ok=True)

    water_rights_visualizer(
        boundary_filename=str(geojson_path),
        input_datastore=build_s3_source(temp_directory),
        output_directory=str(output_directory),
        start_year=year,
        end_year=year,
        requestor={"sub": "tests", "name": "ET Tool Tests", "email": "tests@example.com"},
        use_stack=use_stack,
    )
    return output_directory


def roi_name_from_geojson(geojson_path: Path = TEST_TARGET_GEOJSON) -> str:
    return geojson_path.stem


def prepare_integration_report_output_dir() -> Path:
    import shutil

    from tests.support.paths import INTEGRATION_REPORT_OUTPUT_DIR

    if INTEGRATION_REPORT_OUTPUT_DIR.exists():
        shutil.rmtree(INTEGRATION_REPORT_OUTPUT_DIR)
    INTEGRATION_REPORT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return INTEGRATION_REPORT_OUTPUT_DIR
