import argparse
from contextlib import contextmanager
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
import tempfile
import time
from email import policy
from email.parser import BytesParser
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parent
SITE_DIR = ROOT / "site"
DATA_ROOT = Path(
    os.environ.get("LOCALAPPDATA")
    or os.environ.get("XDG_DATA_HOME")
    or (Path.home() / ".local" / "share")
)
DATA_DIR = DATA_ROOT / "wfyp-foundation-website"
DATABASE_PATH = DATA_DIR / "wfyp.sqlite3"
CREDENTIALS_PATH = DATA_DIR / "admin.json"
MEDIA_DIR = DATA_DIR / "media"
SCHEMA_PATH = ROOT / "local_schema.sql"
HOST = "127.0.0.1"
PORT = int(os.environ.get("WFYP_PORT", "8000"))
SCHEMA_VERSION = 1
ADMIN_EMAIL = "admin@localhost"
SESSION_COOKIE = "wfyp_local_session"
SESSION_TTL = 12 * 60 * 60
LOGIN_WINDOW = 5 * 60
LOGIN_MAX_FAILURES = 5
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024
MAX_TEXT_LENGTH = 100_000
ALLOWED_MEDIA_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm", "video/quicktime",
}

TABLE_COLUMNS = {
    "events": {"id", "title", "event_date", "location", "status", "summary", "published", "created_at"},
    "impact_stories": {"id", "title", "story_date", "location", "image_url", "summary", "published", "created_at"},
    "leadership": {"id", "name", "role", "image_url", "bio", "sort_order", "published", "created_at"},
    "page_content": {"id", "page_slug", "section_key", "title", "body", "published", "created_at"},
    "donation_options": {"id", "title", "donation_type", "description", "details", "sort_order", "published", "created_at"},
    "media_assets": {"id", "title", "media_type", "file_path", "alt_text", "description", "sort_order", "published", "created_at"},
}
REQUIRED_FIELDS = {
    "events": {"title"},
    "impact_stories": {"title"},
    "leadership": {"name", "role"},
    "page_content": {"page_slug", "section_key", "title"},
    "donation_options": {"title"},
    "media_assets": {"title", "media_type", "file_path"},
}
DATE_FIELDS = {"event_date", "story_date"}
INTEGER_FIELDS = {"sort_order"}

SESSIONS = {}
FAILED_LOGINS = {}


@contextmanager
def open_database():
    connection = sqlite3.connect(DATABASE_PATH, timeout=20)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    with open_database() as connection:
        version = connection.execute("pragma user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                "Database schema version %s is newer than this server supports (%s)."
                % (version, SCHEMA_VERSION)
            )
        if version < 1:
            connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            connection.execute("pragma user_version = 1")


def password_digest(password, salt):
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1).hex()


def save_admin_password(password):
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters.")
    salt = secrets.token_bytes(16)
    credentials = {
        "email": ADMIN_EMAIL,
        "salt": salt.hex(),
        "password_hash": password_digest(password, salt),
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=DATA_DIR, prefix=".admin-", delete=False
        ) as credentials_file:
            json.dump(credentials, credentials_file)
            credentials_file.flush()
            os.fsync(credentials_file.fileno())
            temporary_path = Path(credentials_file.name)
        os.replace(temporary_path, CREDENTIALS_PATH)
    except OSError:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink(missing_ok=True)
        raise
    try:
        CREDENTIALS_PATH.chmod(0o600)
    except OSError:
        pass
    SESSIONS.clear()


def initialize_admin():
    if CREDENTIALS_PATH.exists():
        return None
    configured_password = os.environ.get("WFYP_ADMIN_PASSWORD")
    if configured_password:
        save_admin_password(configured_password)
        return None
    initial_password = secrets.token_urlsafe(18)
    save_admin_password(initial_password)
    return initial_password


def read_admin_credentials():
    return json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))


def is_safe_local_origin(handler):
    origin = handler.headers.get("Origin")
    if not origin:
        return True
    parsed = urlsplit(origin)
    return parsed.netloc == handler.headers.get("Host") and parsed.scheme in {"http", "https"}


class LocalSiteHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

    def end_headers(self):
        request_path = urlsplit(self.path).path
        if not request_path.startswith("/api/") and not request_path.startswith("/uploads/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        return super().send_head()

    def log_message(self, format_string, *args):
        print("%s - %s" % (self.address_string(), format_string % args))

    def _send_json(self, status, value, headers=None):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for name, value in headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_api_error(self, error):
        if isinstance(error, OverflowError):
            status = 413
        elif isinstance(error, ValueError):
            status = 400
        elif isinstance(error, sqlite3.IntegrityError):
            status = 409
        elif isinstance(error, sqlite3.OperationalError):
            status = 503
        elif isinstance(error, sqlite3.Error):
            status = 500
        else:
            status = 500
        message = str(error) if status < 500 else "The local database is temporarily unavailable."
        self._send_json(status, {"error": message})

    def _read_body(self, maximum=MAX_REQUEST_BYTES):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Chunked request bodies are not supported.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request length.")
        if length < 0 or length > maximum:
            raise OverflowError("Request is larger than the allowed limit.")
        return self.rfile.read(length)

    def _read_json(self):
        raw = self._read_body()
        if not raw:
            return {}
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Request body must be valid JSON.")
        if not isinstance(value, (dict, list)):
            raise ValueError("Request body must be a JSON object or array.")
        return value

    def _session_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            return cookie[SESSION_COOKIE].value if SESSION_COOKIE in cookie else None
        except Exception:
            return None

    def _is_admin(self):
        token = self._session_token()
        session = SESSIONS.get(token) if token else None
        if not session:
            return False
        expires_at, password_hash = session
        try:
            current_hash = read_admin_credentials()["password_hash"]
        except (OSError, KeyError, json.JSONDecodeError):
            SESSIONS.pop(token, None)
            return False
        if expires_at > time.time() and hmac.compare_digest(password_hash, current_hash):
            return True
        SESSIONS.pop(token, None)
        return False

    def _require_admin(self):
        if not self._is_admin():
            self._send_json(401, {"error": "Administrator sign-in is required."})
            return False
        if not is_safe_local_origin(self):
            self._send_json(403, {"error": "Cross-origin requests are not allowed."})
            return False
        return True

    def _send_local_media(self, request_path):
        relative = PurePosixPath(unquote(request_path.removeprefix("/uploads/")))
        if relative.is_absolute() or ".." in relative.parts:
            self.send_error(404)
            return
        target = (MEDIA_DIR / Path(*relative.parts)).resolve()
        try:
            target.relative_to(MEDIA_DIR.resolve())
        except ValueError:
            self.send_error(404)
            return
        if not target.is_file():
            self.send_error(404)
            return

        if not self._is_admin():
            with open_database() as connection:
                published = connection.execute(
                    "select 1 from media_assets where file_path = ? and published = 1",
                    (relative.as_posix(),),
                ).fetchone()
            if not published:
                self.send_error(404)
                return

        file_size = target.stat().st_size
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        byte_range = self.headers.get("Range", "")
        start, end = 0, file_size - 1
        status = 200
        if byte_range.startswith("bytes="):
            try:
                range_start, range_end = byte_range[6:].split("-", 1)
                if range_start:
                    start = int(range_start)
                else:
                    start = max(file_size - int(range_end or "0"), 0)
                if range_end and range_start:
                    end = min(int(range_end), file_size - 1)
                if start > end or start >= file_size:
                    raise ValueError
                status = 206
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%s" % file_size)
                self.end_headers()
                return

        length = max(end - start + 1, 0)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "public, max-age=3600")
        if status == 206:
            self.send_header("Content-Range", "bytes %s-%s/%s" % (start, end, file_size))
        self.end_headers()
        with target.open("rb") as media_file:
            media_file.seek(start)
            remaining = length
            while remaining:
                chunk = media_file.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/api/session":
            if self._is_admin():
                self._send_json(200, {"user": {"email": ADMIN_EMAIL, "app_metadata": {"role": "admin"}}})
            else:
                self._send_json(200, {"user": None})
            return
        if parsed.path.startswith("/api/"):
            table = parsed.path.removeprefix("/api/")
            if table not in TABLE_COLUMNS:
                self._send_json(404, {"error": "Unknown content collection."})
                return
            try:
                self._get_records(table, parse_qs(parsed.query))
            except (ValueError, sqlite3.Error) as error:
                self._send_api_error(error)
            return
        if parsed.path.startswith("/uploads/"):
            self._send_local_media(parsed.path)
            return
        self.path = parsed.path + (("?" + parsed.query) if parsed.query else "")
        super().do_GET()

    def _get_records(self, table, query):
        filters = []
        parameters = []
        if not self._is_admin():
            filters.append("published = 1")
        for column, values in query.items():
            if column == "order":
                continue
            if column not in TABLE_COLUMNS[table] or not values:
                raise ValueError("Unsupported query field: " + column)
            expression = values[0]
            if not expression.startswith("eq."):
                raise ValueError("Only equality filters are supported.")
            raw_value = expression[3:]
            if column == "published":
                if raw_value.lower() not in {"true", "false"}:
                    raise ValueError("Published filter must be true or false.")
                raw_value = 1 if raw_value.lower() == "true" else 0
            filters.append('"%s" = ?' % column)
            parameters.append(raw_value)
        statement = 'select * from "%s"' % table
        if filters:
            statement += " where " + " and ".join(filters)
        order_values = query.get("order", [])
        if order_values:
            parts = order_values[0].split(".", 1)
            if len(parts) != 2 or parts[0] not in TABLE_COLUMNS[table] or parts[1].lower() not in {"asc", "desc"}:
                raise ValueError("Unsupported sort order.")
            direction = parts[1].lower()
            statement += ' order by "%s" %s' % (parts[0], direction)
        with open_database() as connection:
            rows = connection.execute(statement, parameters).fetchall()
        output = [dict(row) for row in rows]
        for row in output:
            if "published" in row:
                row["published"] = bool(row["published"])
        self._send_json(200, output)

    def do_POST(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/api/auth/login":
            self._login()
            return
        if parsed.path == "/api/auth/logout":
            self._logout()
            return
        if parsed.path == "/api/storage/foundation-media/upload":
            self._upload_media(parse_qs(parsed.query))
            return
        if parsed.path.startswith("/api/"):
            table = parsed.path.removeprefix("/api/")
            if table not in TABLE_COLUMNS:
                self._send_json(404, {"error": "Unknown content collection."})
                return
            self._insert_records(table)
            return
        self._send_json(404, {"error": "Unknown endpoint."})

    def do_PATCH(self):
        parsed = urlsplit(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api" or parts[1] not in TABLE_COLUMNS:
            self._send_json(404, {"error": "Unknown endpoint."})
            return
        if not self._require_admin():
            return
        self._update_record(parts[1], unquote(parts[2]))

    def do_DELETE(self):
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/storage/foundation-media/object"):
            self._delete_media(parse_qs(parsed.query))
            return
        parts = parsed.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api" or parts[1] not in TABLE_COLUMNS:
            self._send_json(404, {"error": "Unknown endpoint."})
            return
        if not self._require_admin():
            return
        table, record_id = parts[1], unquote(parts[2])
        try:
            with open_database() as connection:
                connection.execute('delete from "%s" where id = ?' % table, (record_id,))
            self._send_json(200, [])
        except sqlite3.Error as error:
            self._send_api_error(error)

    def _login(self):
        if not is_safe_local_origin(self):
            self._send_json(403, {"error": "Cross-origin requests are not allowed."})
            return
        client_ip = self.client_address[0]
        now = time.time()
        failures, window_start = FAILED_LOGINS.get(client_ip, (0, now))
        if now - window_start >= LOGIN_WINDOW:
            failures, window_start = 0, now
        if failures >= LOGIN_MAX_FAILURES:
            self._send_json(429, {"error": "Too many failed sign-in attempts. Try again in a few minutes."})
            return
        try:
            payload = self._read_json()
            if not isinstance(payload, dict):
                self._send_json(400, {"error": "Login details must be a JSON object."})
                return
            credentials = read_admin_credentials()
            salt = bytes.fromhex(credentials["salt"])
            candidate = password_digest(str(payload.get("password", "")), salt)
            valid = (
                hmac.compare_digest(str(payload.get("email", "")).lower(), ADMIN_EMAIL)
                and hmac.compare_digest(candidate, credentials["password_hash"])
            )
        except OverflowError as error:
            self._send_json(413, {"error": str(error)})
            return
        except (ValueError, KeyError, OSError, json.JSONDecodeError):
            valid = False
        if not valid:
            failures += 1
            FAILED_LOGINS[client_ip] = (failures, window_start)
            status = 429 if failures >= LOGIN_MAX_FAILURES else 401
            self._send_json(status, {"error": "Email or password is incorrect." if status == 401 else "Too many failed sign-in attempts. Try again in a few minutes."})
            return
        FAILED_LOGINS.pop(client_ip, None)
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = (time.time() + SESSION_TTL, credentials["password_hash"])
        cookie = "%s=%s; Path=/; Max-Age=%s; HttpOnly; SameSite=Strict" % (SESSION_COOKIE, token, SESSION_TTL)
        self._send_json(200, {"user": {"email": ADMIN_EMAIL, "app_metadata": {"role": "admin"}}}, {"Set-Cookie": cookie})

    def _logout(self):
        if not self._require_admin():
            return
        token = self._session_token()
        if token:
            SESSIONS.pop(token, None)
        cookie = "%s=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" % SESSION_COOKIE
        self._send_json(200, {"ok": True}, {"Set-Cookie": cookie})

    def _insert_records(self, table):
        if not self._require_admin():
            return
        try:
            payload = self._read_json()
            upsert = isinstance(payload, dict) and payload.get("upsert") is True
            records = payload.get("records") if isinstance(payload, dict) and "records" in payload else payload
            if not isinstance(records, list):
                records = [records]
            if any(not isinstance(record, dict) for record in records):
                raise ValueError("Each record must be an object.")
            output = []
            with open_database() as connection:
                for record in records:
                    clean = self._clean_record(table, record, inserting=True)
                    columns = list(clean)
                    placeholders = ", ".join("?" for _ in columns)
                    names = ", ".join('"%s"' % column for column in columns)
                    values = [clean[column] for column in columns]
                    if upsert:
                        updates = [column for column in columns if column != "id"]
                        update_clause = ", ".join('"%s" = excluded."%s"' % (column, column) for column in updates)
                        statement = 'insert into "%s" (%s) values (%s) on conflict(id) do update set %s' % (table, names, placeholders, update_clause)
                    else:
                        statement = 'insert into "%s" (%s) values (%s)' % (table, names, placeholders)
                    connection.execute(statement, values)
                    row = connection.execute('select * from "%s" where id = ?' % table, (clean["id"],)).fetchone()
                    output.append(dict(row))
            for row in output:
                if "published" in row:
                    row["published"] = bool(row["published"])
            self._send_json(200, output)
        except (ValueError, OverflowError, sqlite3.Error) as error:
            self._send_api_error(error)

    def _clean_record(self, table, record, inserting=False):
        if not isinstance(record, dict):
            raise ValueError("Each record must be an object.")
        allowed = TABLE_COLUMNS[table]
        unknown = set(record) - allowed
        if unknown:
            raise ValueError("Unknown fields: " + ", ".join(sorted(unknown)))
        clean = dict(record)
        clean.pop("created_at", None)
        if inserting:
            clean.setdefault("id", secrets.token_hex(16))
            clean.setdefault("published", False)
        if "published" in clean:
            published = clean["published"]
            if not isinstance(published, (bool, int)) or published not in (0, 1):
                raise ValueError("Published must be true or false.")
            clean["published"] = int(published)
        if inserting:
            missing = REQUIRED_FIELDS[table] - clean.keys()
            if missing:
                raise ValueError("Required fields are missing: " + ", ".join(sorted(missing)))
            blank = [
                field for field in REQUIRED_FIELDS[table]
                if not isinstance(clean.get(field), str) or not clean[field].strip()
            ]
            if blank:
                raise ValueError("Required fields cannot be blank: " + ", ".join(sorted(blank)))
        for field, value in clean.items():
            if field == "published":
                continue
            if value is None and field in DATE_FIELDS:
                continue
            if field in INTEGER_FIELDS:
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    raise ValueError(field + " must be a non-negative whole number.")
                continue
            if not isinstance(value, str):
                raise ValueError(field + " must be text.")
            if len(value) > MAX_TEXT_LENGTH:
                raise ValueError(field + " is too long.")
        for date_field in DATE_FIELDS.intersection(clean):
            if clean[date_field]:
                try:
                    time.strptime(clean[date_field], "%Y-%m-%d")
                except (TypeError, ValueError):
                    raise ValueError(date_field + " must use YYYY-MM-DD format.")
        if table == "media_assets" and clean.get("media_type") not in {None, "image", "video"}:
            raise ValueError("Media type must be image or video.")
        if table == "events" and clean.get("status") not in {None, "Upcoming", "Completed", "Draft"}:
            raise ValueError("Event status is not supported.")
        if table == "media_assets" and clean.get("file_path"):
            self._safe_media_target(clean["file_path"])
        return clean

    def _update_record(self, table, record_id):
        try:
            payload = self._read_json()
            if not isinstance(payload, dict):
                raise ValueError("An update must be a JSON object.")
            if "id" in payload or "created_at" in payload:
                raise ValueError("Record IDs and creation times cannot be changed.")
            with open_database() as connection:
                existing = connection.execute('select * from "%s" where id = ?' % table, (record_id,)).fetchone()
            if not existing:
                self._send_json(200, [])
                return
            complete_record = dict(existing)
            complete_record.update(payload)
            validated = self._clean_record(table, complete_record, inserting=True)
            clean = {key: validated[key] for key in payload}
            if not clean:
                self._send_json(200, [dict(existing)])
                return
            columns = list(clean)
            assignments = ", ".join('"%s" = ?' % column for column in columns)
            values = [clean[column] for column in columns] + [record_id]
            with open_database() as connection:
                connection.execute('update "%s" set %s where id = ?' % (table, assignments), values)
                row = connection.execute('select * from "%s" where id = ?' % table, (record_id,)).fetchone()
            result = dict(row) if row else None
            if result and "published" in result:
                result["published"] = bool(result["published"])
            self._send_json(200, [result] if result else [])
        except (ValueError, OverflowError, sqlite3.Error) as error:
            self._send_api_error(error)

    def _safe_media_target(self, media_path):
        relative = PurePosixPath(media_path)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts or relative.parts[0] != "media":
            raise ValueError("Invalid media path.")
        target = (MEDIA_DIR / Path(*relative.parts)).resolve()
        target.relative_to(MEDIA_DIR.resolve())
        return target

    def _upload_media(self, query):
        if not self._require_admin():
            return
        try:
            media_path = query.get("path", [""])[0]
            target = self._safe_media_target(media_path)
            content_type = self.headers.get("Content-Type", "")
            if "\r" in content_type or "\n" in content_type or not content_type.lower().startswith("multipart/form-data;"):
                raise ValueError("Upload must use multipart form data.")
            raw = self._read_body()
            message = BytesParser(policy=policy.default).parsebytes(
                ("Content-Type: %s\r\nMIME-Version: 1.0\r\n\r\n" % content_type).encode("ascii") + raw
            )
            uploaded = None
            for part in message.iter_parts():
                if part.get_param("name", header="content-disposition") == "file":
                    uploaded = (part.get_content_type().lower(), part.get_payload(decode=True) or b"")
                    break
            if not uploaded:
                raise ValueError("Choose a photo or video to upload.")
            file_type, body = uploaded
            if file_type not in ALLOWED_MEDIA_TYPES:
                raise ValueError("This photo or video format is not supported.")
            if len(body) > MAX_UPLOAD_BYTES:
                raise OverflowError("Choose a file smaller than 50 MB.")
            if target.exists():
                raise ValueError("That media path already exists.")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            self._send_json(200, {"path": media_path, "contentType": file_type})
        except OverflowError as error:
            self._send_api_error(error)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
        except OSError:
            self._send_json(500, {"error": "The uploaded file could not be saved to local storage."})

    def _delete_media(self, query):
        if not self._require_admin():
            return
        try:
            media_paths = query.get("path", [])
            removed = []
            for media_path in media_paths:
                target = self._safe_media_target(media_path)
                if target.is_file():
                    target.unlink()
                    removed.append(media_path)
            self._send_json(200, {"removed": removed})
        except (ValueError, OSError) as error:
            self._send_json(400, {"error": str(error)})

    def send_error(self, code, message=None, explain=None):
        if urlsplit(self.path).path.startswith("/api/"):
            self._send_json(code, {"error": message or "Request failed."})
            return
        super().send_error(code, message, explain)


def reset_admin_password():
    first = getpass.getpass("New local admin password (minimum 12 characters): ")
    if len(first) < 12:
        raise SystemExit("Password must be at least 12 characters.")
    second = getpass.getpass("Confirm password: ")
    if not hmac.compare_digest(first, second):
        raise SystemExit("Passwords did not match.")
    save_admin_password(first)
    print("Updated password for %s." % ADMIN_EMAIL)


def main():
    parser = argparse.ArgumentParser(description="Run the local Foundation website and content backend.")
    parser.add_argument("--reset-admin-password", action="store_true", help="Set a new password for the local administrator.")
    args = parser.parse_args()
    if args.reset_admin_password:
        reset_admin_password()
        return

    initialize_database()
    initial_password = initialize_admin()
    try:
        server = ThreadingHTTPServer((HOST, PORT), LocalSiteHandler)
    except OSError as error:
        raise SystemExit(
            "Could not start on port %s. Stop the other local server or set WFYP_PORT to another port."
            % PORT
        ) from error
    print("Local website: http://%s:%s/" % (HOST, PORT))
    print("Admin page:    http://%s:%s/administration.html" % (HOST, PORT))
    print("Admin email:   %s" % ADMIN_EMAIL)
    if initial_password:
        print("Initial admin password (save it now): %s" % initial_password)
    elif os.environ.get("WFYP_ADMIN_PASSWORD"):
        print("Admin password loaded from WFYP_ADMIN_PASSWORD.")
    print("SQLite data:   %s" % DATABASE_PATH)
    print("Media files:   %s" % MEDIA_DIR)
    print("This server listens on localhost only. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()