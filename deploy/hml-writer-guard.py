"""Read-only Linux quiescence checks; exclusive trusted administration required.

A positive handle (even read-only) blocks. This is an observation, not a
kernel-enforced lock against processes that may open the database later.
"""
import os
from pathlib import Path
import stat


class WriterGuardError(RuntimeError):
    pass


def overlaps(source, data):
    """A directory bind can expose the DB through an ancestor or descendant."""
    source, data = Path(source).resolve(), Path(data).resolve()
    return source.is_relative_to(data) or data.is_relative_to(source)


def identities(data):
    data = Path(data)
    if not data.is_absolute() or data.resolve(strict=True) != data or not data.is_dir():
        raise WriterGuardError("noncanonical data directory")
    result = set()
    for suffix in ("", "-wal", "-shm", "-journal"):
        path = data / ("funix.sqlite" + suffix)
        try:
            s = path.lstat()
        except FileNotFoundError:
            if not suffix:
                raise WriterGuardError("database missing") from None
            continue
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
            raise WriterGuardError("unexpected database file type or link count")
        result.add((os.major(s.st_dev), os.minor(s.st_dev), s.st_ino))
    return result


def scan_process(process, data, files):
    """Inspect fd identities and file-backed mappings; never read DB contents."""
    try:
        for fd in (process / "fd").iterdir():
            try:
                s = fd.stat()
            except FileNotFoundError:
                continue  # descriptor closed during scan
            if (os.major(s.st_dev), os.minor(s.st_dev), s.st_ino) in files:
                raise WriterGuardError("database handle open")
        with (process / "maps").open() as mappings:
            for line in mappings:
                fields = line.split(maxsplit=5)
                if len(fields) < 5:
                    raise WriterGuardError("unrecognized memory mapping")
                major, minor = (int(part, 16) for part in fields[3].split(":"))
                if (major, minor, int(fields[4])) in files:
                    raise WriterGuardError("database mapping active")
                if len(fields) == 6:
                    path = fields[5].rstrip("\n").removesuffix(" (deleted)")
                    if path.startswith(str(data) + "/"):
                        raise WriterGuardError("data-directory mapping active")
    except ProcessLookupError:
        return  # process exited
    except FileNotFoundError:
        if process.exists():
            raise WriterGuardError("process inspection incomplete") from None
    except (OSError, ValueError):
        raise WriterGuardError("process inspection incomplete") from None


def assert_quiescent(data):
    """Run on the Linux host after stopping HML; fail closed on incomplete access."""
    if os.geteuid() != 0:
        raise WriterGuardError("host writer inspection requires root")
    data = Path(data)
    files = identities(data)
    proc = Path("/proc")
    if not (proc / "self" / "fd").is_dir():
        raise WriterGuardError("Linux procfs unavailable")
    for process in proc.iterdir():
        if process.name.isdecimal():
            scan_process(process, data, files)
    if identities(data) != files:
        raise WriterGuardError("database files changed during inspection")
