import asyncio
import hashlib
from pathlib import Path

import asyncpg
from app.config import get_settings

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"


async def migrate() -> None:
    database_url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    connection = await asyncpg.connect(database_url)
    try:
        await connection.execute(
            """
            create schema if not exists auth;
            create table if not exists auth.users (id uuid primary key);
            do $$
            begin
              if not exists (select 1 from pg_roles where rolname = 'authenticated') then
                create role authenticated;
              end if;
            end
            $$;
            create or replace function auth.uid()
            returns uuid
            language sql
            stable
            as 'select null::uuid';
            create table if not exists public.local_schema_migrations (
              name text primary key,
              checksum text not null,
              applied_at timestamptz not null default now()
            );
            """
        )
        for path in sorted(MIGRATIONS.glob("*.sql")):
            sql = path.read_text()
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            existing = await connection.fetchval(
                "select checksum from public.local_schema_migrations where name = $1",
                path.name,
            )
            if existing == checksum:
                print(f"already applied: {path.name}")
                continue
            if existing is not None:
                raise RuntimeError(f"Applied migration changed: {path.name}")
            async with connection.transaction():
                await connection.execute(sql)
                await connection.execute(
                    "insert into public.local_schema_migrations (name, checksum) values ($1, $2)",
                    path.name,
                    checksum,
                )
            print(f"applied: {path.name}")
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(migrate())
