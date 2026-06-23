#!/usr/bin/env python3

import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from water_rights_visualizer.custom_report_generator import (
    CustomReportConfig,
    generate_custom_preview,
    generate_custom_report,
    get_et_scale_bounds,
)


def _optional_float(value):
    if value is None or value == "":
        return None
    return float(value)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate a custom ET report from existing job outputs")
    parser.add_argument("--config", required=True, help="Path to JSON configuration file")
    args = parser.parse_args(argv)

    try:
        with open(args.config, "r", encoding="utf-8") as f:
            raw = json.load(f)

        config = CustomReportConfig(
            output_directory=raw["output_directory"],
            roi_path=raw["roi_path"],
            roi_name=raw["roi_name"],
            start_year=int(raw["start_year"]),
            end_year=int(raw["end_year"]),
            et_units=raw.get("et_units", "metric"),
            ppt_units=raw.get("ppt_units", "metric"),
            color_scale=raw.get("color_scale", "across_years"),
            et_custom_min=_optional_float(raw.get("et_custom_min")),
            et_custom_max=_optional_float(raw.get("et_custom_max")),
            show_monthly_averages=bool(raw.get("show_monthly_averages", False)),
            start_month=int(raw.get("start_month", 1)),
            end_month=int(raw.get("end_month", 12)),
            requestor=raw.get("requestor"),
            output_dir=raw.get("output_dir"),
            include_summary=raw.get("include_summary", True),
            include_documentation=raw.get("include_documentation", True),
        )

        mode = raw.get("mode", "report")
        if mode == "bounds":
            year = int(raw["year"])
            bounds = get_et_scale_bounds(config, year)
            print(json.dumps(bounds))
            return 0
        elif mode == "preview":
            preview_kind = raw.get("preview_kind", "year")
            year = int(raw["year"]) if raw.get("year") is not None else None
            doc_page = int(raw.get("preview_page", 1))
            result_path = generate_custom_preview(config, preview_kind=preview_kind, year=year, doc_page=doc_page)
        else:
            result_path = generate_custom_report(config)

        print(json.dumps({"path": result_path}))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "traceback": traceback.format_exc()}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
