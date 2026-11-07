"""One-command assistant: move the site to a nearby Supabase project.

Run this after creating a new Supabase project in a nearby region:

    cd backend
    ../school/bin/python migrate_to_nearby.py

The script asks for the new project's details, checks which pooler host
answers, copies every row from the current database, verifies the result and
writes the new DATABASE_URL to ``backend/.env.render`` so it can be pasted into
Render.

Passwords are read with hidden input and are never printed in full.
"""

from __future__ import annotations

import getpass
import os
import sys
from urllib.parse import quote, urlsplit

import migrate_data as md

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_MIGRATE = os.path.join(BASE_DIR, ".env.migrate")
ENV_RENDER = os.path.join(BASE_DIR, ".env.render")

DEFAULT_OLD_POOLER_HOST = "aws-0-ap-southeast-2.pooler.supabase.com"
DEFAULT_NEW_REGION = "ap-south-1"


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def ask(text: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    answer = input(f"{text}{suffix}: ").strip()
    return answer or (default or "")


def ask_secret(text: str) -> str:
    while True:
        value = getpass.getpass(f"{text}: ")
        if value:
            return value
        print("  Password cannot be empty.")


def build_url(user: str, password: str, host: str, port: int = 6543,
              already_encoded: bool = False) -> str:
    pwd = password if already_encoded else quote(password, safe="")
    return (
        f"postgresql+psycopg://{user}:{pwd}@{host}:{port}/postgres"
        "?sslmode=require"
    )


def short_error(exc: Exception) -> str:
    first = str(exc).splitlines()[0]
    return first[:160] if first else exc.__class__.__name__


def project_ref(url: str) -> str | None:
    host = urlsplit(url).hostname or ""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2:] == ["supabase", "co"]:
        return parts[1]
    return None


def find_pooler_host(ref: str, password: str, region: str) -> tuple[str, str] | None:
    """Try both Supabase pooler generations and return the one that answers."""
    print("\nChecking the new project's pooler…")
    for prefix in ("aws-0", "aws-1"):
        host = f"{prefix}-{region}.pooler.supabase.com"
        url = build_url(f"postgres.{ref}", password, host)
        engine = md.make_engine(url)
        try:
            with engine.connect() as conn:
                conn.exec_driver_sql("select 1")
            print(f"  OK   {host}")
            return host, url
        except Exception as exc:  # noqa: BLE001 - try the next host
            print(f"  skip {host} ({short_error(exc)})")
        finally:
            engine.dispose()
    return None


def write_private_file(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    os.chmod(path, 0o600)


def mask(url: str) -> str:
    return md.mask_url(url)


# ---------------------------------------------------------------------------
# main flow
# ---------------------------------------------------------------------------
def main() -> int:
    print("=" * 68)
    print(" TSA School — move Supabase to a nearby region")
    print("=" * 68)
    print(
        "\nBefore you start, create the new project:\n"
        "  Supabase Dashboard -> New project -> Region: Mumbai (ap-south-1)\n"
        "  (or Singapore / ap-southeast-1)\n"
    )

    old_url = os.getenv("SOURCE_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not old_url:
        print("ERROR: DATABASE_URL is missing in backend/.env", file=sys.stderr)
        return 2

    ref = project_ref(old_url)
    if not ref:
        print("ERROR: could not read the current project ref from DATABASE_URL.", file=sys.stderr)
        return 2

    old_host = urlsplit(old_url).hostname or ""
    if "pooler.supabase.com" in old_host:
        source_url = old_url
        print(f"\nCurrent database (pooler): {mask(source_url)}")
    else:
        # Direct Supabase hosts are IPv6-only. The pooler works everywhere.
        print(f"\nCurrent database: {mask(old_url)}")
        pooler_host = ask(
            "Current project's pooler host",
            DEFAULT_OLD_POOLER_HOST,
        )
        source_url = build_url(
            f"postgres.{ref}",
            urlsplit(old_url).password or "",
            pooler_host,
            already_encoded=True,
        )

    print("\nNew project details (from Supabase -> Project Settings -> Database)")
    new_ref = ask("New project ref (the xxxx part of xxxx.supabase.co)")
    region = ask("New project region", DEFAULT_NEW_REGION)
    new_password = os.getenv("NEW_DB_PASSWORD") or ask_secret(
        "New database password (typing is hidden)"
    )

    if not new_ref:
        print("ERROR: project ref is required.", file=sys.stderr)
        return 2

    old_refs = {ref}
    source_user = urlsplit(source_url).username or ""
    if source_user.startswith("postgres."):
        old_refs.add(source_user.split(".", 1)[1])

    if new_ref in old_refs:
        print(
            "ERROR: the new project is the same as the current one. "
            "Create a new Supabase project first.",
            file=sys.stderr,
        )
        return 2

    found = find_pooler_host(new_ref, new_password, region)
    if not found:
        print(
            "\nERROR: could not reach the new project's pooler.\n"
            "Check the project ref, region and password, and make sure the\n"
            "project has finished provisioning in the Supabase dashboard.",
            file=sys.stderr,
        )
        return 1

    new_host, target_url = found

    source = md.make_engine(source_url)
    target = md.make_engine(target_url)

    print("\nLatency check")
    md.run_benchmark(source, target)

    print("\nRows in the current database")
    source_counts = md.count_all(source)
    md.print_counts("", source_counts)
    print(f"\nTarget: {mask(target_url)}")

    answer = input(
        "\nCopy everything now?\n"
        "The new project will be emptied first, then filled with this data. [y/N]: "
    ).strip().lower()
    if answer not in {"y", "yes"}:
        print("Aborted. Nothing was changed.")
        return 1

    code = md.run_copy(source, target, reset=True, assume_yes=True)
    if code != 0:
        print("\nCopy failed. The old database was not modified.", file=sys.stderr)
        return code

    code = md.run_verify(source, target)
    if code != 0:
        print("\nVerification failed. Do not switch Render yet.", file=sys.stderr)
        return code

    write_private_file(
        ENV_MIGRATE,
        "# Created by migrate_to_nearby.py — do not commit.\n"
        f"SOURCE_DATABASE_URL={source_url}\n"
        f"TARGET_DATABASE_URL={target_url}\n",
    )
    write_private_file(
        ENV_RENDER,
        "# Paste this line's value into Render -> Environment -> DATABASE_URL\n"
        f"DATABASE_URL={target_url}\n",
    )

    print("\n" + "=" * 68)
    print(" Migration complete")
    print("=" * 68)
    print("\nNext step — update Render:")
    print("  Render Dashboard -> your service -> Environment -> DATABASE_URL")
    print(f"  copy the value from: {ENV_RENDER}")
    print(f"  ({mask(target_url)})")
    print("\nThen click Manual Deploy and log in to check the site.")
    print("Keep the old project for a week before deleting it.")
    print("\nFiles written (both are git-ignored):")
    print(f"  {ENV_MIGRATE}")
    print(f"  {ENV_RENDER}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
        raise SystemExit(130)
