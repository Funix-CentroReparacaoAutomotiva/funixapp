#!/usr/bin/env python3
"""Offline V17 -> V18 SQLite preflight. No deploy or mutation of the source."""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import sys
from urllib.parse import quote

VERSION = 17
TABLES = {"schema_migrations","atendimentos","scenarios","budget_versions","budget_document_identity"}

class SafetyError(Exception):
    pass

def existing_file(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise SafetyError("Exige caminho absoluto.")
    try:
        metadata = path.lstat()
    except FileNotFoundError as e:
        raise SafetyError("SQLite inexistente: não criar um banco vazio.") from e
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise SafetyError("Exige arquivo regular, sem symlink.")
    return path

def new_destination(value: str, source: Path) -> Path:
    path = Path(value)
    if not path.is_absolute() or path == source or path.exists() or path.is_symlink():
        raise SafetyError("Destino deve ser absoluto, novo e diferente da origem.")
    try:
        parent = path.parent.lstat()
    except FileNotFoundError as e:
        raise SafetyError("Crie primeiro diretório de backup privado 0700.") from e
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
        raise SafetyError("Diretório deve pertencer ao executor e ter permissão 0700.")
    return path

def readonly(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect("file:" + quote(str(path)) + "?mode=ro", uri=True, timeout=10)
    conn.execute("PRAGMA query_only=ON")
    return conn

def inspect_schema(conn: sqlite3.Connection) -> None:
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not TABLES.issubset(tables):
        raise SafetyError("Estrutura SQLite inesperada para o FunixApp.")
    versions = [int(r[0]) for r in conn.execute("SELECT version FROM schema_migrations ORDER BY version")]
    if versions != list(range(1, VERSION + 1)):
        raise SafetyError("Exige V17 completo; interrompa e verifique a versão real.")
    if conn.execute("PRAGMA integrity_check").fetchone() != ("ok",):
        raise SafetyError("Falha em integrity_check.")
    if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise SafetyError("Falha em foreign_key_check.")

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def create_private_file(path: Path) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os,"O_NOFOLLOW",0), 0o600)
    os.close(fd)

def sync_file_and_parent(path: Path) -> None:
    with path.open("rb") as stream:
        os.fsync(stream.fileno())
    fd = os.open(path.parent,os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def inspect(source: str) -> None:
    with closing(readonly(existing_file(source))) as db:
        inspect_schema(db)

def backup(source: str, destination: str) -> str:
    src = existing_file(source)
    dst = new_destination(destination,src)
    with closing(readonly(src)) as db:
        inspect_schema(db)
        create_private_file(dst)
        try:
            # SQLite backup API captures committed WAL, unlike a live cp.
            with closing(sqlite3.connect(dst,timeout=10)) as copy:
                db.backup(copy,pages=256,sleep=0.05)
            with closing(readonly(dst)) as check:
                inspect_schema(check)
            sync_file_and_parent(dst)
        except BaseException:
            dst.unlink(missing_ok=True)
            raise
    return sha256(dst)

def rehearse(source: str, destination: str) -> str:
    src = existing_file(source)
    dst = new_destination(destination,src)
    with closing(readonly(src)) as db:
        inspect_schema(db)
    create_private_file(dst)
    try:
        with src.open("rb") as inp, dst.open("wb") as out:
            shutil.copyfileobj(inp,out,1024*1024)
        with closing(readonly(dst)) as check:
            inspect_schema(check)
        if sha256(src) != sha256(dst):
            raise SafetyError("Hash de recuperação não coincide.")
        sync_file_and_parent(dst)
    except BaseException:
        dst.unlink(missing_ok=True)
        raise
    return sha256(dst)

def main() -> int:
    parser = argparse.ArgumentParser(description="FUNIX V18: inspecionar/guardar V17 sem alterar origem")
    subs = parser.add_subparsers(dest="command",required=True)
    subs.add_parser("inspect").add_argument("source")
    for name in ("backup","rehearse"):
        sub = subs.add_parser(name)
        sub.add_argument("source")
        sub.add_argument("destination")
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            inspect(args.source)
            print("FUNIX_V18_INSPECT_OK schema=V17")
        else:
            digest = backup(args.source,args.destination) if args.command=="backup" else rehearse(args.source,args.destination)
            print(f"FUNIX_V18_{args.command.upper()}_OK schema=V17 sha256={digest}")
    except (SafetyError,OSError,sqlite3.Error) as error:
        print("FUNIX_V18_PREFLIGHT_FAILED: "+str(error),file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
