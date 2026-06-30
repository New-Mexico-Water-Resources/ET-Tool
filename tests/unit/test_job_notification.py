from unittest.mock import MagicMock, patch

from water_rights_visualizer.job_notification import (
    build_email_body,
    build_email_subject,
    get_recipient_email,
    send_job_completion_notification,
    user_wants_job_completion_emails,
)


def sample_record():
    return {
        "key": "test_job_2020_2024_123",
        "name": "Test Farm",
        "start_year": 2020,
        "end_year": 2024,
        "status_msg": "Success",
        "user": {
            "sub": "auth0|123",
            "name": "Jane Doe",
            "email": "jane@example.com",
        },
    }


def test_get_recipient_email_returns_user_email():
    assert get_recipient_email(sample_record()) == "jane@example.com"


def test_build_email_subject_complete():
    assert build_email_subject(sample_record(), "Complete") == 'ET Tool: Your report "Test Farm" is ready'


def test_build_email_subject_failed():
    assert build_email_subject(sample_record(), "Failed") == 'ET Tool: Your report "Test Farm" failed'


def test_build_email_body_includes_job_details(monkeypatch):
    monkeypatch.setenv("AUTH0_BASE_URL", "https://ettool.ose.nm.gov")
    text_body, html_body = build_email_body(sample_record(), "Complete")

    assert "Test Farm" in text_body
    assert "2020 to 2024" in text_body
    assert "https://ettool.ose.nm.gov" in text_body
    assert "Test Farm" in html_body


@patch("water_rights_visualizer.job_notification.admin_job_notifications_enabled", return_value=True)
@patch("water_rights_visualizer.job_notification.user_wants_job_completion_emails", return_value=True)
@patch("water_rights_visualizer.job_notification.boto3.client")
def test_send_job_completion_notification_sends_email(mock_boto_client, _mock_user_pref, _mock_admin_flag, monkeypatch):
    monkeypatch.setenv("JOB_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("SES_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setenv("SES_REGION", "us-west-2")

    mock_ses = MagicMock()
    mock_boto_client.return_value = mock_ses

    record = sample_record()
    sent = send_job_completion_notification(record, "Complete", logger=lambda *_args, **_kwargs: None)

    assert sent is True
    mock_boto_client.assert_called_once_with("ses", region_name="us-west-2")
    mock_ses.send_email.assert_called_once()
    kwargs = mock_ses.send_email.call_args.kwargs
    assert kwargs["Source"] == "noreply@example.com"
    assert kwargs["Destination"] == {"ToAddresses": ["jane@example.com"]}
    assert kwargs["Message"]["Subject"]["Data"] == 'ET Tool: Your report "Test Farm" is ready'


def test_send_job_completion_notification_skips_when_disabled(monkeypatch):
    monkeypatch.delenv("JOB_NOTIFICATIONS_ENABLED", raising=False)
    sent = send_job_completion_notification(sample_record(), "Complete", logger=lambda *_args, **_kwargs: None)
    assert sent is False


@patch("water_rights_visualizer.job_notification.admin_job_notifications_enabled", return_value=True)
@patch("water_rights_visualizer.job_notification.user_wants_job_completion_emails", return_value=False)
@patch("water_rights_visualizer.job_notification.boto3.client")
def test_send_job_completion_notification_skips_when_user_opted_out(
    mock_boto_client, _mock_user_pref, _mock_admin_flag, monkeypatch
):
    monkeypatch.setenv("JOB_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("SES_FROM_EMAIL", "noreply@example.com")

    sent = send_job_completion_notification(sample_record(), "Complete", logger=lambda *_args, **_kwargs: None)

    assert sent is False
    mock_boto_client.assert_not_called()


@patch("water_rights_visualizer.job_notification.admin_job_notifications_enabled", return_value=True)
@patch("water_rights_visualizer.job_notification.boto3.client")
def test_send_job_completion_notification_skips_duplicate(mock_boto_client, _mock_admin_flag, monkeypatch):
    monkeypatch.setenv("JOB_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("SES_FROM_EMAIL", "noreply@example.com")

    record = sample_record()
    record["notification_sent_at"] = 123456789

    sent = send_job_completion_notification(record, "Complete", logger=lambda *_args, **_kwargs: None)

    assert sent is False
    mock_boto_client.assert_not_called()
