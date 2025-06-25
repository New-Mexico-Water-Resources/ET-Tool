#!/usr/bin/env python3
"""
Water Rights Data Pipeline CLI
Fetches OpenET ET, OpenET ET_MIN, OpenET ET_MAX, IDAHO_EPSCOR_GRIDMET ETO, and OREGON_STATE_PRISM PPT
for a specified date range.
"""

import argparse
import logging
import sys
import os
from datetime import datetime
from typing import Optional

# Add the parent directory to the path so we can import the pipelines
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.gee.gee_aws_pipeline import GEEAWSDataPipeline
from pipelines.prism.prism_aws_pipeline import PrismAWSDataPipeline


def setup_logging(verbose: bool = False):
    """Setup logging configuration."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=level)


def validate_year(year_str: str) -> int:
    """Validate and return year as integer."""
    try:
        year = int(year_str)
        if year < 1985 or year > datetime.now().year + 1:
            raise ValueError(f"Year {year} is outside reasonable range (1985-{datetime.now().year + 1})")
        return year
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"Invalid year: {e}")


def run_openet_pipeline(start_year: int, end_year: int, config: dict):
    """Run the OpenET pipeline for ET, ET_MIN, and ET_MAX."""
    logger = logging.getLogger(__name__)
    logger.info(f"Starting OpenET pipeline for years {start_year}-{end_year}")

    pipeline = GEEAWSDataPipeline(
        bands=["et_ensemble_mad", "et_ensemble_mad_min", "et_ensemble_mad_max"],
        product="OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0",
        product_prefix="OPENET_ENSEMBLE",
        aws_bucket=config.get("aws_bucket", "ose-dev-inputs"),
        aws_region=config.get("aws_region", "us-west-2"),
        aws_profile=config.get("aws_profile", "ose-nmw"),
        gdrive_folder="OPENET_EXPORTS",
        temp_local_folder="temp_data",
        project=config.get("gee_project", "et-exploration"),
        gdrive_client_secrets_filename=config.get("gdrive_client_secrets"),
        gdrive_key_filename=config.get("gdrive_key"),
    )

    if not config.get("download_only", False):
        pipeline.generate_tiles_for_date_range(f"{start_year}-01-01", f"{end_year + 1}-01-01", export=True, visualize=False)
        logger.info("OpenET pipeline tiles generated")

    if not config.get("transfer_only", False):
        pipeline.transfer_gdrive_to_aws(delete_from_local=True)
        logger.info("OpenET pipeline transfer completed")


def run_gridmet_pipeline(start_year: int, end_year: int, config: dict):
    """Run the GRIDMET pipeline for ETO."""
    logger = logging.getLogger(__name__)
    logger.info(f"Starting GRIDMET pipeline for years {start_year}-{end_year}")

    gridmet_pipeline = GEEAWSDataPipeline(
        bands=["eto"],
        product="IDAHO_EPSCOR/GRIDMET",
        product_prefix="IDAHO_EPSCOR_GRIDMET",
        aws_bucket=config.get("aws_bucket", "ose-dev-inputs"),
        aws_region=config.get("aws_region", "us-west-2"),
        aws_profile=config.get("aws_profile", "ose-nmw"),
        gdrive_folder="OPENET_EXPORTS",
        temp_local_folder="temp_data",
        project=config.get("gee_project", "et-exploration"),
        gdrive_client_secrets_filename=config.get("gdrive_client_secrets"),
        gdrive_key_filename=config.get("gdrive_key"),
        monthly_sum=True,
    )

    if not config.get("download_only", False):
        gridmet_pipeline.generate_tiles_for_date_range(
            f"{start_year}-01-01", f"{end_year + 1}-01-01", export=True, visualize=False
        )
        logger.info("GRIDMET pipeline tiles generated")

    if not config.get("transfer_only", False):
        gridmet_pipeline.transfer_gdrive_to_aws(delete_from_local=True)
        logger.info("GRIDMET pipeline transfer completed")

    logger.info("GRIDMET pipeline completed")


def run_prism_pipeline(start_year: int, end_year: int, config: dict):
    """Run the PRISM pipeline for precipitation."""
    logger = logging.getLogger(__name__)
    logger.info(f"Starting PRISM pipeline for years {start_year}-{end_year}")

    prism_pipeline = PrismAWSDataPipeline(
        aws_bucket=config.get("aws_bucket", "ose-dev-inputs"),
        aws_region=config.get("aws_region", "us-west-2"),
        aws_profile=config.get("aws_profile", "ose-nmw"),
        raw_dir="prism_data",
        monthly_dir="prism_data_monthly",
        output_dir="prism_tiles",
        allow_provisional=config.get("allow_provisional", True),
    )

    if not config.get("transfer_only", False):
        for year in range(start_year, end_year + 1):
            logger.info(f"Processing PRISM data for year {year}")
            prism_pipeline.process_year(year, upload=not config.get("download_only", False))
            logger.info(f"PRISM data for year {year} processed")

    if not config.get("download_only", False):
        prism_pipeline.upload_local_folder_to_aws()
        logger.info("PRISM pipeline upload completed")


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Water Rights Data Pipeline - Fetch ET, ETO, and PPT data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
            Examples:
# Fetch only PRISM data for 2024
python run_pipeline.py --start-year 2024 --end-year 2024 --skip-openet --skip-gridmet
        """,
    )

    parser.add_argument("--start-year", type=validate_year, required=True, help="Start year for data fetching (e.g., 2020)")

    parser.add_argument(
        "--end-year", type=validate_year, required=True, help="End year for data fetching (inclusive, e.g., 2022)"
    )

    parser.add_argument("--aws-bucket", default="ose-dev-inputs", help="AWS S3 bucket name (default: ose-dev-inputs)")

    parser.add_argument("--aws-region", default="us-west-2", help="AWS region (default: us-west-2)")

    parser.add_argument("--aws-profile", default="ose-nmw", help="AWS profile name (default: ose-nmw)")

    parser.add_argument(
        "--gee-project", default="et-exploration", help="Google Earth Engine project ID (default: et-exploration)"
    )

    parser.add_argument("--gdrive-client-secrets", help="Path to Google Drive client secrets JSON file")

    parser.add_argument("--gdrive-key", help="Path to Google Drive key file")

    parser.add_argument("--skip-openet", action="store_true", help="Skip OpenET pipeline (ET, ET_MIN, ET_MAX)")

    parser.add_argument("--skip-gridmet", action="store_true", help="Skip GRIDMET pipeline (ETO)")

    parser.add_argument("--skip-prism", action="store_true", help="Skip PRISM pipeline (PPT)")

    parser.add_argument(
        "--allow-provisional", action="store_true", default=True, help="Allow provisional PRISM data (default: True)"
    )

    parser.add_argument(
        "--download-only", action="store_true", default=False, help="Download data mode, do not upload to AWS"
    )
    parser.add_argument(
        "--transfer-only", action="store_true", default=False, help="Transfer data mode, do not fetch new data"
    )

    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose logging")

    args = parser.parse_args()

    setup_logging(args.verbose)
    logger = logging.getLogger(__name__)

    if args.start_year > args.end_year:
        logger.error("Start year must be less than or equal to end year")
        sys.exit(1)

    config = {
        "aws_bucket": args.aws_bucket,
        "aws_region": args.aws_region,
        "aws_profile": args.aws_profile,
        "gee_project": args.gee_project,
        "gdrive_client_secrets": args.gdrive_client_secrets,
        "gdrive_key": args.gdrive_key,
        "allow_provisional": args.allow_provisional,
    }

    if not args.gdrive_client_secrets or not args.gdrive_key:
        # Use defaults for Google Drive
        config["gdrive_client_secrets"] = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "water_rights_visualizer", "client_secret.json"
        )
        config["gdrive_key"] = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "water_rights_visualizer", "google_drive_key.txt"
        )

    logger.info(f"Starting data pipeline for years {args.start_year} to {args.end_year}")
    logger.info(
        f"Variables to fetch: {[] if args.skip_openet else ['OpenET ET', 'OpenET ET_MIN', 'OpenET ET_MAX']} "
        f"{[] if args.skip_gridmet else ['GRIDMET ETO']} "
        f"{[] if args.skip_prism else ['PRISM PPT']}"
    )

    try:
        if not args.skip_openet:
            run_openet_pipeline(args.start_year, args.end_year, config)

        if not args.skip_gridmet:
            run_gridmet_pipeline(args.start_year, args.end_year, config)

        if not args.skip_prism:
            run_prism_pipeline(args.start_year, args.end_year, config)

        logger.info("All pipelines completed successfully!")

    except Exception as e:
        logger.error(f"Pipeline failed with error: {e}")
        if args.verbose:
            logger.exception("Full traceback:")
        sys.exit(1)


if __name__ == "__main__":
    main()
