from os import makedirs
import shutil
import sys
from os.path import join, exists, basename
import logging
import time
import json
import boto3
import os
import pymongo

from water_rights_visualizer import water_rights_visualizer
from water_rights_visualizer.S3_source import S3Source
from water_rights_visualizer.file_path_source import FilepathSource
import cl

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

input_bucket_name = os.environ.get("S3_INPUT_BUCKET", "ose-dev-inputs")
output_bucket_name = os.environ.get("S3_OUTPUT_BUCKET", "ose-dev-outputs")
aws_profile = os.environ.get("AWS_PROFILE", None)
if not aws_profile:
    # Make sure empty string is treated as None
    aws_profile = None

delete_temp_files = True


def build_mongo_client_and_collection():
    # todo: read from ENV vars and then use defaults if not available
    user = os.environ.get("MONGO_INITDB_ROOT_USERNAME", "")
    cred = os.environ.get("MONGO_INITDB_ROOT_PASSWORD", "")
    host = os.environ.get("MONGO_HOST", "water-rights-visualizer-mongo")
    # host = os.environ.get("MONGO_HOST", "localhost")
    port = os.environ.get("MONGO_PORT", 27017)
    if isinstance(port, str) and port.isdigit():
        port = int(port)

    database = os.environ.get("MONGO_DATABASE", "water")
    collection = os.environ.get("MONGO_COLLECTION", "report_queue")

    mongo_str = "mongodb://{}:{}@{}:{}".format(user, cred, host, port)

    client = pymongo.MongoClient(host=host, username=user, password=cred, port=port, directConnection=True)

    db = client[database]
    collect = db[collection]

    return collect


def write_status(status_filename: str, message: str):
    logger.info(message)

    with open(status_filename, "w") as file:
        file.write(message)


def main(argv=sys.argv):
    logger.info("running operational backend")
    config_filename = argv[1]
    logger.info(f"config file: {config_filename}")

    with open(config_filename, "r") as file:
        config = json.load(file)

    key = config["key"]
    logger.info(f"key: {key}")

    name = config["name"]
    logger.info(f"name: {name}")

    start_year = int(config["start_year"])
    logger.info(f"start year: {start_year}")

    end_year = int(config["end_year"])
    logger.info(f"end year: {end_year}")

    working_directory = config["working_directory"]
    logger.info(f"working directory: {working_directory}")

    geojson_filename = config["geojson_filename"]
    logger.info(f"GeoJSON file: {geojson_filename}")

    status_filename = config["status_filename"]
    logger.info(f"status file: {status_filename}")

    temporary_directory = join(working_directory, "temp")
    output_directory = join(working_directory, "output")

    # FIXME assign figure directory and monthly means directory to directories outside of the temporary run directory
    figure_directory = None
    monthly_means_directory = None

    input_datastore = S3Source(
        bucket_name=input_bucket_name,
        temporary_directory=temporary_directory,
        remove_temporary_files=delete_temp_files,
        aws_profile=aws_profile,
        region_name="us-west-2",
    )

    session = boto3.Session()
    s3 = session.resource("s3")
    output_bucket = s3.Bucket(output_bucket_name)

    start_year = int(start_year)
    end_year = int(end_year)
    years = range(start_year, end_year + 1)

    start_time = time.time()

    report_queue = build_mongo_client_and_collection()
    record = report_queue.find_one({"key": key})
    if record is not None and record["status"] == "Pending" and record["paused_year"]:
        start_year = record["paused_year"]
        write_status(status_filename, f"resuming {name} from {start_year}")

    for year in years:
        # Check if the job is paused, if so stop the job
        record = report_queue.find_one({"key": key})
        if record is not None and record["status"] == "Paused":
            write_status(status_filename, f"job paused for {name} at {year}")
            # Update record to say we paused at this year and clear pid
            report_queue.update_one({"key": key}, {"$set": {"status": "Paused", "paused_year": year, "pid": None}})
            return
        elif record is not None:
            report_queue.update_one({"key": key}, {"$set": {"last_generated_year": year}})

        write_status(status_filename, f"processing {name} for {year}")

        water_rights_visualizer(
            boundary_filename=geojson_filename,
            input_datastore=input_datastore,
            output_directory=output_directory,
            figure_directory=figure_directory,
            monthly_means_directory=monthly_means_directory,
            start_year=year,
            end_year=year,
            requestor=record.get("user", {"sub": "", "name": "", "email": ""}),
        )

        # check and upload the png file to s3
        figure_output_filename = join(output_directory, "figures", name, f"{year}_{name}.png")

        if not exists(figure_output_filename):
            write_status(status_filename, f"problem producing figure for {figure_output_filename} for {year}")
            continue

        #        figure_output_s3_name = key + "/" + basename(figure_output_filename)
        #        output_bucket.upload_file(figure_output_filename, figure_output_s3_name)

        # check and uplaod the csv file to s3
        CSV_output_filename = join(output_directory, "monthly_means", name, f"{year}_monthly_means.csv")

        if not exists(CSV_output_filename):
            write_status(status_filename, f"problem producing CSV for {CSV_output_filename} for {year}")
            continue

    #        CSV_output_s3_name = key + "/" + basename(CSV_output_filename)
    #        output_bucket.upload_file(CSV_output_filename, CSV_output_s3_name)

    # todo:
    # pull out csv file that corresponds to png and store somewhere on disk it will not get deleted
    # maybe something like /data/saved_runs/ ?
    # png found in: /home/ec2-user/data/water_rights_runs/Smith/output/figures
    # csv found in: /home/ec2-user/data/water_rights_runs/Smith/output/monthly_means

    write_status(status_filename, f"completed {name} from {start_year} to {end_year}")

    end_time = time.time()
    total_mins = (end_time - start_time) / 60
    logger.info(f"Total Run Time: {total_mins} minutes\n\n")


if __name__ == "__main__":
    sys.exit(main(argv=sys.argv))
