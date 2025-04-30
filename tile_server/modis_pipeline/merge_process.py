import os
import subprocess
from tqdm import tqdm


def get_env_path(key, default):
    """Get path from environment variable or use default."""
    path = os.getenv(key, default)
    return os.path.expanduser(path)


# Get paths from environment variables
INPUT_DIR = get_env_path("MODIS_INPUT_DIR", "~/data/modis_net_et_8_day/et_tiffs")
OUTPUT_DIR = get_env_path("MODIS_OUTPUT_DIR", "~/data/modis_net_et_8_day/et_tiles")
MERGED_DIR = get_env_path("MODIS_MERGED_DIR", "~/data/modis_net_et_8_day/raw_et")
TEMP_DIR = get_env_path("MODIS_TEMP_DIR", "~/data/modis_net_et_8_day/temp")
DATA_PRODUCT = os.getenv("MODIS_BASE_DATA_PRODUCT", "MOD16A2GF")


def merge_and_process_tiffs(generate_tiles=False, min_zoom=1, max_zoom=11, band_name="ET_500m", output_band_name="ET"):
    """Merge TIFFs, reproject to Web Mercator, and optionally generate tiles.

    Args:
        generate_tiles: Whether to generate PNG tiles (requires colorized TIFF)
    """
    os.makedirs(TEMP_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(MERGED_DIR, exist_ok=True)

    pb = tqdm(os.listdir(INPUT_DIR), desc="Processing date folders")
    for date_folder in pb:
        date_folder_path = os.path.join(INPUT_DIR, date_folder)
        if not os.path.isdir(date_folder_path):
            continue

        date = date_folder
        tile_output = os.path.join(OUTPUT_DIR, date, "tiles")
        merged_tif = os.path.join(TEMP_DIR, f"{DATA_PRODUCT}_{band_name}_{date}_merged.tif")
        merc_tif = os.path.join(MERGED_DIR, f"{DATA_PRODUCT}_MERGED_{date}_{output_band_name}.tif")
        color_tif = os.path.join(TEMP_DIR, f"{DATA_PRODUCT}_{band_name}_{date}_color.tif")

        # Skip if already processed
        if os.path.exists(merc_tif) and (not generate_tiles or os.path.exists(color_tif)):
            pb.set_description(f"Skipping {date} - already processed")
            continue

        # Merge TIFFs
        tiff_files = [os.path.join(date_folder_path, f) for f in os.listdir(date_folder_path) if f.endswith(".tif")]
        if not tiff_files:
            pb.set_description(f"No TIFF files found for {date}")
            continue

        print(f"Merging TIFFs for {date}...")
        merge_cmd = [
            "gdal_merge.py",
            "-o",
            merged_tif,
            "-of",
            "GTiff",
            "-n",
            "32700",
            "-a_nodata",
            "32700",
            "-co",
            "COMPRESS=LZW",
            "-co",
            "BIGTIFF=YES",
        ] + tiff_files

        try:
            subprocess.run(merge_cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Error merging TIFFs for {date}: {e}")
            continue

        # Reproject to Web Mercator
        print(f"Reprojecting to Web Mercator for {date}...")
        warp_cmd = [
            "gdalwarp",
            "-t_srs",
            "EPSG:3857",
            "-tr",
            "500",
            "500",
            "-tap",
            "-r",
            "bilinear",
            "-dstnodata",
            "32700",
            "-co",
            "COMPRESS=LZW",
            "-overwrite",
            merged_tif,
            merc_tif,
        ]

        try:
            subprocess.run(warp_cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Error reprojecting {date}: {e}")
            continue

        # Only apply color relief if we're generating tiles
        if generate_tiles:
            print(f"Applying color ramp for {date}...")
            color_cmd = ["gdaldem", "color-relief", merc_tif, "colormap.txt", color_tif, "-alpha"]

            try:
                subprocess.run(color_cmd, check=True)
            except subprocess.CalledProcessError as e:
                print(f"Error applying color relief for {date}: {e}")
                continue

            # Generate tiles
            print(f"Generating tiles for {date}...")
            os.makedirs(tile_output, exist_ok=True)
            tile_cmd = [
                "gdal2tiles.py",
                f"--zoom={min_zoom}-{max_zoom}",
                "--tilesize=256",
                "-s",
                "EPSG:3857",
                "-w",
                "leaflet",
                color_tif,
                tile_output,
            ]

            try:
                subprocess.run(tile_cmd, check=True)
            except subprocess.CalledProcessError as e:
                print(f"Error generating tiles for {date}: {e}")
                continue

        # Clean up intermediate files
        os.remove(merged_tif)
        if generate_tiles:
            os.remove(color_tif)
