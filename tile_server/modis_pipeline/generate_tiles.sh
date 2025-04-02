#!/bin/bash

set -e

CONDA_BASE=$(conda info --base)
source "$CONDA_BASE/etc/profile.d/conda.sh"

INPUT_DIR="~/data/modis_net_et_8_day/et_tiffs"
OUTPUT_DIR="~/data/modis_net_et_8_day/et_tiles"
MERGED_DIR="~/data/modis_net_et_8_day/raw_et"
TEMP_DIR="~/data/modis_net_et_8_day/temp"

mkdir -p "$TEMP_DIR"
mkdir -p "$OUTPUT_DIR"
mkdir -p "$MERGED_DIR"

for date_folder in "$INPUT_DIR"/*/; do
    date=$(basename "$date_folder")
    TILE_OUTPUT="$OUTPUT_DIR/$date/tiles"
    MERGED_TIF="${TEMP_DIR}/MOD16A2_ET_500m_${date}_merged.tif"
    merc_tif="${MERGED_DIR}/MOD16A2_MERGED_${date}_ET.tif"
    color_tif="${TEMP_DIR}/MOD16A2_ET_500m_${date}_color.tif"

    echo "Processing all TIFFs for $date..."

    # If MERGED_TIF or merc_tif already exists, skip processing
    if [ ! -f "$MERGED_TIF" ]; then
        echo "Merging TIFFs for $date..."
        gdal_merge.py -o "$MERGED_TIF" -of GTiff "$date_folder"/*.tif -n 32700 -a_nodata 32700 -co COMPRESS=LZW -co BIGTIFF=YES
        if [ $? -ne 0 ]; then
            echo "ERROR: Failed to merge TIFFs for $date. Skipping..."
            continue
        fi
    else
        echo "Merged TIFF already exists: $MERGED_TIF"
    fi

    # rm -f "$merc_tif" "$color_tif"

    if [ ! -f "$merc_tif" ]; then
        echo "Reprojecting to Web Mercator..."
        gdalwarp -t_srs EPSG:3857 -tr 500 500 -tap -r bilinear -dstnodata 32700 -co COMPRESS=LZW -overwrite "$MERGED_TIF" "$merc_tif"
        if [ $? -ne 0 ]; then
            echo "ERROR: Failed to reproject $MERGED_TIF. Skipping..."
            continue
        fi
    else
        echo "$merc_tif already exists. Skipping reprojection..."
    fi


    if [ ! -f "$color_tif" ]; then
        echo "➡ Applying color ramp..."
        gdaldem color-relief "$merc_tif" colormap.txt "$color_tif" -alpha
        if [ $? -ne 0 ]; then
            echo "ERROR: Failed to apply color relief to $merc_tif. Skipping..."
            continue
        fi
    else
        echo "$color_tif already exists. Skipping colorization..."
    fi

    # echo "Generating tiles for $date (overwriting existing ones)..."
    # rm -rf "$TILE_OUTPUT"
    # mkdir -p "$TILE_OUTPUT"

    # gdal2tiles.py --zoom=1-11 --tilesize=256 -s EPSG:3857 -w leaflet "$color_tif" "$TILE_OUTPUT"
    # if [ $? -ne 0 ]; then
    #     echo "ERROR: Failed to generate tiles for $color_tif. Skipping..."
    #     continue
    # fi

    echo "Finished processing $date"

    echo "Cleaning up intermediate files..."
    rm -f "$MERGED_TIF" "$color_tif"

done

echo "All tiles generated!"