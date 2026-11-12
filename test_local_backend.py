import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


class LocalBackendIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_paths = (server.DATA_DIR, server.DATABASE_PATH, server.CREDENTIALS_PATH, server.MEDIA_DIR)
        cls.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(cls.temp_dir.name) / "data"
        server.DATA_DIR = data_dir
        server.DATABASE_PATH = data_dir / "test.sqlite3"
        server.CREDENTIALS_PATH = data_dir / "admin.json"
        server.MEDIA_DIR = data_dir / "media"
        server.SESSIONS.clear()
        server.initialize_database()
        server.save_admin_password("test-password-for-local-backend")
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.LocalSiteHandler)
        cls.base_url = "http://127.0.0.1:%s" % cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.cookies = http.cookiejar.CookieJar()
        cls.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cls.cookies))

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)
        server.DATA_DIR, server.DATABASE_PATH, server.CREDENTIALS_PATH, server.MEDIA_DIR = cls.original_paths
        server.SESSIONS.clear()
        cls.temp_dir.cleanup()

    def request(self, path, method="GET", payload=None, headers=None, body=None, authenticated=True):
        request_headers = dict(headers or {})
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=body, method=method, headers=request_headers)
        try:
            opener = self.client if authenticated else urllib.request.build_opener()
            with opener.open(request, timeout=5) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            status, headers, body = error.code, error.headers, error.read()
            error.close()
            return status, headers, body

    def test_auth_crud_published_reads_and_media_upload(self):
        status, _, _ = self.request("/api/events", method="POST", payload={"title": "Denied event"})
        self.assertEqual(status, 401)

        status, _, body = self.request("/api/events?published=eq.invalid")
        self.assertEqual(status, 400)
        self.assertIn("true or false", json.loads(body)["error"])

        status, _, body = self.request("/api/events?order=unknown.asc")
        self.assertEqual(status, 400)
        self.assertIn("sort order", json.loads(body)["error"])

        status, _, body = self.request("/api/auth/login", method="POST", payload=["invalid login shape"])
        self.assertEqual(status, 400)

        status, _, body = self.request("/api/auth/login", method="POST", payload={
            "email": server.ADMIN_EMAIL,
            "password": "test-password-for-local-backend",
        })
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["user"]["app_metadata"]["role"], "admin")

        page_block = {
            "page_slug": "about",
            "section_key": "mission",
            "title": "Our mission",
            "body": "A local content block.",
        }
        status, _, _ = self.request("/api/page_content", method="POST", payload=page_block)
        self.assertEqual(status, 200)
        status, _, body = self.request("/api/page_content", method="POST", payload=page_block)
        self.assertEqual(status, 409)
        self.assertIn("unique", json.loads(body)["error"].lower())

        status, _, body = self.request("/api/events", method="POST", payload={"location": "Accra"})
        self.assertEqual(status, 400)
        self.assertIn("Required fields", json.loads(body)["error"])

        status, _, body = self.request("/api/events", method="POST", payload={
            "title": "Invalid date event",
            "event_date": "not-a-date",
        })
        self.assertEqual(status, 400)
        self.assertIn("YYYY-MM-DD", json.loads(body)["error"])

        status, _, body = self.request("/api/events", method="POST", payload={
            "title": "Published local event",
            "event_date": "2026-12-01",
            "location": "Accra",
            "status": "Upcoming",
            "summary": "Integration test event",
            "published": True,
        })
        self.assertEqual(status, 200)
        event_id = json.loads(body)[0]["id"]

        status, _, _ = self.request("/api/events", method="POST", payload={
            "title": "Draft local event",
            "status": "Draft",
            "published": False,
        })
        self.assertEqual(status, 200)

        status, _, body = self.request("/api/events?published=eq.true&order=event_date.asc")
        self.assertEqual(status, 200)
        self.assertEqual([row["id"] for row in json.loads(body)], [event_id])

        status, _, body = self.request("/api/events/" + event_id, method="PATCH", payload={"title": "Updated local event"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)[0]["title"], "Updated local event")

        status, _, body = self.request("/api/events/" + event_id, method="PATCH", payload={"title": "   "})
        self.assertEqual(status, 400)
        self.assertIn("cannot be blank", json.loads(body)["error"])
        status, _, body = self.request("/api/events?published=eq.true")
        self.assertEqual(json.loads(body)[0]["title"], "Updated local event")

        boundary = "local-backend-test-boundary"
        image_bytes = b"local test image"
        multipart = (
            ("--%s\r\n" % boundary).encode()
            + b'Content-Disposition: form-data; name="file"; filename="test.png"\r\n'
            + b"Content-Type: image/png\r\n\r\n"
            + image_bytes
            + ("\r\n--%s--\r\n" % boundary).encode()
        )
        status, _, body = self.request(
            "/api/storage/foundation-media/upload?path=media/integration-test.png",
            method="POST",
            headers={"Content-Type": "multipart/form-data; boundary=" + boundary},
            body=multipart,
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["path"], "media/integration-test.png")

        status, _, _ = self.request(
            "/uploads/media/integration-test.png",
            authenticated=False,
        )
        self.assertEqual(status, 404)

        status, _, body = self.request("/api/media_assets", method="POST", payload={
            "title": "Integration test photo",
            "media_type": "image",
            "file_path": "media/integration-test.png",
            "published": False,
        })
        self.assertEqual(status, 200)
        media_id = json.loads(body)[0]["id"]
        status, _, _ = self.request("/uploads/media/integration-test.png", authenticated=False)
        self.assertEqual(status, 404)
        status, _, _ = self.request(
            "/api/media_assets/" + media_id,
            method="PATCH",
            payload={"published": True},
        )
        self.assertEqual(status, 200)

        status, headers, body = self.request(
            "/uploads/media/integration-test.png",
            headers={"Range": "bytes=0-3"},
            authenticated=False,
        )
        self.assertEqual(status, 206)
        self.assertEqual(body, image_bytes[:4])
        self.assertEqual(headers.get("Content-Type"), "image/png")

        status, _, _ = self.request("/api/storage/foundation-media/object?path=media%2Fintegration-test.png", method="DELETE")
        self.assertEqual(status, 200)
        status, _, _ = self.request("/api/media_assets/" + media_id, method="DELETE")
        self.assertEqual(status, 200)

        status, _, _ = self.request("/api/events/" + event_id, method="DELETE")
        self.assertEqual(status, 200)
        status, _, body = self.request("/api/events?published=eq.true")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), [])

        status, _, _ = self.request("/api/auth/logout", method="POST")
        self.assertEqual(status, 200)
        status, _, body = self.request("/api/events?published=eq.true")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), [])
        status, _, _ = self.request("/api/events", method="POST", payload={"title": "Denied after sign out"})
        self.assertEqual(status, 401)

    def test_password_rotation_invalidates_existing_sessions(self):
        original_data_dir = server.DATA_DIR
        original_credentials_path = server.CREDENTIALS_PATH
        original_sessions = dict(server.SESSIONS)
        try:
            server.DATA_DIR = Path(self.temp_dir.name) / "password-test"
            server.CREDENTIALS_PATH = server.DATA_DIR / "admin.json"
            server.SESSIONS["test-session"] = 9999999999
            server.save_admin_password("first-test-password-123")
            first = server.read_admin_credentials()
            server.SESSIONS["test-session"] = 9999999999

            server.save_admin_password("second-test-password-456")
            second = server.read_admin_credentials()

            self.assertNotEqual(first["password_hash"], second["password_hash"])
            self.assertNotEqual(first["salt"], second["salt"])
            self.assertNotIn("test-session", server.SESSIONS)
            self.assertEqual(second["email"], server.ADMIN_EMAIL)
        finally:
            server.DATA_DIR = original_data_dir
            server.CREDENTIALS_PATH = original_credentials_path
            server.SESSIONS.clear()
            server.SESSIONS.update(original_sessions)

    def test_failed_signin_attempts_are_rate_limited(self):
        client_ip = "127.0.0.1"
        server.FAILED_LOGINS.pop(client_ip, None)
        try:
            for attempt in range(server.LOGIN_MAX_FAILURES - 1):
                status, _, _ = self.request("/api/auth/login", method="POST", payload={
                    "email": server.ADMIN_EMAIL,
                    "password": "incorrect-password",
                })
                self.assertEqual(status, 401, "failure %s" % (attempt + 1))

            status, _, _ = self.request("/api/auth/login", method="POST", payload={
                "email": server.ADMIN_EMAIL,
                "password": "incorrect-password",
            })
            self.assertEqual(status, 429)

            status, _, _ = self.request("/api/auth/login", method="POST", payload={
                "email": server.ADMIN_EMAIL,
                "password": "test-password-for-local-backend",
            })
            self.assertEqual(status, 429)
        finally:
            server.FAILED_LOGINS.pop(client_ip, None)

    def test_database_initialization_is_idempotent_and_preserves_records(self):
        record_id = "restart-persistence-check"
        with server.open_database() as connection:
            connection.execute(
                "insert into events (id, title, published) values (?, ?, ?)",
                (record_id, "Keep this record", 1),
            )

        server.initialize_database()

        with server.open_database() as connection:
            row = connection.execute("select title from events where id = ?", (record_id,)).fetchone()
            schema_version = connection.execute("pragma user_version").fetchone()[0]
            connection.execute("delete from events where id = ?", (record_id,))

        self.assertIsNotNone(row)
        self.assertEqual(row["title"], "Keep this record")
        self.assertEqual(schema_version, server.SCHEMA_VERSION)

    def test_local_html_is_not_served_as_stale_not_modified(self):
        status, headers, body = self.request(
            "/volunteer.html",
            headers={"If-Modified-Since": "Wed, 21 Oct 2099 07:28:00 GMT"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-store")
        self.assertIn(b'data-cms-page-placeholder="volunteer"', body)


if __name__ == "__main__":
    unittest.main()
