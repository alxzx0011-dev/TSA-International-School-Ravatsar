"""Copy the whole school database from one Postgres/Supabase project to another.

This is used to move the site from a distant Supabase region (for example
Sydney) to a nearby one (for example Mumbai) so that queries stop taking
hundreds of milliseconds.

The script is safe to run more than once: existing rows are skipped, so a
second run only fills in what is missing.

Usage
-----
Put both connection strings in ``backend/.env.migrate`` (never commit it)::

    SOURCE_DATABASE_URL=postgresql+psycopg://...old project...
    TARGET_DATABASE_URL=postgresql+psycopg://...new project...

Then load them and run one of the commands below.

    # 1. Show the row counts in both databases (no writes)
    ../school/bin/python migrate_data.py --dry-run

    # 2. Copy every row, wiping the target first (recommended for a fresh project)
    ../school/bin/python migrate_data.py --reset --yes

    # 3. Check that both databases hold the same number of rows
    ../school/bin/python migrate_data.py --verify

    # 4. Compare round-trip latency of both databases
    ../school/bin/python migrate_data.py --benchmark

``--source`` and ``--target`` can be passed explicitly instead of using the env
variables. Passwords are never printed.

Important: use each project's **pooler** connection string (port 6543) when the
source/target host is Supabase and your machine or host has no IPv6 route. The
script disables server-side prepared statements automatically for poolers.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Iterable
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(os.path.join(BASE_DIR, ".env.migrate"))

# database.py refuses to import without DATABASE_URL; the migration script
# builds its own engines, so a placeholder is enough here.
os.environ.setdefault("DATABASE_URL", "sqlite://")

from database import Base  # noqa: E402  (import after env setup)
import model  # noqa: F401,E402  (registers every table on Base.metadata)


CHUNK_SIZE = 500


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def mask_url(url: str) -> str:
    """Hide the password in a connection string before printing it."""
    if not url.lower().startswith("postgres"):
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return "<unreadable url>"

    netloc = parts.netloc
    if "@" in netloc:
        credentials, host = netloc.rsplit("@", 1)
        user = credentials.split(":", 1)[0]
        netloc = f"{user}:***@{host}"

    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def is_pooler(url: str) -> bool:
    lowered = url.lower()
    return "pooler.supabase.com" in lowered or ":6543" in lowered


def make_engine(url: str) -> Engine:
    kwargs: dict = {
        "poolclass": NullPool,
        "pool_pre_ping": True,
        "future": True,
    }

    if url.startswith("postgresql"):
        connect_args: dict = {"connect_timeout": 20}
        if is_pooler(url):
            # Supavisor / PgBouncer transaction mode cannot keep prepared
            # statements between transactions.
            connect_args["prepare_threshold"] = None
        kwargs["connect_args"] = connect_args

    return create_engine(url, **kwargs)


def normalized_identity(url: str) -> tuple[str, str]:
    parts = urlsplit(url)
    return (parts.hostname or "", (parts.path or "").lstrip("/"))


def ordered_tables() -> list:
    """FK-safe table order derived from the SQLAlchemy metadata."""
    return list(Base.metadata.sorted_tables)


def count_rows(engine: Engine, table) -> int:
    with engine.connect() as conn:
        return int(conn.execute(select(func.count()).select_from(table)).scalar() or 0)


def count_all(engine: Engine) -> dict[str, int]:
    result: dict[str, int] = {}
    existing = set(inspect(engine).get_table_names())

    with engine.connect() as conn:
        for table in ordered_tables():
            if table.name not in existing:
                result[table.name] = 0
                continue
            result[table.name] = int(
                conn.execute(select(func.count()).select_from(table)).scalar() or 0
            )
    return result


def print_counts(title: str, counts: dict[str, int]) -> None:
    print(title)
    width = max(len(name) for name in counts) if counts else 10
    for name, value in counts.items():
        print(f"  {name:<{width}}  {value:>7}")
    print(f"  {'TOTAL':<{width}}  {sum(counts.values()):>7}")


def build_insert(table, dialect_name: str):
    """INSERT that silently skips rows which already exist."""
    if dialect_name == "postgresql":
        return pg_insert(table).on_conflict_do_nothing()
    if dialect_name == "sqlite":
        return sqlite_insert(table).on_conflict_do_nothing()
    return table.insert()


def reset_sequence(conn, table) -> None:
    """Make the id sequence continue after the highest copied id."""
    if conn.dialect.name != "postgresql":
        return
    if "id" not in table.columns:
        return

    sequence = conn.execute(
        text("SELECT pg_get_serial_sequence(:qualified, 'id')"),
        {"qualified": f"public.{table.name}"},
    ).scalar()

    if not sequence:
        return

    max_id = conn.execute(text(f'SELECT COALESCE(MAX(id), 0) FROM "{table.name}"')).scalar() or 0
    conn.execute(
        text("SELECT setval(:sequence::regclass, :value, :called)"),
        {"sequence": sequence, "value": max_id or 1, "called": bool(max_id)},
    )


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------
def run_copy(source: Engine, target: Engine, reset: bool, assume_yes: bool) -> int:
    tables = ordered_tables()

    source_counts = count_all(source)
    print_counts("Source rows:", source_counts)

    if reset:
        if not assume_yes:
            answer = input(
                "\nThis DELETEs every row in the target database. Type 'yes' to continue: "
            ).strip().lower()
            if answer != "yes":
                print("Aborted. Nothing was changed.")
                return 1

        print("\nCreating tables on the target (missing tables only)…")
        Base.metadata.create_all(bind=target)

        if target.dialect.name == "postgresql":
            names = ", ".join(f'"{table.name}"' for table in tables)
            with target.begin() as conn:
                conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        else:
            # SQLite has no TRUNCATE; delete in reverse FK order instead.
            with target.begin() as conn:
                for table in reversed(tables):
                    conn.execute(table.delete())
        print("Target tables emptied.")
    else:
        print("\nCreating tables on the target (missing tables only)…")
        Base.metadata.create_all(bind=target)

    print("\nCopying rows…")
    started = time.time()

    for table in tables:
        copied = 0
        with source.connect() as src, target.begin() as dst:
            result = src.execute(select(table))
            columns = list(result.keys())
            stmt = build_insert(table, dst.dialect.name)

            while True:
                rows = result.fetchmany(CHUNK_SIZE)
                if not rows:
                    break

                payload = [dict(zip(columns, row)) for row in rows]
                if payload:
                    dst.execute(stmt, payload)
                    copied += len(payload)

            reset_sequence(dst, table)

        print(f"  {table.name:<20} copied {copied:>7}")

    elapsed = time.time() - started
    target_counts = count_all(target)

    print(f"\nCopy finished in {elapsed:.1f}s")
    print_counts("Target rows:", target_counts)

    missing = {
        name: source_counts.get(name, 0) - target_counts.get(name, 0)
        for name in source_counts
        if source_counts.get(name, 0) != target_counts.get(name, 0)
    }

    if missing:
        print("\nWARNING: counts do not match:")
        for name, diff in missing.items():
            print(f"  {name}: source has {diff} more row(s)")
        return 1

    print("\nAll row counts match. Migration looks complete.")
    return 0


def run_verify(source: Engine, target: Engine) -> int:
    source_counts = count_all(source)
    target_counts = count_all(target)

    print(f"Source: {mask_url(str(source.url))}")
    print(f"Target: {mask_url(str(target.url))}\n")
    print_counts("Source rows:", source_counts)
    print()
    print_counts("Target rows:", target_counts)

    ok = True
    for name in source_counts:
        if source_counts[name] != target_counts.get(name, 0):
            ok = False
            print(
                f"\nMISMATCH {name}: source={source_counts[name]} "
                f"target={target_counts.get(name, 0)}"
            )

    print("\nResult:", "OK — data matches" if ok else "FAILED — rerun the copy")
    return 0 if ok else 1


def run_benchmark(source: Engine, target: Engine) -> int:
    print("Measuring round-trip latency (lower is better)\n")

    for label, engine in (("source", source), ("target", target)):
        try:
            started = time.time()
            with engine.connect() as conn:
                conn.execute(text("select 1")).scalar()
            connect_ms = (time.time() - started) * 1000

            samples: list[float] = []
            with engine.connect() as conn:
                for _ in range(5):
                    started = time.time()
                    conn.execute(text("select 1")).scalar()
                    samples.append((time.time() - started) * 1000)
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f"{label:<7} {mask_url(str(engine.url))}\n        ERROR: {exc}")
            continue

        print(
            f"{label:<7} {mask_url(str(engine.url))}\n"
            f"        connect {connect_ms:6.0f} ms | "
            f"query min {min(samples):5.0f} ms | "
            f"avg {sum(samples) / len(samples):5.0f} ms | "
            f"max {max(samples):5.0f} ms"
        )

    return 0


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------
def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy the TSA school database to a new Supabase project.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--source", default=os.getenv("SOURCE_DATABASE_URL"))
    parser.add_argument("--target", default=os.getenv("TARGET_DATABASE_URL"))
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="only show how many rows exist in both databases",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete existing rows in the target before copying",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="compare row counts and exit with an error on mismatch",
    )
    parser.add_argument(
        "--benchmark",
        action="store_true",
        help="measure connection and query latency of both databases",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="skip the confirmation prompt used by --reset",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.source:
        print("ERROR: SOURCE_DATABASE_URL is missing (env var or --source).", file=sys.stderr)
        return 2
    if not args.target:
        print("ERROR: TARGET_DATABASE_URL is missing (env var or --target).", file=sys.stderr)
        return 2

    if normalized_identity(args.source) == normalized_identity(args.target):
        print(
            "ERROR: source and target point to the same database. Nothing to do.",
            file=sys.stderr,
        )
        return 2

    source = make_engine(args.source)
    target = make_engine(args.target)

    print(f"Source: {mask_url(args.source)}")
    print(f"Target: {mask_url(args.target)}")
    if is_pooler(args.source) or is_pooler(args.target):
        print("Pooler connection detected — prepared statements disabled where needed.")

    if args.benchmark:
        return run_benchmark(source, target)

    if args.verify:
        return run_verify(source, target)

    if args.dry_run:
        print()
        print_counts("Source rows:", count_all(source))
        print()
        print_counts("Target rows:", count_all(target))
        return 0

    return run_copy(source, target, reset=args.reset, assume_yes=args.yes)


if __name__ == "__main__":
    raise SystemExit(main())
