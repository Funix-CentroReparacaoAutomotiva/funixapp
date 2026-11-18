"""Offline HML candidate and recovery primitives.

No Docker, SSH, service mutation, extraction, or replacement of a live database.
Caller must establish trusted artifact provenance and quiesce HML before backup.
"""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import time
import tarfile


def verify_image_archive(archive, manifest, *, max_bytes=20 * 1024**3):
    """Inspect docker-save metadata without extracting or loading any image.

    Provenance must already have been authenticated independently. Reject
    extra tags, duplicate paths, links and config IDs not bound to manifest.
    """
    with tarfile.open(regular(archive), mode="r:gz") as bundle:
        members = {}
        total = 0
        for member in bundle:
            name = member.name
            require(name not in members and not name.startswith("/")
                    and ".." not in Path(name).parts, "unsafe archive path")
            require(member.isfile() or member.isdir(), "archive contains link or special file")
            total += member.size
            require(total <= max_bytes, "archive expansion limit exceeded")
            members[name] = member
        require("manifest.json" in members, "missing docker-save manifest")
        def read(name, limit):
            require(name in members and members[name].isfile()
                    and members[name].size <= limit, "invalid image metadata")
            stream = bundle.extractfile(members[name])
            require(stream is not None, "missing image metadata")
            with stream:
                return stream.read(limit + 1)
        records = json.loads(read("manifest.json", 65536))
        require(isinstance(records, list) and len(records) == 2,
                "unexpected archive image count")
        expected = {item["tag"]: item["image_id"]
                    for item in manifest["images"].values()}
        seen = set()
        for record in records:
            tags = record.get("RepoTags")
            require(isinstance(tags, list) and len(tags) == 1
                    and tags[0] in expected and tags[0] not in seen,
                    "unexpected or duplicate image tag")
            seen.add(tags[0])
            config = read(record["Config"], 4 * 1024**2)
            require("sha256:" + hashlib.sha256(config).hexdigest() == expected[tags[0]],
                    "archive image ID mismatch")
            metadata = json.loads(config)
            require(metadata.get("config", {}).get("Labels", {}).get(
                "org.opencontainers.image.revision") == manifest["revision"],
                "archive revision mismatch")
            require(isinstance(record.get("Layers"), list) and record["Layers"],
                    "missing image layers")
            for layer in record["Layers"]:
                require(layer in members and members[layer].isfile(), "missing image layer")
        require(seen == set(expected), "incomplete archive")
    return True


class Blocked(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise Blocked(reason)


def regular(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path,
            "noncanonical or relative path")
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
            "not a single-link regular file")
    return path


def sha256(path):
    with regular(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_candidate(directory, *, revision, pr, run_id, run_attempt):
    """Verify local package bytes and binding to independently obtained run metadata.

    Not an image signature, artifact authentication or permission to docker load.
    """
    path = Path(directory)
    require(path.is_absolute() and path.resolve(strict=True) == path
            and path.is_dir(), "invalid candidate directory")
    require({p.name for p in path.iterdir()} == {"manifest.json", "images.tar.gz"},
            "unexpected candidate contents")
    require(isinstance(revision, str) and re.fullmatch(r"[a-f0-9]{40}", revision),
            "bad revision")
    require(type(pr) is int and pr > 0, "bad PR")
    for value in (run_id, run_attempt):
        require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]*", value),
                "bad run identity")
    manifest_path = regular(path / "manifest.json")
    require(manifest_path.stat().st_size <= 16384, "manifest too large")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate manifest key")
            result[key] = value
        return result
    data = json.loads(manifest_path.read_text(encoding="utf-8"),
                      object_pairs_hook=unique)
    require(isinstance(data, dict) and set(data) == {
        "schema", "purpose", "revision", "pr", "run_id", "run_attempt",
        "archive_sha256", "images"}, "unknown manifest shape")
    require(type(data["schema"]) is int and data["schema"] == 1
            and data["purpose"] == "hml-candidate-only", "wrong manifest scope")
    require(type(data["pr"]) is int and data["pr"] == pr
            and (data["revision"], data["run_id"], data["run_attempt"])
            == (revision, run_id, run_attempt), "candidate identity mismatch")
    images = data["images"]
    require(isinstance(images, dict) and set(images) == {"api", "web"},
            "unexpected image set")
    for role, image in images.items():
        require(isinstance(image, dict) and set(image) == {"tag", "image_id"}
                and image["tag"] == f"funix-hml-{role}:{revision}"
                and isinstance(image["image_id"], str)
                and re.fullmatch(r"sha256:[0-9a-f]{64}", image["image_id"]),
                "invalid or out-of-scope image reference")
    require(images["api"]["image_id"] != images["web"]["image_id"],
            "API and Web must be distinct images")
    require(isinstance(data["archive_sha256"], str)
            and re.fullmatch(r"[0-9a-f]{64}", data["archive_sha256"])
            and sha256(path / "images.tar.gz") == data["archive_sha256"],
            "archive checksum mismatch")
    return data


def sidecars(path):
    return [Path(str(path) + suffix) for suffix in ("-wal", "-shm", "-journal")]


def no_sidecars(path):
    require(not any(p.exists() or p.is_symlink() for p in sidecars(path)),
            "unexpected SQLite sidecars")


def reserve(path):
    path = Path(path)
    parent = path.parent
    require(path.is_absolute() and parent.resolve(strict=True) == parent,
            "destination not canonical")
    info = parent.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700,
            "destination directory must be private (0700)")
    if path.exists() or path.is_symlink():
        raise FileExistsError("destination already exists")
    no_sidecars(path)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    os.close(fd)
    return path


def readonly(path):
    return sqlite3.connect(regular(path).as_uri() + "?mode=ro", uri=True, timeout=5)


def inspect(db):
    tables = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    require({"schema_migrations", "atendimentos", "scenarios",
             "budget_versions"}.issubset(tables), "not the expected FUNIX schema")
    versions = [row[0] for row in db.execute(
        "SELECT version FROM schema_migrations ORDER BY version")]
    require(bool(versions) and all(type(v) is int for v in versions)
            and versions == list(range(1, len(versions) + 1)),
            "incomplete migration history")
    require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)],
            "database integrity check failed")
    require(db.execute("PRAGMA foreign_key_check").fetchone() is None,
            "foreign key check failed")


def durable(path):
    for item in (path, path.parent):
        fd = os.open(item, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def snapshot(source, destination):
    """Create a consistent, standalone private backup, never overwrite.

    Caller must stop writes when this snapshot is intended for rollback.
    """
    original = regular(source)
    with closing(readonly(original)) as src:
        inspect(src)
        output = reserve(destination)
        try:
            deadline = time.monotonic() + 120
            def progress(status, remaining, total):
                require(time.monotonic() < deadline, "backup deadline exceeded")
            with closing(sqlite3.connect(output, timeout=5)) as dst:
                src.backup(dst, pages=256, progress=progress, sleep=0.05)
                require(dst.execute("PRAGMA journal_mode=DELETE").fetchone()
                        == ("delete",), "backup is not standalone")
                inspect(dst)
            no_sidecars(output)
            durable(output)
            return sha256(output)
        except BaseException:
            output.unlink(missing_ok=True)
            raise


def stage_restore(backup, destination, *, expected_sha256):
    """Rehearse recovery into a NEW file, not the live database."""
    source = regular(backup)
    no_sidecars(source)
    require(isinstance(expected_sha256, str)
            and re.fullmatch(r"[0-9a-f]{64}", expected_sha256)
            and sha256(source) == expected_sha256, "backup checksum mismatch")
    output = reserve(destination)
    try:
        with source.open("rb") as inp, output.open("wb") as out:
            shutil.copyfileobj(inp, out, 1024 * 1024)
        require(sha256(output) == expected_sha256, "restored bytes differ")
        with closing(readonly(output)) as db:
            inspect(db)
        no_sidecars(output)
        durable(output)
        return expected_sha256
    except BaseException:
        output.unlink(missing_ok=True)
        raise
