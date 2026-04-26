"""Skiptrace portal — Flask app.

Provides a small web UI and JSON API for skip-trace lookups: single search,
batch CSV upload, search history, and CSV export. Lookups currently call a
mock provider; swap `providers.lookup` for a real integration (BatchSkipTracing,
REIskip, SkipGenie, etc.) without changing the rest of the app.
"""

from __future__ import annotations

import csv
import io
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from flask import (
    Flask,
    Response,
    abort,
    g,
    jsonify,
    render_template,
    request,
)

from providers import lookup
from scrapers import all_search_urls, ALL as ALL_SCRAPERS
from scrapers.base import has_cloudscraper

DB_PATH = Path(__file__).parent / "instance" / "skiptrace.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    phone TEXT,
    email TEXT,
    source TEXT NOT NULL,        -- 'single' | 'batch'
    result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at DESC);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        g.db = conn
    return g.db


def create_app() -> Flask:
    app = Flask(__name__)

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.get("/")
    def dashboard():
        return render_template("dashboard.html")

    @app.post("/api/skiptrace")
    def api_skiptrace():
        payload = request.get_json(silent=True) or {}
        query = _normalize_query(payload)
        if not _has_any_query_field(query):
            return jsonify({"error": "Provide at least one of: name, address, phone, email."}), 400

        result = lookup(query)
        _save_search(query, result, source="single")
        return jsonify({"query": query, "result": result})

    @app.post("/api/batch")
    def api_batch():
        upload = request.files.get("file")
        if upload is None or upload.filename == "":
            return jsonify({"error": "Upload a CSV file in the 'file' field."}), 400

        try:
            text = upload.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return jsonify({"error": "CSV must be UTF-8 encoded."}), 400

        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames is None:
            return jsonify({"error": "CSV is empty or missing a header row."}), 400

        rows: list[dict] = []
        for raw in reader:
            query = _normalize_query(raw)
            if not _has_any_query_field(query):
                rows.append({"query": query, "result": None, "error": "no usable fields"})
                continue
            result = lookup(query)
            _save_search(query, result, source="batch")
            rows.append({"query": query, "result": result})

        return jsonify({"count": len(rows), "rows": rows})

    @app.get("/api/history")
    def api_history():
        try:
            limit = max(1, min(500, int(request.args.get("limit", 50))))
        except ValueError:
            limit = 50
        rows = get_db().execute(
            "SELECT * FROM searches ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return jsonify({"rows": [_row_to_dict(r) for r in rows]})

    @app.get("/api/export.csv")
    def api_export():
        rows = get_db().execute(
            "SELECT * FROM searches ORDER BY id DESC"
        ).fetchall()
        return Response(
            _rows_to_csv(rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=skiptrace-history.csv"},
        )

    @app.post("/api/links")
    def api_links():
        payload = request.get_json(silent=True) or {}
        query = _normalize_query(payload)
        return jsonify({"links": list(all_search_urls(query))})

    @app.get("/api/sources")
    def api_sources():
        return jsonify({
            "sources": [{"name": s.name, "label": s.label, "domain": s.domain}
                        for s in ALL_SCRAPERS],
            "cloudscraper": has_cloudscraper(),
        })

    @app.delete("/api/history/<int:row_id>")
    def api_delete(row_id: int):
        db = get_db()
        cur = db.execute("DELETE FROM searches WHERE id = ?", (row_id,))
        db.commit()
        if cur.rowcount == 0:
            abort(404)
        return ("", 204)

    return app


def _normalize_query(raw: dict) -> dict:
    keys = ("name", "address", "city", "state", "zip", "phone", "email")
    out = {}
    for k in keys:
        # Accept case-insensitive keys from CSV uploads.
        v = raw.get(k) or raw.get(k.upper()) or raw.get(k.title())
        if v is None:
            continue
        v = str(v).strip()
        if v:
            out[k] = v
    return out


def _has_any_query_field(q: dict) -> bool:
    return any(q.get(k) for k in ("name", "address", "phone", "email"))


def _save_search(query: dict, result: dict, *, source: str) -> None:
    db = get_db()
    db.execute(
        """
        INSERT INTO searches
          (created_at, name, address, city, state, zip, phone, email, source, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
            query.get("name"),
            query.get("address"),
            query.get("city"),
            query.get("state"),
            query.get("zip"),
            query.get("phone"),
            query.get("email"),
            source,
            json.dumps(result),
        ),
    )
    db.commit()


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    try:
        d["result"] = json.loads(d.pop("result_json"))
    except (TypeError, ValueError):
        d["result"] = None
    return d


def _email_str(e) -> str:
    if isinstance(e, dict):
        return e.get("email", "")
    return str(e or "")


def _rows_to_csv(rows: Iterable[sqlite3.Row]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "id", "created_at", "source", "name", "address", "city", "state", "zip",
        "phone", "email", "result_phones", "result_emails", "result_addresses", "confidence",
    ])
    for r in rows:
        try:
            result = json.loads(r["result_json"]) or {}
        except (TypeError, ValueError):
            result = {}
        writer.writerow([
            r["id"], r["created_at"], r["source"], r["name"] or "", r["address"] or "",
            r["city"] or "", r["state"] or "", r["zip"] or "", r["phone"] or "", r["email"] or "",
            "; ".join(p.get("number", "") for p in result.get("phones", [])),
            "; ".join(_email_str(e) for e in result.get("emails", [])),
            "; ".join(a.get("line", "") for a in result.get("addresses", [])),
            result.get("confidence", ""),
        ])
    return buf.getvalue()


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
