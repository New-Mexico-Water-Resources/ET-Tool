from __future__ import annotations

from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin


def write_monthly_tile_geotiff(
    output_path: Path,
    tile_hv: str,
    month_start: date,
    variable_suffix: str,
    constant_value: float,
    file_prefix: str,
    cell_size: float = 0.0003,
    rows: int = 40,
    cols: int = 40,
    west: float = -106.78,
    north: float = 32.21,
) -> Path:
    output_dir = Path(output_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    month_end_year = month_start.year + (1 if month_start.month == 12 else 0)
    month_end_month = 1 if month_start.month == 12 else month_start.month + 1
    month_end = date(month_end_year, month_end_month, 1)

    filename = (
        f"{file_prefix}_{tile_hv}_{month_start:%Y%m%d}_{month_end:%Y%m%d}_{variable_suffix}.tif"
    )
    full_path = output_dir / filename

    transform = from_origin(west, north, cell_size, cell_size)
    data = np.full((rows, cols), constant_value, dtype=np.float32)

    with rasterio.open(
        full_path,
        "w",
        driver="GTiff",
        height=rows,
        width=cols,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
    ) as dataset:
        dataset.write(data, 1)

    return full_path


def build_synthetic_openet_year(
    output_root: Path,
    tile_hv: str,
    year: int,
    et_value: float = 50.0,
    et_min_value: float = 40.0,
    et_max_value: float = 60.0,
    eto_value: float = 80.0,
    ppt_value: float = 15.0,
) -> Path:
    output_root = Path(output_root)
    for month in range(1, 13):
        month_start = date(year, month, 1)
        write_monthly_tile_geotiff(
            output_root / "monthly",
            tile_hv,
            month_start,
            "ET",
            et_value + month,
            "OPENET_ENSEMBLE",
        )
        write_monthly_tile_geotiff(
            output_root / "uncertainty" / "output" / "2019",
            tile_hv,
            month_start,
            "ET_MIN",
            et_min_value + month,
            "OPENET_ENSEMBLE",
        )
        write_monthly_tile_geotiff(
            output_root / "uncertainty" / "output" / "2019",
            tile_hv,
            month_start,
            "ET_MAX",
            et_max_value + month,
            "OPENET_ENSEMBLE",
        )
        write_monthly_tile_geotiff(
            output_root / "monthly",
            tile_hv,
            month_start,
            "ETO",
            eto_value + month,
            "IDAHO_EPSCOR_GRIDMET",
        )
        write_monthly_tile_geotiff(
            output_root / "precipitation",
            tile_hv,
            month_start,
            "PPT",
            ppt_value + month,
            "OREGON_STATE_PRISM",
        )
    return output_root
