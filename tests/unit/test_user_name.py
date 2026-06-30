import json
import subprocess
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def run_user_name_helper(function_name: str, email: str):
    script = """
const userName = require(process.argv[1]);
console.log(JSON.stringify(userName[process.argv[2]](process.argv[3])));
"""
    result = subprocess.run(
        ["node", "-e", script, str(PROJECT_ROOT / "server/utils/userName.js"), function_name, email],
        capture_output=True,
        text=True,
        check=True,
        cwd=PROJECT_ROOT,
    )
    output = result.stdout.strip()
    return None if output == "null" else json.loads(output)


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("john.doe@state.nm.us", {"firstName": "John", "lastName": "Doe"}),
        ("mary.jane.smith@nm.gov", {"firstName": "Mary", "lastName": "Jane Smith"}),
        ("invalid@example.com", None),
        ("nodot@example.com", None),
    ],
)
def test_parse_name_from_email(email, expected):
    assert run_user_name_helper("parseNameFromEmail", email) == expected


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("john.doe@state.nm.us", {"firstName": "John", "lastName": "Doe"}),
        ("ryanastonebraker@gmail.com", {"firstName": "Ryanastonebraker", "lastName": ""}),
        ("invalid@example.com", {"firstName": "Invalid", "lastName": ""}),
    ],
)
def test_parse_default_name_from_email(email, expected):
    assert run_user_name_helper("parseDefaultNameFromEmail", email) == expected
