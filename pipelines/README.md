# Data Pipelines

This directory contains the pipelines to fetch new data from the sources and upload it to AWS.

## Running the Pipelines

The main data-ingestion workflow is driven by `run_pipeline.py` or the `NewDataPipeline.ipynb` notebook. Additional standalone scripts are also available:

- **`landsat/landsat_pass_pipeline.py`** — generate monthly Landsat pass-count COG layers for ARD tiles
- **`archive_unused_s3_objects.py`** — transition unused S3 GeoTIFFs to Glacier storage tiers

See the sections below for usage details on each pipeline.

## Installation

To run the pipelines, first create a python virtual environment. If using conda, you can do the following:

```bash
conda create --name nmw-pipelines python=3.10
conda activate nmw-pipelines
```

Next, install the dependencies:

```bash
pip install -r requirements.txt
```

Once the environment is created, AWS credentials, Google Drive credentials, and Google Earth Engine credentials are needed.

### AWS Credentials

By default, the pipelines use the `ose-nmw` AWS profile. If you are using a different profile, you can use the `--aws-profile` flag. This profile should have both read and write access to the `ose-dev-inputs` S3 bucket (or the bucket specified with the `--aws-bucket` flag).

### Google Earth Engine Credentials

To run the pipelines, you need to have a Google Cloud Platform account. If you don't have one, you can create one [here](https://console.cloud.google.com/).

Once you have an account, create a new project. The default project name used here is `et-exploration`, but this can be configured with the `--gee-project` flag.

Once the project is created, you need to enable the Google Earth Engine API. To do this, go to the [Google Cloud Console](https://console.cloud.google.com/) and navigate to the project. Next, navigate to the "APIs & Services" section and click on "Enable APIs and Services". Search for "Google Earth Engine API" and click on it. Click "Enable" to enable the API.


### Google Drive Credentials

To retrieve the data from Google Drive, you need to create a Google Drive client secrets JSON file and a Google Drive key file.

To generate the client secrets JSON file, follow the instructions [here](https://docs.iterative.ai/PyDrive2/quickstart/).
In summary:

1. Go to APIs Console and make your own project.
2. Search for ‘Google Drive API’, select the entry, and click ‘Enable’.
3. Select ‘Credentials’ from the left menu, click ‘Create Credentials’, select ‘OAuth client ID’.
4. Now, the product name and consent screen need to be set -> click ‘Configure consent screen’ and follow the instructions. Once finished:
    a. Select ‘Application type’ to be Web application.
    b. Enter an appropriate name.
    c. Input http://localhost:8080/ for ‘Authorized redirect URIs’.
    d. Click ‘Create’.
5. Click ‘Download JSON’ on the right side of Client ID to download client_secret_<really long ID>.json.
6. The downloaded file has all authentication information of your application. Rename the file to client_secret.json” and place it in your working directory.

### Run Pipeline CLI Tool

The CLI tool is used to automate the process of submitting a request for new data from Google Earth Engine and other sources, exporting this to Google Drive, then downloading the data from Google Drive and uploading it to AWS. The NewDataPipeline.ipynb notebook is recommended for interactive use.

```bash
python run_pipeline.py --help
Water Rights Data Pipeline - Fetch ET, ETO, and PPT data

options:
  -h, --help            show this help message and exit
  --start-year START_YEAR
                        Start year for data fetching (e.g., 2020)
  --end-year END_YEAR   End year for data fetching (inclusive, e.g., 2022)
  --aws-bucket AWS_BUCKET
                        AWS S3 bucket name (default: ose-dev-inputs)
  --aws-region AWS_REGION
                        AWS region (default: us-west-2)
  --aws-profile AWS_PROFILE
                        AWS profile name (default: ose-nmw)
  --gee-project GEE_PROJECT
                        Google Earth Engine project ID (default: et-exploration)
  --gdrive-client-secrets GDRIVE_CLIENT_SECRETS
                        Path to Google Drive client secrets JSON file
  --gdrive-key GDRIVE_KEY
                        Path to Google Drive key file
  --skip-openet         Skip OpenET pipeline (ET, ET_MIN, ET_MAX)
  --skip-gridmet        Skip GRIDMET pipeline (ETO)
  --skip-prism          Skip PRISM pipeline (PPT)
  --allow-provisional   Allow provisional PRISM data (default: True)
  --download-only       Download data mode, do not upload to AWS
  --transfer-only       Transfer data mode, do not fetch new data
  --verbose, -v         Enable verbose logging

Examples:

# Fetch only PRISM data for 2024
python run_pipeline.py --start-year 2024 --end-year 2024 --skip-openet --skip-gridmet
```

## Landsat Pass COG Pipeline

`landsat/landsat_pass_pipeline.py` generates monthly Landsat pass-count Cloud Optimized GeoTIFF (COG) layers for ARD tiles. It queries the Microsoft Planetary Computer catalog for Landsat 5/7/8/9 scenes, counts observations per pixel, and writes one COG per tile per month.

Each output file contains three bands:

- **Band 1** (`total_observations`): total scene observations per pixel
- **Band 2** (`non_cloudy_observations`): observations where the pixel is not flagged as cloud
- **Band 3** (`pass_days`): unique calendar days with any observation per pixel

These layers are used by the water-rights visualizer to cache Landsat pass statistics without re-querying Planetary Computer on every report run.

```bash
python landsat/landsat_pass_pipeline.py --help
```

```bash
# Dry Run Mode to get ETA and total file counts for run before executing
python landsat/landsat_pass_pipeline.py --start-year 2024 --end-year 2024 --dry-run

# Generate cache data for all tiles in 2024
python landsat/landsat_pass_pipeline.py --start-year 2024 --end-year 2024

# Generate a single month for two tiles, then upload to S3
python landsat/landsat_pass_pipeline.py \
  --start-year 2024 --end-year 2024 --start-month 6 --end-month 6 \
  --tile-ids 008014 009011 \
  --upload

# Upload existing local COG files without regenerating
python landsat/landsat_pass_pipeline.py --upload-only

# Retry tasks that failed on a previous run
python landsat/landsat_pass_pipeline.py --retry-failures
```

Failed generation tasks are logged to `<output-dir>/landsat_pass_generation_failures.jsonl`. Use `--retry-failures` to re-run only those tasks (removed on success).

Key options:

| Flag | Description |
|------|-------------|
| `--start-year`, `--end-year` | Required year range (inclusive) |
| `--output-dir` | Local output directory (default: `landsat_pass_layers_output`) |
| `--tile-ids` | Subset of ARD tile `hv` IDs |
| `--overwrite` | Regenerate layers even if they already exist locally or in S3 |
| `--upload` / `--upload-only` | Upload to S3 after generation, or upload existing local files only |
| `--dry-run` | Print planned work and exit without generating or uploading |
| `--retry-failures` | Retry tasks listed in the failures JSONL file |

## Archive Unused S3 Objects

`archive_unused_s3_objects.py` scans an S3 input bucket and identifies GeoTIFF objects that are no longer needed in Standard storage. Matching objects can be transitioned to a Glacier storage tier to reduce monthly storage cost.

By default the script runs in **dry-run** mode: it scans the bucket, prints a summary report with cost estimates, and makes no changes. Pass `--execute` to apply transitions.

Objects are selected for archival when any of the following apply:

- **Pre-cutoff data**: acquisition date is before the year in `openet_transition_date` from `variables.yaml` (1985)
- **Legacy Landsat ESI/ET**: Landsat 4/5/7/8 scenes for the `ESI` or `ET` variables
- **Unused variables**: `COUNT` or `CCOUNT` layers

Objects already in `GLACIER`, `DEEP_ARCHIVE`, or `GLACIER_IR` are skipped. The report groups matched and kept objects by data source and variable, and estimates one-time transition cost and monthly storage savings.

```bash
python archive_unused_s3_objects.py --help
```

```bash
# Dry Run: Use configured bucket and profile and generate count, file sizes, and transition cost estimates to move items to S3 Glacier Instant Retrieval Tier
python -m pipelines.archive_unused_s3_objects --bucket ose-dev-inputs --profile ose-nmw  --target-class GLACIER_IR

# Dry Run and log all files to be transitioned to a file
python -m pipelines.archive_unused_s3_objects --bucket ose-dev-inputs --profile ose-nmw  --report-csv s3_transition_files.csv --target-class GLACIER_IR

# Execute a full run transitioning matched items to Glacier Instant Retrieval Tier
python -m pipelines.archive_unused_s3_objects --bucket ose-dev-inputs --profile ose-nmw  --target-class GLACIER_IR --execute
```

Key options:

| Flag | Description |
|------|-------------|
| `--bucket` | S3 bucket to scan (default: `ose-dev-inputs`, or `S3_INPUT_BUCKET` env var) |
| `--prefix` | Limit the scan to keys under this prefix |
| `--profile` | AWS profile (default: `AWS_PROFILE` env var) |
| `--target-class` | Destination storage class: `GLACIER_IR` (default), `GLACIER`, or `DEEP_ARCHIVE` |
| `--cutoff-year` | Override the cutoff year from `variables.yaml` |
| `--report-csv` | Write the full transition plan to a CSV file |
| `--limit` | Stop scanning after this many matched objects (useful for testing) |
| `--execute` | Actually transition objects (default is dry-run only) |
| `--workers` | Parallel S3 copy workers when executing (default: 16) |

Restoring objects from Glacier incurs retrieval fees and minimum-storage-duration charges. Review the dry-run report before executing.

## Run Pipeline Notebook

The `NewDataPipeline.ipynb` notebook is a Jupyter notebook that allows you to run the pipelines interactively.

```bash
jupyter notebook NewDataPipeline.ipynb
```
