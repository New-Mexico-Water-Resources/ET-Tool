#!/usr/bin/env python3

import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from water_rights_visualizer.comparison_report_generator import (
    COMPARISON_REPORT_PREVIEW_VERSION,
    ComparisonReportConfig,
    JobReportSource,
    generate_comparison_preview,
    generate_comparison_report,
    get_comparison_scale_bounds,
)


def _optional_float(value):
    if value is None or value == "":
        return None
    return float(value)


def _job_source(raw: dict) -> JobReportSource:
    return JobReportSource(
        output_directory=raw["output_directory"],
        roi_path=raw["roi_path"],
        roi_name=raw["roi_name"],
        start_year=int(raw["start_year"]),
        end_year=int(raw["end_year"]),
    )


def _normalize_map_tile_mode(value: str | None) -> str:
    mode = value or "yearly_total"
    if mode == "yearly_average":
        return "yearly_total"
    return mode


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate a comparison ET report from existing job outputs")
    parser.add_argument("--config", required=True, help="Path to JSON configuration file")
    args = parser.parse_args(argv)

    try:
        with open(args.config, "r", encoding="utf-8") as f:
            raw = json.load(f)

        config = ComparisonReportConfig(
            primary=_job_source(raw["primary"]),
            comparison=_job_source(raw["comparison"]),
            et_units=raw.get("et_units", "metric"),
            ppt_units=raw.get("ppt_units", "metric"),
            et_eto_scale=raw.get("et_eto_scale", "across_years"),
            et_eto_custom_min=_optional_float(raw.get("et_eto_custom_min")),
            et_eto_custom_max=_optional_float(raw.get("et_eto_custom_max")),
            ppt_scale=raw.get("ppt_scale", "across_years"),
            ppt_custom_min=_optional_float(raw.get("ppt_custom_min")),
            ppt_custom_max=_optional_float(raw.get("ppt_custom_max")),
            color_scale=raw.get("color_scale", "across_years"),
            et_custom_min=_optional_float(raw.get("et_custom_min")),
            et_custom_max=_optional_float(raw.get("et_custom_max")),
            start_month=int(raw.get("start_month", 1)),
            end_month=int(raw.get("end_month", 12)),
            requestor=raw.get("requestor"),
            output_dir=raw.get("output_dir"),
            include_summary=raw.get("include_summary", True),
            include_yearly_combined=bool(raw.get("include_yearly_combined", False)),
            map_tile_mode=_normalize_map_tile_mode(raw.get("map_tile_mode")),
            map_tile_month=int(raw.get("map_tile_month", 1)),
        )

        mode = raw.get("mode", "report")
        if mode == "bounds":
            year = int(raw["year"])
            bounds = get_comparison_scale_bounds(config, year)
            print(json.dumps(bounds))
            return 0

        if mode == "preview":
            preview_kind = raw.get("preview_kind", "year")
            year = int(raw["year"]) if raw.get("year") is not None else None
            result_path = generate_comparison_preview(
                config,
                preview_kind=preview_kind,
                year=year,
                force_refresh=bool(raw.get("force_refresh", False)),
                preview_version=int(raw.get("preview_version", COMPARISON_REPORT_PREVIEW_VERSION)),
            )
        else:
            result_path = generate_comparison_report(config)

        print(json.dumps({"path": result_path}))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "traceback": traceback.format_exc()}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
