# Local Website Backend

This project now runs its own local backend with Python's standard library, SQLite, and files stored on the same device. No Node.js, package install, cloud account, or internet connection is needed for the backend.

## Start the website

From the project folder, run:

```powershell
python server.py
```

Open `http://127.0.0.1:8000/`. Manage content at `http://127.0.0.1:8000/administration.html`.

On first start, the server prints the one-time initial password for `admin@localhost`. Save it. If needed, reset it with:

```powershell
python server.py --reset-admin-password
```

The admin password can also be set using the `WFYP_ADMIN_PASSWORD` environment variable before the first start. The server listens on `127.0.0.1` only; it is not exposed to the local network or the internet.

If port 8000 is already in use, stop the other server or choose another port in PowerShell before starting this one:

```powershell
$env:WFYP_PORT = "8001"
python server.py
```

## Local data

- SQLite database: `%LOCALAPPDATA%\wfyp-foundation-website\wfyp.sqlite3` on Windows
- Uploaded photos and videos: `%LOCALAPPDATA%\wfyp-foundation-website\media\`
- Admin password hash: `%LOCALAPPDATA%\wfyp-foundation-website\admin.json`

The Administration page can manage events, impact stories, leadership, page content, donation options, and the media library. Published content is served by this local website. Photos and videos are limited to 50 MB each; supported types are JPEG, PNG, WebP, GIF, MP4, WebM, and MOV.

Stop the server before copying the entire `wfyp-foundation-website` data directory inside your local application-data folder; this preserves a consistent SQLite database along with uploaded media. The JSON content export does not include media file bytes.

## Later hosting

This backend is intended for one local device and development. Do not expose it directly to the internet. When the website is hosted, migrate the SQLite data and media to a production backend or managed database/object storage, then deploy the backend behind HTTPS with production authentication and backups.