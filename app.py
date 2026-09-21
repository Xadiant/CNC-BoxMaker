"""Serve the browser-only DrawerForge application."""

from __future__ import annotations

import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"


class DrawerHandler(SimpleHTTPRequestHandler):
    """Serve files from the static application directory only."""

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        relative = "index.html" if parsed.path == "/" else parsed.path.lstrip("/")
        path = (STATIC / relative).resolve()
        static_root = STATIC.resolve()
        if static_root not in path.parents and path != static_root:
            self.send_error(403)
            return
        if not path.is_file():
            self.send_error(404)
            return

        payload = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header(
            "Content-Type",
            f"{content_type}; charset=utf-8"
            if content_type.startswith("text/") or content_type == "application/javascript"
            else content_type,
        )
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[DrawerForge] {format_string % args}")


def main() -> None:
    host, port = "127.0.0.1", 8000
    server = ThreadingHTTPServer((host, port), DrawerHandler)
    print(f"DrawerForge is running at http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping DrawerForge.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
