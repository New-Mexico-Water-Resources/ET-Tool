###############################################################################
# This script fires off once a minute to read the report_queue.json file and
# invokes some OS calls to run the water-rights-visualizer-backend scripts
# Logs for this script are written to /tmp/wrq_log.txt via the dlog() function
###############################################################################

import subprocess
import time
import os
import sys
import argparse
import json
import subprocess
import pymongo
import psutil

from datetime import datetime


class TERM_COLORS:
    NOTIFICATION = "\033[94m"
    SUCCESS = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    END = "\033[0m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"


DEFAULT_QUEUE = "/root/data/water_rights_runs/report_queue.json"

# some things we need this script or some other cleanup/maintenance script to do
# -reset In Progress to Pending in case things get hung
# -clear out "Failed" runs
# -clear out json file completely
# -move successful runs into a "completed_runs.json"
# -rotate cron log in /tmp/cron_log.txt
# -write output from exec_report into a logfile?
#     -rotate contents of logfile when it gets too big
#     -maybe just do a tail -5000 on the log file after every run to keep it trimmed?
# -decide "official" status(e.g. Complete, Failed, Pending, etc) and turn those into ENUMs in the code


class WaterReportException(Exception):
    manually_killed = False

    def __init__(self, message, manually_killed=False):
        super().__init__(message)
        self.manually_killed = manually_killed

    pass


PRINT_LOG = False


# writes to the daemon log file
# todo: check logsize and tail -1000 if it is too long
def dlog(text, new_line=True, notification=False, success=False, warning=False, fail=False, bold=False, underline=False):
    global PRINT_LOG
    log_path = "/tmp/wrq_log.txt"

    color_start = ""
    color_end = ""
    if notification:
        color_start = TERM_COLORS.NOTIFICATION
        color_end = TERM_COLORS.END
    elif success:
        color_start = TERM_COLORS.SUCCESS
        color_end = TERM_COLORS.END
    elif warning:
        color_start = TERM_COLORS.WARNING
        color_end = TERM_COLORS.END
    elif fail:
        color_start = TERM_COLORS.FAIL
        color_end = TERM_COLORS.END

    if bold:
        color_start += TERM_COLORS.BOLD
        color_end += TERM_COLORS.END
    if underline:
        color_start += TERM_COLORS.UNDERLINE
        color_end += TERM_COLORS.END

    now = datetime.now()
    text = TERM_COLORS.BOLD + str(now) + ": " + TERM_COLORS.END + color_start + text + color_end

    with open(log_path, "a+") as log_file:
        log_file.write(text)

        if new_line:
            log_file.write("\n")

    if PRINT_LOG:
        print(text)


def build_mongo_client_and_collection():
    user = os.environ.get("MONGO_INITDB_ROOT_USERNAME", "")
    cred = os.environ.get("MONGO_INITDB_ROOT_PASSWORD", "")
    host = os.environ.get("MONGO_HOST", "water-rights-visualizer-mongo")
    port = os.environ.get("MONGO_PORT", 27017)
    if isinstance(port, str) and port.isdigit():
        port = int(port)

    database = os.environ.get("MONGO_DATABASE", "water")
    collection = os.environ.get("MONGO_COLLECTION", "report_queue")

    client = pymongo.MongoClient(host=host, username=user, password=cred, port=port, directConnection=True)

    db = client[database]
    collect = db[collection]

    return collect


# does a system call to tail -1000 to make sure files do not grow too large
def tail_cleanup(filepath):
    cmd = ["/usr/bin/tail", "-1000", filepath]
    pipe = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    res = pipe.communicate()

    if res:
        stdout = res[0].decode(encoding="utf-8")
        err = res[1].decode(encoding="utf-8")

        with open(filepath, "w") as file:
            file.write(stdout)


def cleanup_files():
    dlog("Cleaning up log files...", notification=True)
    log_files = ["/tmp/wrq_log.txt", "/tmp/cron_log.txt"]

    for lf in log_files:
        tail_cleanup(lf)


def exec_report(record):
    cmd_parameters = record["cmd"].split(" ")
    cmd = []
    if len(cmd_parameters) <= 3:
        cmd = cmd_parameters
    else:
        # Allow for spaces in the command parameters
        cmd = [cmd_parameters[0], cmd_parameters[1], f"{' '.join(cmd_parameters[2:])}"]

    dlog(f"invoking cmd: {cmd}", success=True)

    log_path = "{}/exec_report_log.txt".format(record["base_dir"])
    dlog(f"Writing exec output to logfile: {log_path}", notification=True)
    last_checked_status = None
    with open(log_path, "w") as log_file:
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

        # update the record with the pid we just launched
        record["pid"] = process.pid
        write_record(record)

        dlog(f"Process {process.pid} CMD RUN LOGS:\n", notification=True)

        for line in process.stdout:
            log_file.write(line)
            log_file.flush()

            if PRINT_LOG:
                sys.stdout.write(line)
                sys.stdout.flush()
            if not last_checked_status or time.time() - last_checked_status > 5:
                last_checked_status = time.time()

                # Check if this record has been killed
                db = build_mongo_client_and_collection()
                stored_record = db.find_one({"key": record["key"]})
                if stored_record and stored_record.get("status") == "Killed":
                    dlog(f"Killing record {record['key']} requested...", fail=True)
                    process.kill()
                    process.wait()

                    # Delete the record
                    db.delete_one({"key": record["key"]})
                    raise WaterReportException(f"Error: Record {record['key']} has been killed.", manually_killed=True)
                elif stored_record and stored_record.get("status") == "Paused":
                    dlog(f"Pausing record {record['key']}...", warning=True)
                    process.kill()
                    process.wait()
                    return "Paused"

        retcode = process.wait()

        if retcode != 0:
            dlog(f"Found non-zero return code {retcode} from {cmd}", fail=True)
            raise WaterReportException(f"Error: Return code from visualizer backend {retcode}")

        # think we might be able to read stdout here isntead of opening the logfile for the output below
        # do not have time to test this right now though so leaving it alone
        # stdout = res[0].decode(encoding='utf-8')
        # stderr = res[1].decode(encoding='utf-8')

    # todo: figure out how to read the log as it is streaming above
    # currenlty each 'c' in the loop is a char so it is just one letter making it
    # a bit hard to parse for error messages
    # check the output of the logfile for errors
    with open(log_path, "r") as log_file:
        errors = ""
        figure_err_check = "problem producing figure for"
        csv_err_check = "problem producing CSV for"
        log_body = log_file.read()

        dlog("Checking log file for errors...", notification=True)
        if figure_err_check in log_body:
            errors += "Error producing figure png file.\n"

        if csv_err_check in log_body:
            errors += "Error producing csv file.\n"

        if errors:
            raise WaterReportException(f"Error processing file: {errors}")

    # todo: run tail_cleanup() on the log files after we have run this tool in prod for awhile
    # and we are sure the err checks above catch all the problems

    # Check the record in mongo
    report_queue = build_mongo_client_and_collection()
    db_record = report_queue.find_one({"key": record["key"]})

    status = "Success" if db_record and db_record["status"] != "Paused" else "Paused"
    return status


def update_status(record, state):
    now = int(time.time() * 1000)  # convert to milliseconds to match javascript epoch

    record["status"] = state

    if state == "In Progress" and not record.get("paused_year", ""):
        record["started"] = now
    elif state == "Complete":
        record["ended"] = now
    # might have to do special stuff like retry later so put in seperate elif
    elif state == "Failed":
        record["ended"] = now


# finds the next Pending item in the queue to process
def find_pending_record():
    report_queue = build_mongo_client_and_collection()  # should build the client each time in case it times out
    record = report_queue.find_one({"status": "Pending"}, sort=[("submitted", pymongo.ASCENDING)])

    # data['_id'] = str(data['_id']) #this will blow up json.dumps if we do not cast to string
    if record:
        del record["_id"]  # this will blow up json.dumps
        # dlog("Found Pending record: {}".format(json.dumps(record, indent=4)))

    return record


def find_stalled_record():
    report_queue = build_mongo_client_and_collection()
    record = report_queue.find_one({"status": "In Progress"}, sort=[("submitted", pymongo.ASCENDING)])

    if not record:
        return None

    # Check if the record has been running for more than a minute
    now = int(time.time() * 1000)
    start_time = record.get("started", None)

    if start_time and now - start_time < 60000:
        return None

    # Search for PID
    pid = record.get("pid", None)
    if pid and psutil.pid_exists(pid) and pid != os.getpid():
        return None

    dlog(f"Record {record['key']} has stalled. Restarting...", warning=True)
    record["pid"] = None

    return record


def clean_up_killed_records(change=None):
    report_queue = build_mongo_client_and_collection()
    current_pid = os.getpid()
    records = report_queue.find({"status": "Killed"})
    killed_records = [record for record in records]

    if change and change.get("fullDocument", {}).get("status") and change["fullDocument"]["status"] == "Killed":
        found_changed_record = False
        for i, record in enumerate(killed_records):
            if record["key"] == change["fullDocument"]["key"]:
                found_changed_record = True
                killed_records[i] = change["fullDocument"]
                break

        if not found_changed_record:
            killed_records.append(change["fullDocument"])

    if len(killed_records) > 0:
        dlog(f"Cleaning up {len(killed_records)} killed records...", notification=True)
    for record in killed_records:
        dlog(f"Checking killed record: {record['key']}", notification=True)
        record_pid = record.get("pid", None)
        cmd = record.get("cmd", None)
        record_key = record.get("key", None)
        # We need to check if the record has a PID and ensure it's the correct PID
        if record_pid and record_pid != current_pid:
            if psutil.pid_exists(record_pid):
                running_process = psutil.Process(record_pid)
                dlog(f"Killing process {record['pid']} for record: {record_key}", success=True)
                # Now remove the record
                report_queue.delete_one({"key": record["key"]})
                running_process.terminate()
                running_process.wait(timeout=5)
            else:
                dlog(f"Process {record['pid']} for record: {record_key} not found. Removing record.", warning=True)
                report_queue.delete_one({"key": record["key"]})
        elif cmd:
            # No PID found for record, attempt to search for it
            found = False
            for proc in psutil.process_iter(attrs=["pid", "cmdline"]):
                try:
                    proc_cmd = " ".join(proc.info["cmdline"])
                    if cmd in proc_cmd:
                        dlog(f"Record cmd ({proc.info['cmdline']}) matched running cmd: {proc_cmd}", notification=True)
                        dlog(f"Killing process {proc.info['pid']} for record: {record_key}", success=True)
                        proc.terminate()
                        proc.wait(timeout=5)  # Gracefully wait for termination
                        found = True
                        break
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            if not found:
                dlog(f"No PID found for record: {record_key}. Deleting entry...", warning=True)

            report_queue.delete_one({"key": record["key"]})
        else:
            dlog(f"Record {record_key} has no PID or CMD. Removing record...", warning=True)
            report_queue.delete_one({"key": record["key"]})

    return records


def write_record(record):
    key = record["key"]
    dlog(f"Updating record: {key}", notification=True)

    db_filter = {"key": key}
    report_queue = build_mongo_client_and_collection()
    report_queue.replace_one(db_filter, record, upsert=True)


def process_report(record):
    try:
        status_msg = exec_report(record)
        if status_msg == "Paused":
            return

        dlog(f"Status of invocation: {status_msg}", notification=True)
        record["status_msg"] = status_msg

        status = None

        # todo: update status based on parse status_msg
        if status_msg == "Success":
            status = "Complete"
        else:
            status = "Failed"

        # update the queue file again with the final status
        update_status(record, status)
        write_record(record)
    except Exception as e:
        if isinstance(e, WaterReportException) and e.manually_killed:
            dlog(f"Record {record['key']} has been killed. Skipping update...", fail=True)
            return
        status_msg = str(e)
        dlog(f"Failed to process {record}\n\nCaused by: {status_msg}", fail=True)
        record["status_msg"] = status_msg
        update_status(record, "Failed")
        write_record(record)


# scan the report queue for any files that are "Pending"
def check_report_queue(change=None):
    clean_up_killed_records(change)

    record = find_pending_record()
    if not record:
        record = find_stalled_record()
        if not record:
            dlog("No reports to process...", notification=True)
            return

    dlog(f">>> Found Pending item {record['key']}", success=True, bold=True)
    # update the queue file right away so we see the "In Progress"
    update_status(record, "In Progress")
    write_record(record)

    process_report(record)


def monitor_queue():
    check_report_queue()

    # Set up a change stream to monitor the collection
    report_queue = build_mongo_client_and_collection()
    with report_queue.watch() as change_stream:
        dlog("Listening for changes...", notification=True)
        for change in change_stream:
            if change["operationType"] in {"insert", "update"}:
                dlog(f"Change detected: {change}", notification=True)
                check_report_queue(change)
                time.sleep(5)
                cleanup_files()


def main():
    global DEFAULT_QUEUE

    try:
        monitor_queue()
    except KeyboardInterrupt:
        dlog("Stopping water_report_queue.py monitoring...", notification=True)


if __name__ == "__main__":
    # Check for args -v or --verbose to print log to stdout
    if "-v" in sys.argv or "--verbose" in sys.argv:
        PRINT_LOG = True

    now = datetime.now()

    pid = str(os.getpid())
    pidfile = "/tmp/water_report_queue.pid"

    if os.path.isfile(pidfile):
        with open(pidfile, "r") as pid_data:
            existing_pid = pid_data.read()
            existing_pid = f"{existing_pid.strip()}"
            existing_pid = int(existing_pid)

            if psutil.pid_exists(existing_pid):
                dlog(f"{pidfile} already exists (PID: {existing_pid}), exiting...", notification=True)
                sys.exit()

    with open(pidfile, "w") as f:
        dlog(f"Writing pid file with value {pid}", notification=True)
        f.seek(0)
        f.write(pid)
        f.truncate()

    try:
        dlog("Starting up water_report_queue.py", notification=True)
        main()
    finally:
        if os.path.isfile(pidfile):
            dlog("Removing pid file...", notification=True)
            os.unlink(pidfile)
