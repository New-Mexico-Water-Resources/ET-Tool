import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

TERMINAL_STATUSES = {"Complete", "Failed"}
USER_PREFERENCES_COLLECTION = "user_preferences"
APP_SETTINGS_COLLECTION = "app_settings"
GLOBAL_SETTINGS_ID = "global"


def build_mongo_collection(collection_name):
    import pymongo

    user = os.environ.get("MONGO_INITDB_ROOT_USERNAME", "")
    cred = os.environ.get("MONGO_INITDB_ROOT_PASSWORD", "")
    host = os.environ.get("MONGO_HOST", "water-rights-visualizer-mongo")
    port = os.environ.get("MONGO_PORT", 27017)
    if isinstance(port, str) and port.isdigit():
        port = int(port)

    database = os.environ.get("MONGO_DATABASE", "water")
    client = pymongo.MongoClient(host=host, username=user, password=cred, port=port, directConnection=True)
    return client[database][collection_name]


def build_user_preferences_collection():
    return build_mongo_collection(USER_PREFERENCES_COLLECTION)


def admin_job_notifications_enabled(logger=print) -> bool:
    try:
        collection = build_mongo_collection(APP_SETTINGS_COLLECTION)
        document = collection.find_one({"_id": GLOBAL_SETTINGS_ID})
        if document is None:
            return False
        return bool(document.get("job_notifications_enabled", False))
    except Exception as error:
        logger(f"Failed to read admin job notification setting: {error}")
        return False


def notifications_enabled(logger=print) -> bool:
    if os.environ.get("JOB_NOTIFICATIONS_ENABLED", "").lower() != "true":
        return False
    return admin_job_notifications_enabled(logger=logger)


def user_wants_job_completion_emails(sub: str | None, logger=print) -> bool:
    if not sub:
        return True

    try:
        collection = build_user_preferences_collection()
        preference = collection.find_one({"sub": sub})
        if preference is None:
            return True
        return bool(preference.get("job_completion_emails", True))
    except Exception as error:
        logger(f"Failed to read notification preference for {sub}: {error}")
        return False


def get_app_base_url() -> str:
    return os.environ.get("AUTH0_BASE_URL", "https://ettool.ose.nm.gov").rstrip("/")


def get_recipient_email(record: dict[str, Any]) -> str | None:
    user = record.get("user") or {}
    email = user.get("email")
    if not email or not isinstance(email, str):
        return None
    email = email.strip()
    return email or None


def build_email_subject(record: dict[str, Any], status: str) -> str:
    job_name = record.get("name", "Untitled Job")
    if status == "Complete":
        return f'ET Tool: Your report "{job_name}" is ready'
    return f'ET Tool: Your report "{job_name}" failed'


def build_email_body(record: dict[str, Any], status: str) -> tuple[str, str]:
    user = record.get("user") or {}
    recipient_name = user.get("name") or user.get("nickname") or "there"
    job_name = record.get("name", "Untitled Job")
    start_year = record.get("start_year")
    end_year = record.get("end_year")
    status_msg = record.get("status_msg")
    app_url = get_app_base_url()

    if status == "Complete":
        status_line = "Your ET report has finished processing and is ready to view and download."
    else:
        status_line = "Your ET report job finished with an error."

    text_lines = [
        f"Hello {recipient_name},",
        "",
        status_line,
        "",
        f"Job name: {job_name}",
        f"Years: {start_year} to {end_year}",
        f"Status: {status}",
    ]

    if status_msg:
        text_lines.append(f"Details: {status_msg}")

    if app_url:
        text_lines.extend(["", f"Open the ET Tool: {app_url}"])

    text_lines.extend(["", "This is an automated message from the New Mexico ET Reporting Tool."])
    text_body = "\n".join(text_lines)

    status_color = "#1a9641" if status == "Complete" else "#d7191c"
    html_status = "ready to view and download" if status == "Complete" else "finished with an error"
    html_lines = [
        f"<p>Hello {recipient_name},</p>",
        f"<p>Your ET report has {html_status}.</p>",
        "<ul>",
        f"<li><strong>Job name:</strong> {job_name}</li>",
        f"<li><strong>Years:</strong> {start_year} to {end_year}</li>",
        f'<li><strong>Status:</strong> <span style="color:{status_color};">{status}</span></li>',
    ]
    if status_msg:
        html_lines.append(f"<li><strong>Details:</strong> {status_msg}</li>")
    html_lines.append("</ul>")

    if app_url:
        html_lines.append(f'<p><a href="{app_url}">Open the ET Tool</a></p>')

    html_lines.append("<p><em>This is an automated message from the New Mexico ET Reporting Tool.</em></p>")
    html_body = "\n".join(html_lines)

    return text_body, html_body


def send_job_completion_notification(record: dict[str, Any], status: str, logger=print) -> bool:
    if not notifications_enabled(logger=logger):
        return False

    if status not in TERMINAL_STATUSES:
        return False

    if record.get("notification_sent_at"):
        return False

    recipient = get_recipient_email(record)
    if not recipient:
        logger(f"Skipping job notification for {record.get('key', 'unknown')}: no recipient email")
        return False

    user = record.get("user") or {}
    if not user_wants_job_completion_emails(user.get("sub"), logger=logger):
        logger(f"Skipping job notification for {record.get('key', 'unknown')}: user opted out")
        return False

    from_email = os.environ.get("SES_FROM_EMAIL", "").strip()
    if not from_email:
        logger(f"Skipping job notification for {record.get('key', 'unknown')}: SES_FROM_EMAIL is not set")
        return False

    region = os.environ.get("SES_REGION", "us-west-2")
    subject = build_email_subject(record, status)
    text_body, html_body = build_email_body(record, status)

    ses = boto3.client("ses", region_name=region)
    try:
        ses.send_email(
            Source=from_email,
            Destination={"ToAddresses": [recipient]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                    "Html": {"Data": html_body, "Charset": "UTF-8"},
                },
            },
        )
    except ClientError as error:
        logger(
            f"Failed to send job notification for {record.get('key', 'unknown')} to {recipient}: "
            f"{error.response.get('Error', {}).get('Message', error)}"
        )
        return False

    logger(f"Sent job notification for {record.get('key', 'unknown')} to {recipient}")
    return True
