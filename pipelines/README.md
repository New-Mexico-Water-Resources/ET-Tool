# Data Pipelines

This directory contains the pipelines to fetch new data from the sources and upload it to AWS.

## Running the Pipelines

To run the pipelines, either use the `run_pipeline.py` script or use the `NewDataPipeline.ipynb` notebook.

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

## Run Pipeline Notebook

The `NewDataPipeline.ipynb` notebook is a Jupyter notebook that allows you to run the pipelines interactively.

```bash
jupyter notebook NewDataPipeline.ipynb
```
