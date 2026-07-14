from unittest.mock import Mock, call

import pytest

from api.services.gradescope.client import (
    GRADESCOPE_LOGIN_URL,
    GRADESCOPE_ROOT,
    GradescopeClient,
)


LOGIN_HTML = b"""
<html><body><form action="/login">
  <input name="authenticity_token" value="csrf-token">
</form></body></html>
"""


def response(status_code, *, content=b"", headers=None):
    result = Mock()
    result.status_code = status_code
    result.content = content
    result.headers = headers or {}
    result.ok = status_code < 400
    return result


def client_without_timer():
    client = GradescopeClient()
    client.session = Mock()
    client.reset_inactivity_timer = Mock()
    return client


def test_login_posts_to_canonical_www_url_and_verifies_session():
    client = client_without_timer()
    client.session.get.side_effect = [
        response(200, content=LOGIN_HTML),
        response(401),
    ]
    client.session.post.return_value = response(
        302,
        headers={"Location": "/account"},
    )

    assert client.log_in("staff@example.edu", "correct-password") is True
    assert client.logged_in is True
    client.session.post.assert_called_once_with(
        GRADESCOPE_LOGIN_URL,
        data={
            "utf8": "✓",
            "authenticity_token": "csrf-token",
            "session[email]": "staff@example.edu",
            "session[password]": "correct-password",
            "session[remember_me]": 1,
            "commit": "Log In",
            "session[remember_me_sso]": 0,
        },
        headers={
            "Origin": GRADESCOPE_ROOT,
            "Referer": GRADESCOPE_LOGIN_URL,
        },
        timeout=client.request_timeout,
        allow_redirects=False,
    )
    assert client.session.get.call_args_list == [
        call(GRADESCOPE_LOGIN_URL, timeout=client.request_timeout),
        call(
            GRADESCOPE_LOGIN_URL,
            timeout=client.request_timeout,
            allow_redirects=False,
        ),
    ]
    client.reset_inactivity_timer.assert_called_once_with()


def test_login_rejects_unauthenticated_session_after_post():
    client = client_without_timer()
    client.session.get.side_effect = [
        response(200, content=LOGIN_HTML),
        response(200, content=LOGIN_HTML),
    ]
    client.session.post.return_value = response(200)

    with pytest.raises(RuntimeError, match=r"Failed to login to Gradescope \(HTTP 200\)"):
        client.log_in("staff@example.edu", "wrong-password")

    assert client.logged_in is False
    client.reset_inactivity_timer.assert_not_called()


def test_login_reuses_an_authenticated_session_without_posting_credentials():
    client = client_without_timer()
    client.logged_in = True
    client.session.get.return_value = response(401)

    assert client.log_in("staff@example.edu", "unused-password") is True

    client.session.post.assert_not_called()
    client.reset_inactivity_timer.assert_called_once_with()


def test_download_gradebook_uses_course_wide_csv_endpoint():
    client = client_without_timer()
    client.logged_in = True
    client.session.get.return_value = response(200, content=b'Name,SID,Email\n')

    result = client.download_gradebook('1329547')

    assert result == b'Name,SID,Email\n'
    client.session.get.assert_called_once_with(
        f'{GRADESCOPE_ROOT}/courses/1329547/gradebook.csv',
        timeout=client.request_timeout,
    )
