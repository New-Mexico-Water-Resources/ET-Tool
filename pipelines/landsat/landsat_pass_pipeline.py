#!/usr/bin/env python3
"""
Generate monthly Landsat pass-count COG layers for ARD tiles.

Each output Cloud Optimized GeoTIFF contains:
  - Band 1: total_observations
  - Band 2: non_cloudy_observations
  - Band 3: pass_days (unique calendar days with any observation per pixel)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from os.path import exists
from typing import Iterator

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import boto3
from botocore.exceptions import ClientError
from tqdm.auto import tqdm

from water_rights_visualizer.constants import ARD_TILES_FILENAME, START_YEAR
from water_rights_visualizer.landsat_pass_layers import (
    DEFAULT_LAYER_SUBDIR,
    generate_landsat_pass_layer_for_tile,
    landsat_pass_layer_path,
    load_tiles_geojson,
)

DEFAULT_ESTIMATED_SECONDS_PER_LAYER = 35
DEFAULT_ESTIMATED_BYTES_PER_LAYER = 2_400_000
DEFAULT_FAILURES_FILENAME = "landsat_pass_generation_failures.jsonl"


@dataclass
class FailedTask:
    year: int
    month: int
    hv: str
    error: str
    timestamp: str

    @classmethod
    def from_task(cls, year: int, month: int, hv: str, error: str) -> FailedTask:
        return cls(
            year=year,
            month=month,
            hv=hv,
            error=str(error),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def key(self) -> tuple[int, int, str]:
        return self.year, self.month, self.hv


@dataclass
class PipelineStats:
    total: int = 0
    generated: int = 0
    skipped: int = 0
    no_data: int = 0
    failed: int = 0
    uploaded: int = 0
    upload_skipped: int = 0
    failures: list[FailedTask] = field(default_factory=list)

    def as_postfix(self) -> dict[str, str | int]:
        return {
            "new": self.generated,
            "skip": self.skipped,
            "nodata": self.no_data,
            "fail": self.failed,
        }


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        level=level,
    )
    if not verbose:
        logging.getLogger("water_rights_visualizer").setLevel(logging.WARNING)


def validate_year(year_str: str) -> int:
    year = int(year_str)
    max_year = datetime.now().year + 1
    if year < START_YEAR or year > max_year:
        raise argparse.ArgumentTypeError(f"Year must be between {START_YEAR} and {max_year}, got {year}")
    return year


def validate_month(month_str: str) -> int:
    month = int(month_str)
    if month < 1 or month > 12:
        raise argparse.ArgumentTypeError(f"Month must be between 1 and 12, got {month}")
    return month


def failures_file_path(output_dir: str, failures_file: str | None) -> str:
    if failures_file:
        return failures_file
    return os.path.join(output_dir, DEFAULT_FAILURES_FILENAME)


def format_bytes(num_bytes: float) -> str:
    if num_bytes >= 1024**3:
        return f"{num_bytes / 1024**3:.2f} GB"
    if num_bytes >= 1024**2:
        return f"{num_bytes / 1024**2:.1f} MB"
    return f"{num_bytes / 1024:.1f} KB"


def iter_year_months(start_year: int, end_year: int, start_month: int, end_month: int) -> Iterator[tuple[int, int]]:
    for year in range(start_year, end_year + 1):
        month_begin = start_month if year == start_year else 1
        month_end = end_month if year == end_year else 12
        for month in range(month_begin, month_end + 1):
            yield year, month


def build_generation_tasks(
    start_year: int,
    end_year: int,
    start_month: int,
    end_month: int,
    tiles_gdf,
) -> list[tuple[int, int, str, object]]:
    tasks: list[tuple[int, int, str, object]] = []
    for year, month in iter_year_months(start_year, end_year, start_month, end_month):
        for _, feature in tiles_gdf.iterrows():
            tasks.append((year, month, str(feature["hv"]), feature.geometry))
    return tasks


def build_tasks_from_failures(
    failed_tasks: list[FailedTask],
    tiles_gdf,
) -> list[tuple[int, int, str, object]]:
    geometry_by_hv = {str(row["hv"]): row.geometry for _, row in tiles_gdf.iterrows()}
    tasks: list[tuple[int, int, str, object]] = []
    seen: set[tuple[int, int, str]] = set()

    for failed in failed_tasks:
        key = failed.key()
        if key in seen:
            continue
        geometry = geometry_by_hv.get(failed.hv)
        if geometry is None:
            continue
        seen.add(key)
        tasks.append((failed.year, failed.month, failed.hv, geometry))

    return tasks


def load_failure_records(path: str) -> list[FailedTask]:
    if not exists(path):
        return []

    records: list[FailedTask] = []
    with open(path, encoding="utf-8") as reader:
        for line_number, line in enumerate(reader, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
                records.append(
                    FailedTask(
                        year=int(payload["year"]),
                        month=int(payload["month"]),
                        hv=str(payload["hv"]),
                        error=str(payload.get("error", "")),
                        timestamp=str(payload.get("timestamp", "")),
                    )
                )
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                raise ValueError(f"Invalid failure record at {path}:{line_number}: {exc}") from exc
    return records


def unique_failure_records(records: list[FailedTask]) -> list[FailedTask]:
    latest_by_key: dict[tuple[int, int, str], FailedTask] = {}
    for record in records:
        latest_by_key[record.key()] = record
    return list(latest_by_key.values())


def append_failure_record(path: str, failed_task: FailedTask) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as writer:
        writer.write(json.dumps(asdict(failed_task)) + "\n")


def write_failure_records(path: str, records: list[FailedTask]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as writer:
        for record in unique_failure_records(records):
            writer.write(json.dumps(asdict(record)) + "\n")


def estimate_bytes_per_layer(output_dir: str) -> float:
    existing_sizes = [os.path.getsize(path) for path in discover_local_layers(output_dir)]
    if len(existing_sizes) >= 2:
        return float(statistics.median(existing_sizes))
    return float(DEFAULT_ESTIMATED_BYTES_PER_LAYER)


def estimate_storage_for_tasks(
    tasks: list[tuple[int, int, str, object]],
    output_dir: str,
    bytes_per_layer: float,
) -> tuple[int, int, float, float]:
    existing_bytes = 0
    existing_count = 0
    for year, month, hv, _ in tasks:
        layer_path = landsat_pass_layer_path(output_dir, hv, year, month)
        if exists(layer_path):
            existing_bytes += os.path.getsize(layer_path)
            existing_count += 1

    remaining = len(tasks) - existing_count
    projected_remaining_bytes = remaining * bytes_per_layer
    projected_total_bytes = existing_bytes + projected_remaining_bytes
    return existing_count, remaining, projected_total_bytes, projected_remaining_bytes


def upload_layer_to_s3(
    s3_client,
    bucket: str,
    key_prefix: str,
    layer_path: str,
    overwrite: bool = False,
) -> str:
    """Upload a layer file. Returns 'uploaded' or 'skipped'."""
    file_name = os.path.basename(layer_path)
    key = os.path.join(key_prefix, file_name).replace("\\", "/").lstrip("/")
    if not overwrite:
        try:
            s3_client.head_object(Bucket=bucket, Key=key)
            return "skipped"
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code not in {"404", "NoSuchKey", "NotFound"}:
                raise
    s3_client.upload_file(layer_path, bucket, key)
    return "uploaded"


def discover_local_layers(output_dir: str) -> list[str]:
    layer_directory = os.path.join(output_dir, DEFAULT_LAYER_SUBDIR)
    if not os.path.isdir(layer_directory):
        return []
    return sorted(
        os.path.join(layer_directory, file_name)
        for file_name in os.listdir(layer_directory)
        if file_name.endswith(".tif")
    )


def run_generation(
    tasks: list[tuple[int, int, str, object]],
    output_dir: str,
    overwrite: bool,
    stats: PipelineStats,
    failures_path: str,
    retry_mode: bool,
) -> list[str]:
    generated_paths: list[str] = []
    resolved_failures: set[tuple[int, int, str]] = set()
    progress = tqdm(
        tasks,
        desc="Generating Landsat pass COGs",
        unit="layer",
        dynamic_ncols=True,
        mininterval=0.5,
    )

    for year, month, hv, geometry in progress:
        progress.set_postfix(**stats.as_postfix(), year=year, month=f"{month:02d}", tile=hv)
        layer_path = landsat_pass_layer_path(output_dir, hv, year, month)

        if exists(layer_path) and not overwrite:
            stats.skipped += 1
            generated_paths.append(layer_path)
            if retry_mode:
                resolved_failures.add((year, month, hv))
            continue

        try:
            result = generate_landsat_pass_layer_for_tile(
                geometry,
                hv,
                month,
                year,
                output_dir,
                overwrite=overwrite,
            )
            if result is None:
                stats.no_data += 1
                if retry_mode:
                    resolved_failures.add((year, month, hv))
            else:
                stats.generated += 1
                generated_paths.append(result)
                if retry_mode:
                    resolved_failures.add((year, month, hv))
        except Exception as exc:
            stats.failed += 1
            failed_task = FailedTask.from_task(year, month, hv, exc)
            stats.failures.append(failed_task)
            append_failure_record(failures_path, failed_task)
            tqdm.write(f"FAILED {hv} {year}-{month:02d}: {exc}")

    progress.close()

    if retry_mode:
        remaining_failures = [
            record
            for record in unique_failure_records(load_failure_records(failures_path))
            if record.key() not in resolved_failures
        ]
        write_failure_records(failures_path, remaining_failures)

    return generated_paths


def run_upload(
    layer_paths: list[str],
    s3_client,
    bucket: str,
    key_prefix: str,
    overwrite: bool,
    stats: PipelineStats,
) -> None:
    progress = tqdm(
        layer_paths,
        desc="Uploading to S3",
        unit="file",
        dynamic_ncols=True,
        mininterval=0.5,
    )
    for layer_path in progress:
        progress.set_postfix(uploaded=stats.uploaded, skipped=stats.upload_skipped)
        try:
            status = upload_layer_to_s3(
                s3_client,
                bucket,
                key_prefix,
                layer_path,
                overwrite=overwrite,
            )
            if status == "uploaded":
                stats.uploaded += 1
            else:
                stats.upload_skipped += 1
        except Exception as exc:
            stats.failed += 1
            failed_task = FailedTask.from_task(0, 0, os.path.basename(layer_path), exc)
            stats.failures.append(failed_task)
            tqdm.write(f"UPLOAD FAILED {os.path.basename(layer_path)}: {exc}")
    progress.close()


def print_summary(
    stats: PipelineStats,
    output_dir: str,
    elapsed_seconds: float,
    upload: bool,
    bucket: str | None,
    key_prefix: str | None,
    failures_path: str | None = None,
) -> None:
    lines = [
        "",
        "Landsat pass COG pipeline summary",
        f"  Output directory : {os.path.abspath(output_dir)}",
        f"  Total tasks      : {stats.total}",
        f"  Generated        : {stats.generated}",
        f"  Skipped (exists) : {stats.skipped}",
        f"  No observations  : {stats.no_data}",
        f"  Failed           : {stats.failed}",
        f"  Elapsed          : {elapsed_seconds / 60:.1f} min ({elapsed_seconds:.0f}s)",
    ]
    if failures_path:
        lines.append(f"  Failures file    : {os.path.abspath(failures_path)}")
    if upload:
        lines.extend(
            [
                f"  Uploaded         : {stats.uploaded}",
                f"  Upload skipped   : {stats.upload_skipped}",
                f"  S3 destination   : s3://{bucket}/{key_prefix}",
            ]
        )
    if stats.failures:
        lines.append("  Recent failures:")
        for failure in stats.failures[:10]:
            lines.append(f"    - {failure.hv} {failure.year}-{failure.month:02d}: {failure.error}")
        if len(stats.failures) > 10:
            lines.append(f"    ... and {len(stats.failures) - 10} more")
    tqdm.write("\n".join(lines))


def print_dry_run_summary(
    tasks: list[tuple[int, int, str, object]],
    output_dir: str,
    bytes_per_layer: float,
) -> None:
    existing_count, remaining, projected_total_bytes, projected_remaining_bytes = estimate_storage_for_tasks(
        tasks,
        output_dir,
        bytes_per_layer,
    )
    est_seconds = remaining * DEFAULT_ESTIMATED_SECONDS_PER_LAYER
    est_hours = est_seconds / 3600

    tqdm.write(
        f"Dry run: {len(tasks)} layers planned, {existing_count} already exist, "
        f"{remaining} would be generated (without --overwrite)"
    )
    tqdm.write(
        f"Anticipated total size: {format_bytes(projected_total_bytes)} "
        f"({format_bytes(projected_remaining_bytes)} to generate, "
        f"~{format_bytes(bytes_per_layer)}/layer)"
    )
    if remaining:
        tqdm.write(
            f"Rough ETA at ~{DEFAULT_ESTIMATED_SECONDS_PER_LAYER}s/layer: "
            f"{est_hours:.1f} hours ({est_hours / 24:.1f} days)"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate monthly Landsat pass-count COG layers for ARD tiles",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--start-year",
        type=validate_year,
        help=f"First year to generate (inclusive, {START_YEAR}+)",
    )
    parser.add_argument(
        "--end-year",
        type=validate_year,
        help="Last year to generate (inclusive)",
    )
    parser.add_argument(
        "--start-month",
        type=validate_month,
        default=1,
        help="First month for the start year (default: 1)",
    )
    parser.add_argument(
        "--end-month",
        type=validate_month,
        default=12,
        help="Last month for the end year (default: 12)",
    )
    parser.add_argument(
        "--tiles-geojson",
        default=ARD_TILES_FILENAME,
        help=f"GeoJSON file defining ARD tiles (default: {ARD_TILES_FILENAME})",
    )
    parser.add_argument(
        "--output-dir",
        default="landsat_pass_layers_output",
        help="Directory where generated COG layers are written",
    )
    parser.add_argument(
        "--tile-ids",
        nargs="*",
        default=None,
        help="Optional subset of tile hv IDs (e.g. 008014 009011)",
    )
    parser.add_argument("--overwrite", action="store_true", help="Regenerate layers even if they already exist")
    parser.add_argument(
        "--upload",
        action="store_true",
        help="Upload generated/local COG files to S3 after generation",
    )
    parser.add_argument(
        "--upload-only",
        action="store_true",
        help="Skip generation and upload existing local COG files to S3",
    )
    parser.add_argument("--aws-bucket", default="ose-dev-inputs", help="S3 bucket for uploads")
    parser.add_argument("--aws-profile", default="ose-nmw", help="AWS profile name")
    parser.add_argument("--aws-region", default="us-west-2", help="AWS region")
    parser.add_argument(
        "--s3-key-prefix",
        default=DEFAULT_LAYER_SUBDIR,
        help="S3 key prefix for uploaded Landsat pass COG files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned work and exit without generating or uploading",
    )
    parser.add_argument(
        "--retry-failures",
        action="store_true",
        help="Retry only tasks listed in the failures file",
    )
    parser.add_argument(
        "--failures-file",
        default=None,
        help=f"Path to JSONL failure log (default: <output-dir>/{DEFAULT_FAILURES_FILENAME})",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    setup_logging(args.verbose)
    logger = logging.getLogger(__name__)

    if args.upload_only and args.upload:
        parser.error("Use either --upload or --upload-only, not both")

    if args.retry_failures:
        if args.upload_only:
            parser.error("--retry-failures cannot be combined with --upload-only")
    elif args.start_year is None or args.end_year is None:
        parser.error("--start-year and --end-year are required unless --retry-failures is used")

    if not args.retry_failures:
        if args.start_year > args.end_year:
            parser.error("--start-year must be less than or equal to --end-year")
        if args.start_year == args.end_year and args.start_month > args.end_month:
            parser.error("--start-month must be less than or equal to --end-month for a single-year run")

    tiles_gdf = load_tiles_geojson(tiles_geojson=args.tiles_geojson, tile_ids=args.tile_ids)
    failures_path = failures_file_path(args.output_dir, args.failures_file)

    if args.retry_failures:
        failed_records = unique_failure_records(load_failure_records(failures_path))
        if not failed_records:
            logger.error(f"No failure records found at {failures_path}")
            sys.exit(1)
        tasks = build_tasks_from_failures(failed_records, tiles_gdf)
        if not tasks:
            logger.error("No retryable tasks found after matching failure records to known tiles")
            sys.exit(1)
        logger.info("Retrying %s failed task(s) from %s", len(tasks), failures_path)
    else:
        tasks = build_generation_tasks(
            args.start_year,
            args.end_year,
            args.start_month,
            args.end_month,
            tiles_gdf,
        )

    stats = PipelineStats(total=len(tasks))
    bytes_per_layer = estimate_bytes_per_layer(args.output_dir)

    if not args.retry_failures:
        year_month_count = len(
            list(iter_year_months(args.start_year, args.end_year, args.start_month, args.end_month))
        )
        logger.info(
            "Planned work: %s tile-months across %s tiles and %s year-months (%04d-%02d through %04d-%02d)",
            stats.total,
            len(tiles_gdf),
            year_month_count,
            args.start_year,
            args.start_month,
            args.end_year,
            args.end_month,
        )

    if args.dry_run:
        print_dry_run_summary(tasks, args.output_dir, bytes_per_layer)
        return

    start_time = time.time()
    layer_paths: list[str] = []

    if not args.upload_only:
        layer_paths = run_generation(
            tasks,
            args.output_dir,
            args.overwrite,
            stats,
            failures_path=failures_path,
            retry_mode=args.retry_failures,
        )
    else:
        layer_paths = discover_local_layers(args.output_dir)
        if not layer_paths:
            logger.error(f"No local COG files found under {args.output_dir}/{DEFAULT_LAYER_SUBDIR}")
            sys.exit(1)
        tqdm.write(f"Found {len(layer_paths)} local COG file(s) to upload")

    if args.upload or args.upload_only:
        session = boto3.Session(profile_name=args.aws_profile, region_name=args.aws_region)
        s3_client = session.client("s3", region_name=args.aws_region)
        upload_paths = sorted(set(layer_paths if not args.upload_only else discover_local_layers(args.output_dir)))
        run_upload(
            upload_paths,
            s3_client,
            args.aws_bucket,
            args.s3_key_prefix,
            overwrite=args.overwrite,
            stats=stats,
        )

    print_summary(
        stats,
        args.output_dir,
        time.time() - start_time,
        upload=args.upload or args.upload_only,
        bucket=args.aws_bucket if (args.upload or args.upload_only) else None,
        key_prefix=args.s3_key_prefix if (args.upload or args.upload_only) else None,
        failures_path=failures_path,
    )

    if stats.failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
