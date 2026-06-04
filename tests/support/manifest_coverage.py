from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

import yaml
from dateutil.relativedelta import relativedelta

from tests.support.paths import (
    ARD_TILES_GEOJSON,
    MANIFEST_COVERAGE_GAPS_CSV,
    MANIFEST_COVERAGE_RULES,
    MANIFEST_CSV,
    TESTS_OUTPUT_DIR,
    VARIABLES_YAML,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CoverageGap:
    variable: str
    tile: str
    month: str
    source_id: str

    @property
    def year(self) -> str:
        return self.month[:4]

    @property
    def filename_hint(self) -> str:
        month_start = datetime.strptime(self.month, "%Y-%m-%d")
        month_end = month_start + relativedelta(months=1)
        return (
            f"*_{self.tile}_{month_start.strftime('%Y%m%d')}_"
            f"{month_end.strftime('%Y%m%d')}_{self.variable}.tif"
        )


@dataclass(frozen=True)
class CoverageReport:
    expected_count: int
    present_count: int
    gaps: tuple[CoverageGap, ...]

    @property
    def missing_count(self) -> int:
        return len(self.gaps)

    @property
    def is_complete(self) -> bool:
        return self.missing_count == 0


@dataclass(frozen=True)
class MissingManifestSummary:
    total_missing: int
    gaps: tuple[CoverageGap, ...]
    by_source: dict[str, int]
    by_variable: dict[str, int]
    by_tile: dict[str, int]
    by_year: dict[str, int]


def load_yaml(path) -> dict:
    with open(path, "r") as handle:
        return yaml.safe_load(handle) or {}


def normalize_coverage_rules(rules: dict | None) -> dict:
    normalized = dict(rules or {})
    for key in (
        "variable_start_overrides",
        "variable_end_overrides",
        "tiles_excluded_by_variable",
        "tile_variable_start_overrides",
    ):
        if not isinstance(normalized.get(key), dict):
            normalized[key] = {}
    if not isinstance(normalized.get("known_missing_entries"), list):
        normalized["known_missing_entries"] = []
    return normalized


def load_ard_tiles() -> list[str]:
    import json

    with open(ARD_TILES_GEOJSON, "r") as handle:
        geojson = json.load(handle)
    return sorted(feature["properties"]["hv"] for feature in geojson["features"])


def month_starts_between(start: datetime, end: datetime) -> list[str]:
    months = []
    current = datetime(start.year, start.month, 1)
    while current < end:
        months.append(current.strftime("%Y-%m-01"))
        current += relativedelta(months=1)
    return months


def post_transition_sources(variables_config: dict) -> list[dict]:
    transition_year = variables_config["openet_transition_date"]
    transition_date = datetime(transition_year, 1, 1)
    sources = []
    for source in variables_config["sources"]:
        source_start = datetime.strptime(source["start"], "%Y-%m-%d")
        source_end = datetime.strptime(source["end"], "%Y-%m-%d")
        if source_end <= transition_date:
            continue
        sources.append(source)
    return sources


def _count_by(items: Iterable[CoverageGap], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        key = getattr(item, field)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def build_missing_summary(gaps: Iterable[CoverageGap]) -> MissingManifestSummary:
    gap_list = tuple(sorted(gaps, key=lambda gap: (gap.source_id, gap.variable, gap.tile, gap.month)))
    return MissingManifestSummary(
        total_missing=len(gap_list),
        gaps=gap_list,
        by_source=_count_by(gap_list, "source_id"),
        by_variable=_count_by(gap_list, "variable"),
        by_tile=_count_by(gap_list, "tile"),
        by_year=_count_by(gap_list, "year"),
    )


def format_missing_summary(summary: MissingManifestSummary) -> str:
    if summary.total_missing == 0:
        return "Manifest coverage complete: no missing entries."

    lines = [f"Manifest coverage: {summary.total_missing} missing entries"]

    if len(summary.by_source) == 1:
        source_id, count = next(iter(summary.by_source.items()))
        lines.append(f"- All {count} missing entries are for source {source_id}")
    else:
        lines.append("- Missing by source:")
        for source_id, count in summary.by_source.items():
            lines.append(f"  {source_id}: {count}")

    if len(summary.by_variable) == 1:
        variable, count = next(iter(summary.by_variable.items()))
        lines.append(f"- All missing entries are for variable {variable}")
    else:
        lines.append("- Missing by variable:")
        for variable, count in summary.by_variable.items():
            lines.append(f"  {variable}: {count}")

    if len(summary.by_tile) == 1:
        tile, count = next(iter(summary.by_tile.items()))
        lines.append(f"- All missing entries are for tile {tile}")
    elif len(summary.by_tile) <= 5:
        lines.append("- Missing by tile:")
        for tile, count in summary.by_tile.items():
            lines.append(f"  {tile}: {count}")
    else:
        top_tiles = sorted(summary.by_tile.items(), key=lambda item: item[1], reverse=True)[:5]
        lines.append(f"- Missing across {len(summary.by_tile)} tiles; top counts:")
        for tile, count in top_tiles:
            lines.append(f"  {tile}: {count}")

    if len(summary.by_year) == 1:
        year, count = next(iter(summary.by_year.items()))
        lines.append(f"- All missing entries are in year {year}")
    elif len(summary.by_year) <= 5:
        lines.append("- Missing by year:")
        for year, count in summary.by_year.items():
            lines.append(f"  {year}: {count}")
    else:
        lines.append(f"- Missing across {len(summary.by_year)} years")

    if summary.total_missing <= 10:
        lines.append("- Missing entries:")
        for gap in summary.gaps:
            lines.append(
                f"  {gap.source_id} {gap.variable} tile={gap.tile} month={gap.month} ({gap.filename_hint})"
            )
    else:
        lines.append(f"- First 10 missing entries:")
        for gap in summary.gaps[:10]:
            lines.append(
                f"  {gap.source_id} {gap.variable} tile={gap.tile} month={gap.month} ({gap.filename_hint})"
            )
        lines.append(f"  ... and {summary.total_missing - 10} more")

    return "\n".join(lines)


def write_missing_manifest_csv(gaps: Iterable[CoverageGap], output_path: Path = MANIFEST_COVERAGE_GAPS_CSV) -> Path:
    import pandas as pd

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rows = [
        {
            "source_id": gap.source_id,
            "variable": gap.variable,
            "tile": gap.tile,
            "year": gap.year,
            "month": gap.month,
            "expected_filename_pattern": gap.filename_hint,
        }
        for gap in sorted(gaps, key=lambda item: (item.source_id, item.variable, item.tile, item.month))
    ]
    pd.DataFrame(rows).to_csv(output_path, index=False)
    return output_path.resolve()


class ManifestCoverageChecker:
    def __init__(
        self,
        variables_path=VARIABLES_YAML,
        manifest_path=MANIFEST_CSV,
        rules_path=MANIFEST_COVERAGE_RULES,
    ):
        self.variables_config = load_yaml(variables_path)
        self.rules = normalize_coverage_rules(load_yaml(rules_path))
        self.tiles = load_ard_tiles()
        self.manifest = self._load_manifest(manifest_path)

    @staticmethod
    def _load_manifest(manifest_path):
        import pandas as pd

        manifest = pd.read_csv(manifest_path)
        manifest["tile"] = manifest["tile"].apply(lambda value: f"{int(value):06d}")
        manifest["date"] = manifest["date"].astype(str)
        return manifest

    def _effective_start(self, variable: str, source: dict, tile: str) -> datetime:
        transition_year = self.variables_config["openet_transition_date"]
        transition_date = datetime(transition_year, 1, 1)
        source_start = datetime.strptime(source["start"], "%Y-%m-%d")
        effective_start = max(source_start, transition_date)

        variable_override = self.rules.get("variable_start_overrides", {}).get(variable)
        if variable_override:
            effective_start = max(effective_start, datetime.strptime(variable_override, "%Y-%m-%d"))

        tile_overrides = self.rules.get("tile_variable_start_overrides", {}).get(tile, {})
        tile_override = tile_overrides.get(variable)
        if tile_override:
            effective_start = max(effective_start, datetime.strptime(tile_override, "%Y-%m-%d"))

        return effective_start

    def _effective_end(self, variable: str, source: dict) -> datetime:
        end = datetime.strptime(source["end"], "%Y-%m-%d")
        variable_override = self.rules.get("variable_end_overrides", {}).get(variable)
        if variable_override:
            end = min(end, datetime.strptime(variable_override, "%Y-%m-%d"))
        return end

    def _known_missing_entries(self) -> set[tuple[str, str, str]]:
        entries = set()
        for item in self.rules.get("known_missing_entries", []):
            entries.add((item["variable"], item["tile"], item["month"]))
        return entries

    def _tiles_for_variable(self, variable: str) -> list[str]:
        excluded = set(self.rules.get("tiles_excluded_by_variable", {}).get(variable, []))
        return [tile for tile in self.tiles if tile not in excluded]

    def expected_entries(self, source: dict) -> set[tuple[str, str, str]]:
        variable = source["mapped_variable"]
        end = self._effective_end(variable, source)
        entries = set()
        for tile in self._tiles_for_variable(variable):
            months = month_starts_between(self._effective_start(variable, source, tile), end)
            for month in months:
                entries.add((variable, tile, month))
        return entries

    def present_entries_for_variable(self, variable: str) -> set[tuple[str, str, str]]:
        subset = self.manifest[self.manifest["variable"] == variable]
        return {(row.variable, row.tile, row.date) for row in subset.itertuples()}

    def check_source(self, source: dict) -> CoverageReport:
        variable = source["mapped_variable"]
        expected = self.expected_entries(source)
        present = self.present_entries_for_variable(variable)
        allowed_missing = self._known_missing_entries()
        gaps = tuple(
            sorted(
                (
                    CoverageGap(variable=variable, tile=tile, month=month, source_id=source["id"])
                    for variable, tile, month in expected - present
                    if (variable, tile, month) not in allowed_missing
                ),
                key=lambda gap: (gap.variable, gap.tile, gap.month),
            )
        )
        return CoverageReport(
            expected_count=len(expected),
            present_count=len(expected) - len(gaps),
            gaps=gaps,
        )

    def check_all_sources(self) -> dict[str, CoverageReport]:
        return {source["id"]: self.check_source(source) for source in post_transition_sources(self.variables_config)}

    def collect_all_gaps(self, source_ids: Iterable[str] | None = None) -> tuple[CoverageGap, ...]:
        reports = self.check_all_sources()
        gaps = []
        for source_id, report in reports.items():
            if source_ids is not None and source_id not in source_ids:
                continue
            gaps.extend(report.gaps)
        return tuple(gaps)

    def export_missing_coverage(
        self,
        source_ids: Iterable[str] | None = None,
        output_path: Path = MANIFEST_COVERAGE_GAPS_CSV,
    ) -> tuple[Path | None, MissingManifestSummary]:
        gaps = self.collect_all_gaps(source_ids)
        summary = build_missing_summary(gaps)
        if summary.total_missing == 0:
            return None, summary

        csv_path = write_missing_manifest_csv(gaps, output_path)
        message = format_missing_summary(summary)
        logger.warning("%s\nMissing manifest CSV: %s", message, csv_path)
        return csv_path, summary

    def summarize_gaps(self, limit: int = 20) -> str:
        gaps = self.collect_all_gaps()
        return format_missing_summary(build_missing_summary(gaps))
