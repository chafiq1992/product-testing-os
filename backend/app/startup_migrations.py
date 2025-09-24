import os
import logging
from contextlib import contextmanager


log = logging.getLogger(__name__)


def _is_postgres(dsn: str) -> bool:
    d = (dsn or "").strip().lower()
    return d.startswith("postgres://") or d.startswith("postgresql://")


@contextmanager
def _connect_any(dsn: str | None, sqlite_path_env: str | None = None):
    """Connect to Postgres when DSN is provided, otherwise SQLite when path is provided.

    This is best-effort and intended only for lightweight DDL + backfill.
    """
    if dsn and _is_postgres(dsn):
        import psycopg2  # type: ignore
        conn = psycopg2.connect(dsn)
        try:
            yield conn, True
        finally:
            try:
                conn.close()
            except Exception:
                pass
        return

    # SQLite fallback
    import sqlite3  # type: ignore
    db_path = os.environ.get(sqlite_path_env or "WHATSAPP_SQLITE_PATH", "whatsapp.db")
    conn = sqlite3.connect(db_path)
    try:
        yield conn, False
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _pg_column_exists(cur, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name=%s AND column_name=%s
        LIMIT 1
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def _sqlite_column_exists(cur, table: str, column: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    cols = [row[1] for row in cur.fetchall()]
    return column in cols


def ensure_conversations_server_ts():
    """Auto-migrate WhatsApp conversations table to include server_ts and index.

    Controlled by env:
      - MIGRATE_WHATSAPP_ON_STARTUP: when '1'/'true' (default true if WHATSAPP_DATABASE_URL present)
      - WHATSAPP_DATABASE_URL: postgres DSN. If missing, uses SQLite path from WHATSAPP_SQLITE_PATH (default whatsapp.db)
    Safe to run repeatedly.
    """
    dsn = os.environ.get("WHATSAPP_DATABASE_URL", "").strip()
    migrate_flag = os.environ.get("MIGRATE_WHATSAPP_ON_STARTUP", "").strip().lower()
    enabled = bool(dsn) or migrate_flag in ("1", "true", "yes")
    if not enabled:
        # Nothing to do in this app environment
        return

    try:
        with _connect_any(dsn) as (conn, is_pg):
            # autocommit for DDL/backfill
            try:
                if is_pg:
                    conn.autocommit = True  # type: ignore[attr-defined]
            except Exception:
                pass
            cur = conn.cursor()

            # Create table if missing (best-effort, minimal shape)
            try:
                if is_pg:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS conversations (
                            id TEXT PRIMARY KEY,
                            created_at timestamptz,
                            received_at timestamptz
                        )
                        """
                    )
                else:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS conversations (
                            id TEXT PRIMARY KEY,
                            created_at INTEGER,
                            received_at INTEGER
                        )
                        """
                    )
            except Exception:
                # non-fatal
                pass

            # Add column server_ts when missing
            exists = _pg_column_exists(cur, "conversations", "server_ts") if is_pg else _sqlite_column_exists(cur, "conversations", "server_ts")
            if not exists:
                if is_pg:
                    cur.execute("ALTER TABLE conversations ADD COLUMN server_ts timestamptz")
                else:
                    cur.execute("ALTER TABLE conversations ADD COLUMN server_ts INTEGER")
                log.info("[auto-migrate] Added conversations.server_ts")

            # Backfill
            if is_pg:
                cur.execute("UPDATE conversations SET server_ts = COALESCE(server_ts, received_at, created_at, NOW())")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_conversations_server_ts ON conversations (server_ts DESC)")
            else:
                cur.execute("UPDATE conversations SET server_ts = COALESCE(server_ts, received_at, created_at, strftime('%s','now'))")
                # SQLite doesn't support DESC in index definition for utility; plain index is fine
                cur.execute("CREATE INDEX IF NOT EXISTS idx_conversations_server_ts ON conversations(server_ts)")

            try:
                conn.commit()
            except Exception:
                pass

            log.info("[auto-migrate] conversations.server_ts ensured and backfilled")
    except Exception as e:
        # Do not block app startup
        log.error("[auto-migrate] Failed: %s", e)


__all__ = [
    "ensure_conversations_server_ts",
]


