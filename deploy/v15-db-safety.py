#!/usr/bin/env python3
"""FUNIX V14 -> V15: backup SQLite e ensaio offline. Não faz deploy/restore produtivo."""
from __future__ import annotations
from contextlib import closing
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import sys
from urllib.parse import quote

VERSION = 14
TABLES = {"schema_migrations", "atendimentos", "scenarios", "budget_versions"}

class SafetyError(Exception):
    pass

def source_file(value: str) -> Path:
    p = Path(value)
    if not p.is_absolute():
        raise SafetyError("Origem deve ser caminho absoluto.")
    try:
        info = p.lstat()
    except FileNotFoundError as e:
        raise SafetyError("Arquivo inexistente: não criar banco vazio.") from e
    if not stat.S_ISREG(info.st_mode):
        raise SafetyError("Origem deve ser arquivo regular, sem symlink.")
    return p

def destination_file(value: str, source: Path) -> Path:
    p = Path(value)
    if not p.is_absolute() or p == source or p.exists() or p.is_symlink():
        raise SafetyError("Destino deve ser absoluto, novo e diferente da origem.")
    try:
        info = p.parent.lstat()
    except FileNotFoundError as e:
        raise SafetyError("Crie antes diretório de backup com permissão 0700.") from e
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise SafetyError("Diretório do backup deve pertencer ao operador e ter modo 0700.")
    return p

def readonly(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect("file:" + quote(str(path)) + "?mode=ro", uri=True, timeout=5)
    db.execute("PRAGMA query_only=ON")
    return db

def inspect(db: sqlite3.Connection) -> None:
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not TABLES.issubset(tables):
        raise SafetyError("Não é o banco FUNIX esperado.")
    versions = [r[0] for r in db.execute("SELECT version FROM schema_migrations ORDER BY version")]
    if versions != list(range(1, VERSION + 1)):
        raise SafetyError("Somente histórico completo até V14 é aceito.")
    if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
        raise SafetyError("Falha em integrity_check.")
    if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise SafetyError("Falha em foreign_key_check.")

def secure_new_file(p: Path) -> None:
    fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    os.close(fd)

def durable(p: Path) -> None:
    fd = os.open(p, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    fd = os.open(p.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def digest(p: Path) -> str:
    result = hashlib.sha256()
    with p.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()

def snapshot(source: str, destination: str) -> str:
    original = source_file(source)
    output = destination_file(destination, original)
    with closing(readonly(original)) as db:
        inspect(db)
        secure_new_file(output)
        try:
            with closing(sqlite3.connect(output, timeout=10)) as copy:
                db.backup(copy, pages=256, sleep=0.05)
            with closing(readonly(output)) as check:
                inspect(check)
            durable(output)
        except BaseException:
            output.unlink(missing_ok=True)
            raise
    return digest(output)

def rehearse(source: str, destination: str) -> str:
    original = source_file(source)
    output = destination_file(destination, original)
    with closing(readonly(original)) as db:
        inspect(db)
    secure_new_file(output)
    try:
        with original.open("rb") as inp, output.open("wb") as out:
            shutil.copyfileobj(inp, out, 1024 * 1024)
        with closing(readonly(output)) as db:
            inspect(db)
        if digest(original) != digest(output):
            raise SafetyError("Hash do ensaio diferente do backup.")
        durable(output)
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return digest(output)

def main() -> int:
    parser = argparse.ArgumentParser(description="FUNIX backup V14 e ensaio de restauração isolada")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "rehearse"):
        sub = commands.add_parser(name)
        sub.add_argument("source")
        sub.add_argument("destination")
    args = parser.parse_args()
    try:
        sha = snapshot(args.source, args.destination) if args.command == "backup" else rehearse(args.source, args.destination)
    except (SafetyError, OSError, sqlite3.Error) as exc:
        print("FUNIX_V15_FAILED: " + str(exc), file=sys.stderr)
        return 1
    print(f"FUNIX_V15_{args.command.upper()}_OK schema=V14 sha256={sha}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
