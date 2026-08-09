from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
from contextlib import ExitStack
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from mempalace_dashboard import server


class SecurityTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        home = Path(self._tmp.name)
        self._patches = ExitStack()
        self.addCleanup(self._patches.close)
        self._patches.enter_context(mock.patch.object(server, "MEMPALACE_HOME", home))
        self._patches.enter_context(mock.patch.object(server, "CREDENTIALS_FILE", home / "credentials.json"))
        self._patches.enter_context(mock.patch.object(server, "SESSIONS_FILE", home / "sessions.json"))
        self._patches.enter_context(mock.patch.object(server, "PREFERENCES_FILE", home / "preferences.json"))
        self._patches.enter_context(mock.patch.object(server, "AUTH_TOKEN", ""))
        self._patches.enter_context(mock.patch.object(server, "SETUP_TOKEN", "setup-secret"))
        self._patches.enter_context(mock.patch.object(server, "COOKIE_SECURE", False))
        self._patches.enter_context(mock.patch.object(server, "SYNC_ROOTS", ()))
        server._LOGIN_FAILURES.clear()

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict | str | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict, dict[str, str]]:
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        httpd.bind_host = "127.0.0.1"
        httpd.allowed_hosts = server.allowed_hosts_for_bind("127.0.0.1")
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        conn = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=5)
        request_headers = dict(headers or {})
        if isinstance(body, dict):
            raw_body = json.dumps(body)
            request_headers.setdefault("Content-Type", "application/json")
        else:
            raw_body = body
        conn.request(method, path, body=raw_body, headers=request_headers)
        response = conn.getresponse()
        raw = response.read().decode("utf-8")
        response_headers = {key.lower(): value for key, value in response.getheaders()}
        conn.close()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return response.status, payload, response_headers

    def _write_credentials(self, *, valid: bool = True) -> None:
        server.CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
        if valid:
            server.save_credentials("owner", server.hash_password("correct horse"))
        else:
            server.CREDENTIALS_FILE.write_text("{broken", encoding="utf-8")

    def test_default_bind_is_loopback(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEMPALACE_HOST", None)
            self.assertEqual(server.resolve_bind_host(None), "127.0.0.1")

    def test_non_loopback_bind_requires_auth(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "credentials or MEMPALACE_TOKEN"):
            server.validate_startup_security("0.0.0.0")

    def test_non_loopback_bind_allows_explicit_auth(self) -> None:
        with mock.patch.object(server, "AUTH_TOKEN", "secret-token"):
            server.validate_startup_security("0.0.0.0")
        self._write_credentials()
        server.validate_startup_security("0.0.0.0")

    def test_malformed_credentials_refuse_startup_without_token(self) -> None:
        self._write_credentials(valid=False)
        with self.assertRaisesRegex(RuntimeError, "unreadable or malformed"):
            server.validate_startup_security("127.0.0.1")

    def test_fresh_install_api_fails_closed(self) -> None:
        status, payload, _ = self._request("GET", "/api/export")
        self.assertEqual(status, 401)
        self.assertIn("Authentication required", payload["error"])

    def test_token_is_required_even_without_credentials(self) -> None:
        with mock.patch.object(server, "AUTH_TOKEN", "secret-token"):
            status, _, _ = self._request("GET", "/api/settings")
            self.assertEqual(status, 401)
            status, _, _ = self._request(
                "GET", "/api/settings", headers={"X-Auth-Token": "wrong"}
            )
            self.assertEqual(status, 401)
            status, payload, _ = self._request(
                "GET", "/api/settings", headers={"X-Auth-Token": "secret-token"}
            )
            self.assertEqual(status, 200)
            self.assertFalse(payload["credentials_configured"])

    def test_malformed_credentials_never_enable_setup_or_api_access(self) -> None:
        self._write_credentials(valid=False)
        status, payload, _ = self._request("GET", "/api/session")
        self.assertEqual(status, 200)
        self.assertEqual(payload["credential_state"], "invalid")
        self.assertFalse(payload["setup_required"])
        status, _, _ = self._request("GET", "/api/export")
        self.assertEqual(status, 401)

    def test_host_header_blocks_dns_rebinding(self) -> None:
        status, payload, _ = self._request(
            "GET", "/api/session", headers={"Host": "attacker.example"}
        )
        self.assertEqual(status, 421)
        self.assertIn("Host", payload["error"])

    def test_cross_site_origin_is_rejected(self) -> None:
        status, payload, _ = self._request(
            "POST",
            "/api/login",
            body={"username": "owner", "password": "wrong"},
            headers={"Origin": "https://attacker.example"},
        )
        self.assertEqual(status, 403)
        self.assertIn("origin", payload["error"].lower())

    def test_text_plain_json_is_rejected(self) -> None:
        status, payload, _ = self._request(
            "POST",
            "/api/login",
            body='{"username":"owner","password":"wrong"}',
            headers={"Content-Type": "text/plain"},
        )
        self.assertEqual(status, 415)
        self.assertIn("application/json", payload["error"])

    def test_cookie_mutation_requires_csrf_token(self) -> None:
        self._write_credentials()
        sid, _, csrf = server.create_session("owner", remember=False)
        cookie = {"Cookie": f"{server.SESSION_COOKIE}={sid}"}
        status, _, _ = self._request("POST", "/api/preferences", body={}, headers=cookie)
        self.assertEqual(status, 403)
        status, payload, _ = self._request(
            "POST",
            "/api/preferences",
            body={},
            headers={**cookie, "X-CSRF-Token": csrf},
        )
        self.assertEqual(status, 200)
        self.assertIn("preferences", payload)

    def test_initial_account_claim_requires_setup_secret(self) -> None:
        body = {"username": "owner", "password": "correct horse"}
        status, _, _ = self._request("POST", "/api/settings/credentials", body=body)
        self.assertEqual(status, 403)
        status, payload, _ = self._request(
            "POST",
            "/api/settings/credentials",
            body=body,
            headers={"X-Setup-Token": "setup-secret"},
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["credentials_configured"])

    def test_sync_project_dir_is_confined_to_configured_roots(self) -> None:
        root = Path(self._tmp.name) / "projects"
        inside = root / "inside"
        outside = Path(self._tmp.name) / "outside"
        inside.mkdir(parents=True)
        outside.mkdir()
        with self.assertRaisesRegex(ValueError, "disabled"):
            server.validate_sync_project_dir(str(inside))
        with mock.patch.object(server, "SYNC_ROOTS", (root.resolve(),)):
            self.assertEqual(server.validate_sync_project_dir(str(inside)), str(inside.resolve()))
            with self.assertRaisesRegex(ValueError, "configured sync roots"):
                server.validate_sync_project_dir(str(outside))
            escape = root / "escape"
            escape.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "configured sync roots"):
                server.validate_sync_project_dir(str(escape))

    def test_security_headers_include_csp(self) -> None:
        status, _, headers = self._request("GET", "/")
        self.assertEqual(status, 200)
        csp = headers["content-security-policy"]
        self.assertIn("default-src 'self'", csp)
        self.assertIn("script-src 'self'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertIn("frame-ancestors 'none'", csp)

    def test_cookie_can_be_marked_secure(self) -> None:
        self.assertIn("Secure", server.session_cookie_header("sid", False, secure=True))

    def test_update_check_can_be_disabled(self) -> None:
        with mock.patch.object(server, "UPDATE_CHECK_ENABLED", False):
            with mock.patch.object(server.urllib.request, "urlopen") as urlopen:
                self.assertIsNone(server.get_latest_github_version())
                urlopen.assert_not_called()

    def test_repeated_login_failures_are_rate_limited(self) -> None:
        address = "127.0.0.1"
        for _ in range(server.LOGIN_MAX_FAILURES):
            server.record_login_failure(address)
        self.assertGreater(server.login_retry_after(address), 0)

    def test_login_endpoint_returns_rate_limit(self) -> None:
        self._write_credentials()
        body = {"username": "owner", "password": "wrong"}
        with mock.patch.object(server, "verify_password", return_value=False):
            for _ in range(server.LOGIN_MAX_FAILURES):
                status, _, _ = self._request("POST", "/api/login", body=body)
                self.assertEqual(status, 401)
            status, payload, headers = self._request("POST", "/api/login", body=body)
        self.assertEqual(status, 429)
        self.assertIn("retry-after", headers)
        self.assertIn("Too many", payload["error"])


class StaticSecurityTests(unittest.TestCase):
    def test_markdown_links_use_a_scheme_allowlist(self) -> None:
        source = (server.STATIC_DIR / "app.js").read_text(encoding="utf-8")
        self.assertIn("function safeMarkdownHref", source)
        self.assertIn('new Set(["http:", "https:", "mailto:"])', source)
        self.assertIn("safeMarkdownHref(url)", source)

    def test_prepaint_script_is_external_for_strict_csp(self) -> None:
        source = (server.STATIC_DIR / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("<script>\n", source)
        self.assertIn('src="/prepaint.js', source)

    def test_restore_path_has_no_direct_metadata_update(self) -> None:
        source = Path(server.__file__).read_text(encoding="utf-8")
        self.assertNotIn("UPDATE embedding_metadata", source)


if __name__ == "__main__":
    unittest.main()
