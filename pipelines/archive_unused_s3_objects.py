from __future__ import annotations

import argparse
import csv
import logging
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable, Iterator, Optional

import boto3
import yaml
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

logger = logging.getLogger("archive_unused_s3_objects")

DEFAULT_BUCKET = os.environ.get("S3_INPUT_BUCKET", "ose-dev-inputs")
DEFAULT_REGION = os.environ.get("AWS_REGION", "us-west-2")
DEFAULT_PROFILE = os.environ.get("AWS_PROFILE") or None

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_VARIABLES_YAML = os.path.join(REPO_ROOT, "variables.yaml")
FALLBACK_CUTOFF_YEAR = 1985

LANDSAT_PREFIXES = ("LT04", "LT05", "LE07", "LC08")
LANDSAT_VARIABLES = {"ESI", "ET"}
ARCHIVE_VARIABLES = {"COUNT", "CCOUNT"}

SOURCE_LABELS = (
    (LANDSAT_PREFIXES, "Landsat"),
    (("OPENET_ENSEMBLE_",), "OpenET Ensemble"),
    (("OPENET_PTJPL_",), "OpenET PT-JPL"),
    (("IDAHO_EPSCOR_GRIDMET_",), "GRIDMET"),
    (("OREGON_STATE_PRISM_",), "PRISM"),
    (("MOD16A2_MERGED",), "MODIS"),
    (("VJ116A2_MERGED",), "VIIRS"),
)
UNKNOWN_SOURCE = "Unknown"

ALREADY_COLD = {"GLACIER", "DEEP_ARCHIVE", "GLACIER_IR"}
MAX_SINGLE_COPY_BYTES = 5 * 1024**3

STORAGE_RATES_USD_PER_GB_MONTH = {
    "STANDARD": 0.023,
    "STANDARD_IA": 0.0125,
    "ONEZONE_IA": 0.01,
    "INTELLIGENT_TIERING": 0.023,
    "GLACIER_IR": 0.004,
    "GLACIER": 0.0036,
    "DEEP_ARCHIVE": 0.00099,
    "REDUCED_REDUNDANCY": 0.023,
}

TRANSITION_REQUEST_USD_PER_1000 = {
    "DEEP_ARCHIVE": 0.05,
    "GLACIER": 0.05,
    "GLACIER_IR": 0.02,
}

GLACIER_OVERHEAD_TIERS = {"GLACIER", "DEEP_ARCHIVE"}
GLACIER_OVERHEAD_STANDARD_BYTES = 8 * 1024
GLACIER_OVERHEAD_ARCHIVE_BYTES = 32 * 1024

DATE_RE = re.compile(r"_(\d{8})_")
VARIABLE_RE = re.compile(r"_(ET_MIN|ET_MAX|[A-Za-z]+)\.tif{1,2}$", re.IGNORECASE)


@dataclass
class PlannedAction:
    key: str
    size: int
    current_class: str
    variable: Optional[str]
    acquisition_date: Optional[date]
    reason: str


@dataclass
class DatasetAggregate:
    count: int = 0
    bytes: int = 0
    min_year: Optional[int] = None
    max_year: Optional[int] = None
    example: Optional[str] = None

    def add(self, size: int, year: Optional[int], example: Optional[str] = None) -> None:
        self.count += 1
        self.bytes += size
        if self.example is None and example:
            self.example = example
        if isinstance(year, int):
            self.min_year = year if self.min_year is None else min(self.min_year, year)
            self.max_year = year if self.max_year is None else max(self.max_year, year)

    @property
    def date_range(self) -> str:
        if self.min_year is None:
            return "unknown"
        if self.min_year == self.max_year:
            return str(self.min_year)
        return f"{self.min_year} - {self.max_year}"


@dataclass
class ScanResult:
    scanned: int = 0
    skipped_not_tif: int = 0
    skipped_already_cold: int = 0
    plan: list[PlannedAction] = field(default_factory=list)
    reasons: dict[str, int] = field(default_factory=dict)
    archived_datasets: dict[str, DatasetAggregate] = field(default_factory=dict)
    kept_datasets: dict[str, DatasetAggregate] = field(default_factory=dict)

    @property
    def matched(self) -> int:
        return len(self.plan)

    @property
    def matched_bytes(self) -> int:
        return sum(action.size for action in self.plan)

    @property
    def kept_count(self) -> int:
        return sum(agg.count for agg in self.kept_datasets.values())

    @property
    def kept_bytes(self) -> int:
        return sum(agg.bytes for agg in self.kept_datasets.values())


def load_cutoff_year(variables_yaml_path: str) -> int:
    try:
        with open(variables_yaml_path, "r") as f:
            config = yaml.safe_load(f) or {}
        value = config.get("openet_transition_date", FALLBACK_CUTOFF_YEAR)
        if isinstance(value, str):
            return datetime.strptime(value[:4], "%Y").year
        if isinstance(value, date):
            return value.year
        return int(value)
    except (OSError, ValueError, KeyError) as e:
        logger.warning("Could not read cutoff year from %s (%s); using %d", variables_yaml_path, e, FALLBACK_CUTOFF_YEAR)
        return FALLBACK_CUTOFF_YEAR


def parse_acquisition_date(basename: str) -> Optional[date]:
    match = DATE_RE.search(basename)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%Y%m%d").date()
    except ValueError:
        return None


def parse_variable(basename: str) -> Optional[str]:
    match = VARIABLE_RE.search(basename)
    return match.group(1).upper() if match else None


def source_label(basename: str) -> str:
    for prefixes, label in SOURCE_LABELS:
        if basename.startswith(prefixes):
            return label
    return UNKNOWN_SOURCE


def dataset_label(basename: str, variable: Optional[str]) -> str:
    return f"{source_label(basename)} {variable or '?'}"


def is_legacy_landsat(basename: str, variable: Optional[str]) -> bool:
    return basename.startswith(LANDSAT_PREFIXES) and variable in LANDSAT_VARIABLES


def classify(basename: str, variable: Optional[str], acquisition_date: Optional[date], cutoff_year: int) -> tuple[bool, str]:
    reasons = []
    if acquisition_date is not None and acquisition_date.year < cutoff_year:
        reasons.append(f"pre-{cutoff_year}")
    if is_legacy_landsat(basename, variable):
        reasons.append("legacy-landsat-esi-et")
    if variable in ARCHIVE_VARIABLES:
        reasons.append("unused-variable")
    return bool(reasons), "+".join(reasons)


def iter_objects(s3_client, bucket: str, prefix: str = "") -> Iterator[dict]:
    paginator = s3_client.get_paginator("list_objects_v2")
    kwargs = {"Bucket": bucket}
    if prefix:
        kwargs["Prefix"] = prefix
    for page in paginator.paginate(**kwargs):
        yield from page.get("Contents", [])


def scan_bucket(
    s3_client,
    bucket: str,
    cutoff_year: int,
    prefix: str = "",
    limit: Optional[int] = None,
) -> ScanResult:
    result = ScanResult()

    for obj in iter_objects(s3_client, bucket, prefix):
        result.scanned += 1
        key = obj["Key"]
        size = obj.get("Size", 0)
        current_class = obj.get("StorageClass", "STANDARD")

        if not key.lower().endswith((".tif", ".tiff")):
            result.skipped_not_tif += 1
            continue

        basename = key.rsplit("/", 1)[-1]
        variable = parse_variable(basename)
        acquisition_date = parse_acquisition_date(basename)
        year = acquisition_date.year if acquisition_date else None
        label = dataset_label(basename, variable)

        archive, reason = classify(basename, variable, acquisition_date, cutoff_year)

        if not archive:
            result.kept_datasets.setdefault(label, DatasetAggregate()).add(size, year, basename)
            continue

        if current_class in ALREADY_COLD:
            result.skipped_already_cold += 1
            continue

        result.plan.append(PlannedAction(key, size, current_class, variable, acquisition_date, reason))
        result.reasons[reason] = result.reasons.get(reason, 0) + 1
        result.archived_datasets.setdefault(label, DatasetAggregate()).add(size, year, basename)

        if result.scanned % 50000 == 0:
            logger.info("  scanned %d objects, %d matched so far...", result.scanned, result.matched)

        if limit is not None and result.matched >= limit:
            logger.info("Reached --limit of %d matched objects; stopping scan early.", limit)
            break

    return result


def format_bytes(num_bytes: int) -> str:
    value = float(num_bytes)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB", "PiB"):
        if value < 1024 or unit == "PiB":
            return f"{value:.2f} {unit}"
        value /= 1024


def estimate_monthly_cost(plan: Iterable[PlannedAction], target_class: str) -> tuple[float, float]:
    standard_rate = STORAGE_RATES_USD_PER_GB_MONTH["STANDARD"]
    target_rate = STORAGE_RATES_USD_PER_GB_MONTH.get(target_class, 0.0)

    overhead_per_object = 0.0
    if target_class in GLACIER_OVERHEAD_TIERS:
        overhead_per_object = (
            (GLACIER_OVERHEAD_STANDARD_BYTES / 1024**3) * standard_rate
            + (GLACIER_OVERHEAD_ARCHIVE_BYTES / 1024**3) * target_rate
        )

    current = 0.0
    target = 0.0
    for action in plan:
        gb = action.size / 1024**3
        current += gb * STORAGE_RATES_USD_PER_GB_MONTH.get(action.current_class, standard_rate)
        target += gb * target_rate + overhead_per_object
    return current, target


def estimate_transition_cost(num_objects: int, target_class: str) -> float:
    rate_per_1000 = TRANSITION_REQUEST_USD_PER_1000.get(target_class, 0.0)
    return (num_objects / 1000.0) * rate_per_1000


def print_dataset_table(title: str, datasets: dict[str, DatasetAggregate]) -> None:
    if not datasets:
        return
    print(f"\n{title}")
    print(f"  {'dataset':<22} {'date range':<14} {'count':>10} {'size':>14}  {'example'}")
    for label in sorted(datasets):
        agg = datasets[label]
        print(f"  {label:<22} {agg.date_range:<14} {agg.count:>10,} {format_bytes(agg.bytes):>14}  {agg.example or ''}")


def print_report(result: ScanResult, target_class: str, cutoff_year: int) -> None:
    current_cost, target_cost = estimate_monthly_cost(result.plan, target_class)
    transition_cost = estimate_transition_cost(result.matched, target_class)
    monthly_savings = current_cost - target_cost

    print("\n" + "=" * 70)
    print("ARCHIVE PLAN SUMMARY")
    print("=" * 70)
    print(f"Cutoff year (from variables.yaml): {cutoff_year}  (archive everything before this)")
    print(f"Target storage class:              {target_class}")
    print(f"Objects scanned:                   {result.scanned:,}")
    print(f"  skipped (not .tif):              {result.skipped_not_tif:,}")
    print(f"  skipped (already cold):          {result.skipped_already_cold:,}")
    print(f"Objects to transition (archive):   {result.matched:,}  ({format_bytes(result.matched_bytes)})")
    print(f"Objects left untouched (kept):     {result.kept_count:,}  ({format_bytes(result.kept_bytes)})")

    if result.reasons:
        print("\nArchived by reason:")
        for reason, count in sorted(result.reasons.items(), key=lambda kv: -kv[1]):
            print(f"  {reason:<28} {count:,}")

    print_dataset_table("Archived datasets (source + variable):", result.archived_datasets)
    print_dataset_table("Kept / untouched datasets (source + variable):", result.kept_datasets)

    print("\nEstimated cost (approx, us-west-2 rates):")
    print(f"  one-time transition: ${transition_cost:,.2f}  ({result.matched:,} PUT-COPY requests into {target_class})")
    print(f"  monthly storage now: ${current_cost:,.2f}/mo")
    print(f"  monthly storage new: ${target_cost:,.2f}/mo  (incl. Glacier per-object overhead)")
    print(f"  monthly savings:     ${monthly_savings:,.2f}/mo  (${monthly_savings * 12:,.2f}/yr)")
    if monthly_savings > 0:
        print(f"  payback period:      {transition_cost / monthly_savings:,.1f} months to recoup the transition cost")
    print("=" * 70)


def write_report_csv(plan: list[PlannedAction], path: str) -> None:
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["key", "size_bytes", "current_storage_class", "variable", "acquisition_date", "reason"])
        for action in plan:
            writer.writerow(
                [
                    action.key,
                    action.size,
                    action.current_class,
                    action.variable or "",
                    action.acquisition_date or "",
                    action.reason,
                ]
            )
    logger.info("Wrote plan for %d objects to %s", len(plan), path)


def transition_object(s3_client, bucket: str, action: PlannedAction, target_class: str) -> tuple[PlannedAction, Optional[str]]:
    if action.size > MAX_SINGLE_COPY_BYTES:
        return action, f"object larger than {format_bytes(MAX_SINGLE_COPY_BYTES)}; needs multipart copy (skipped)"
    try:
        s3_client.copy_object(
            Bucket=bucket,
            Key=action.key,
            CopySource={"Bucket": bucket, "Key": action.key},
            StorageClass=target_class,
            MetadataDirective="COPY",
            TaggingDirective="COPY",
        )
        return action, None
    except ClientError as e:
        return action, str(e)


def execute_plan(
    s3_client,
    bucket: str,
    plan: list[PlannedAction],
    target_class: str,
    workers: int,
) -> tuple[int, list[tuple[PlannedAction, str]]]:
    succeeded = 0
    failures: list[tuple[PlannedAction, str]] = []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(transition_object, s3_client, bucket, action, target_class): action for action in plan}
        for i, future in enumerate(as_completed(futures), start=1):
            action, error = future.result()
            if error:
                failures.append((action, error))
                logger.error("FAILED %s: %s", action.key, error)
            else:
                succeeded += 1
            if i % 1000 == 0:
                logger.info("  transitioned %d/%d objects...", i, len(plan))

    return succeeded, failures


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Move unused (pre-cutoff / legacy Landsat ESI-ET) S3 objects to a Glacier tier.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--bucket", default=DEFAULT_BUCKET, help="S3 bucket to scan.")
    parser.add_argument("--prefix", default="", help="Only scan keys under this prefix.")
    parser.add_argument("--profile", default=DEFAULT_PROFILE, help="AWS profile name.")
    parser.add_argument("--region", default=DEFAULT_REGION, help="AWS region.")
    parser.add_argument(
        "--target-class",
        default="GLACIER_IR",
        choices=["DEEP_ARCHIVE", "GLACIER", "GLACIER_IR"],
        help="Destination storage class.",
    )
    parser.add_argument("--variables-yaml", default=DEFAULT_VARIABLES_YAML, help="Path to variables.yaml.")
    parser.add_argument("--cutoff-year", type=int, default=None, help="Override the cutoff year from variables.yaml.")
    parser.add_argument("--report-csv", default=None, help="Write the full plan to this CSV path.")
    parser.add_argument("--limit", type=int, default=None, help="Stop after this many matched objects.")
    parser.add_argument("--workers", type=int, default=16, help="Parallel copy workers (used only with --execute).")
    parser.add_argument("--execute", action="store_true", help="Actually transition objects (default is dry-run).")
    parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt when executing.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose logging.")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    cutoff_year = args.cutoff_year if args.cutoff_year is not None else load_cutoff_year(args.variables_yaml)

    session = boto3.Session(profile_name=args.profile) if args.profile else boto3.Session()
    s3_client = session.client(
        "s3",
        region_name=args.region,
        config=BotoConfig(retries={"max_attempts": 10, "mode": "adaptive"}),
    )

    mode = "EXECUTE" if args.execute else "DRY-RUN"
    logger.info(
        "[%s] bucket=%s prefix=%r profile=%s region=%s target=%s cutoff=%d",
        mode, args.bucket, args.prefix, args.profile, args.region, args.target_class, cutoff_year,
    )

    logger.info("Scanning bucket (this can take a while for large buckets)...")
    result = scan_bucket(s3_client, args.bucket, cutoff_year, prefix=args.prefix, limit=args.limit)

    print_report(result, args.target_class, cutoff_year)

    if args.report_csv:
        write_report_csv(result.plan, args.report_csv)

    if not result.plan:
        logger.info("Nothing to transition. Done.")
        return 0

    if not args.execute:
        print("\nDRY-RUN: no changes made. Re-run with --execute to apply.")
        return 0

    if not args.yes:
        print(
            f"\nAbout to transition {result.matched:,} objects ({format_bytes(result.matched_bytes)}) "
            f"to {args.target_class} in bucket '{args.bucket}'."
        )
        print(
            f"This is hard to reverse: restoring from {args.target_class} incurs retrieval fees "
            "and a minimum-storage-duration charge."
        )
        if input("Type 'yes' to proceed: ").strip().lower() != "yes":
            print("Aborted.")
            return 1

    logger.info("Transitioning %d objects with %d workers...", result.matched, args.workers)
    succeeded, failures = execute_plan(s3_client, args.bucket, result.plan, args.target_class, args.workers)

    print(f"\nDone. {succeeded:,} transitioned, {len(failures):,} failed.")
    if failures:
        print("Failures (first 20):")
        for action, error in failures[:20]:
            print(f"  {action.key}: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
