"""Content identity independent of Docker's classic/containerd display ID."""
import hashlib
import gzip
import json
import re
from pathlib import Path
import subprocess
import tarfile
import tempfile


def verify_saved_image(path, *, tag, config_digest):
    with tarfile.open(path, "r:*") as archive:
        members = {}
        for member in archive:
            if (member.name in members or member.name.startswith("/")
                    or ".." in Path(member.name).parts
                    or not (member.isfile() or member.isdir())):
                raise ValueError("unsafe saved image")
            members[member.name] = member
        def read(name, limit):
            item = members.get(name)
            if item is None or not item.isfile() or item.size > limit:
                raise ValueError("invalid saved image metadata")
            with archive.extractfile(item) as stream:
                return stream.read()
        records = json.loads(read("manifest.json", 65536))
        if (not isinstance(records, list) or len(records) != 1
                or (records[0].get("RepoTags") not in (None, []) if tag is None
                    else records[0].get("RepoTags") != [tag])):
            raise ValueError("unexpected saved image selection")
        record = records[0]
        config = read(record["Config"], 4 * 1024**2)
        if "sha256:" + hashlib.sha256(config).hexdigest() != config_digest:
            raise ValueError("image configuration digest mismatch")
        metadata = json.loads(config)
        diffs = metadata.get("rootfs", {}).get("diff_ids")
        layers = record.get("Layers")
        if not isinstance(diffs, list) or not diffs or not isinstance(layers, list) or len(diffs) != len(layers):
            raise ValueError("image layers missing")
        for name, expected in zip(layers, diffs):
            member = members.get(name)
            if member is None or not member.isfile():
                raise ValueError("image layer missing")
            with archive.extractfile(member) as stream:
                magic = stream.read(2)
                stream.seek(0)
                if magic == b"\x1f\x8b":
                    with gzip.GzipFile(fileobj=stream) as uncompressed:
                        actual = "sha256:" + hashlib.file_digest(uncompressed, "sha256").hexdigest()
                else:
                    actual = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
            if actual != expected:
                raise ValueError("image layer digest mismatch")
        return metadata


def verify_local_image(tag, config_digest, *, directory):
    """Export only the selected image; no retagging, loading or global mutation."""
    result = subprocess.run(["docker", "image", "inspect", tag], capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError("unable to inspect selected image")
    records = json.loads(result.stdout)
    if len(records) != 1 or not re.fullmatch(r"sha256:[0-9a-f]{64}", records[0].get("Id", "")):
        raise ValueError("ambiguous selected image")
    selected_id = records[0]["Id"]
    with tempfile.TemporaryDirectory(prefix="identity-", dir=directory) as temporary:
        path = Path(temporary) / "image.tar"
        result = subprocess.run(["docker", "image", "save", "--output", str(path), selected_id],
                                capture_output=True, timeout=180)
        if result.returncode:
            raise ValueError("unable to export selected image")
        verify_saved_image(path, tag=None, config_digest=config_digest)
    return selected_id
