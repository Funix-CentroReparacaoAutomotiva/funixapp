#!/usr/bin/env python3
"""Sanitized, read-only evidence about Traefik and the absent HML gateway."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ALLOWED_STATIC = (
    "providers.docker.watch", "providers.docker.exposedbydefault",
    "providers.docker.constraints", "providers.docker.endpoint",
    "entrypoints.web.address", "entrypoints.websecure.address",
    "certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint",
    "certificatesresolvers.letsencrypt.acme.storage",
)
LOG_CATEGORIES = {
    "docker_provider": re.compile(r"docker|provider", re.I),
    "router": re.compile(r"router|middleware|service", re.I),
    "acme": re.compile(r"acme|certificate|challenge|letsencrypt", re.I),
    "network": re.compile(r"network|endpoint|dial|connect", re.I),
}


class DiagnosticError(RuntimeError):
    pass


def run(command: list[str], allow_missing: bool = False, include_stderr: bool = False) -> str | None:
    completed = subprocess.run(command, text=True, capture_output=True, check=False)
    if completed.returncode:
        if allow_missing:
            return None
        raise DiagnosticError(f"command failed: {command[1] if len(command) > 1 else command[0]}")
    return completed.stdout + (completed.stderr if include_stderr else "")


def parse_utc(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise argparse.ArgumentTypeError("use an ISO-8601 timestamp with timezone") from error
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("timestamp must include timezone")
    return value


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()[:16]


def static_projection(inspect: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, str] = {}
    for argument in inspect.get("Args", []):
        if not isinstance(argument, str) or not argument.startswith("--"):
            continue
        key, separator, value = argument[2:].partition("=")
        if separator and key.lower() in ALLOWED_STATIC:
            found[key.lower()] = value
    for item in inspect.get("Config", {}).get("Env", []) or []:
        if not isinstance(item, str):
            continue
        key, separator, value = item.partition("=")
        normalized = key.lower().removeprefix("traefik_").replace("_", ".")
        if separator and normalized in ALLOWED_STATIC:
            found.setdefault(normalized, value)

    projected: dict[str, Any] = {}
    for key, value in sorted(found.items()):
        if key.endswith("constraints") or key.endswith("endpoint") or key.endswith("storage"):
            projected[key] = {"configured": True, "value_sha256_16": fingerprint(value)}
        else:
            projected[key] = value
    return projected


def compose_projection(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    labels: dict[str, str] = {}
    for match in re.finditer(r"(?m)^\s*-?\s*[\"']?(traefik\.[A-Za-z0-9_.-]+)\s*=\s*([^\n\"']+)", text):
        key, value = match.groups()
        value = value.strip().rstrip("\"'")
        if "basicauth.users" in key.lower():
            labels[key] = "<redacted>"
        elif key.startswith(("traefik.enable", "traefik.docker.network",
                             "traefik.http.routers.", "traefik.http.services.")):
            labels[key] = value
    return {
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        "labels": dict(sorted(labels.items())),
        "mentions_private_network": "funix-hml_privada" in text,
        "mentions_traefik_network": "traefik_default" in text,
        "mentions_host_port": bool(re.search(r"(?m)^\s*ports\s*:", text)),
    }


def log_projection(raw: str) -> dict[str, Any]:
    events = []
    counts = {name: 0 for name in LOG_CATEGORIES}
    for line in raw.splitlines():
        lowered = line.lower()
        if not any(word in lowered for word in ("error", "warn", "level=err", "level=warn")):
            continue
        categories = [name for name, pattern in LOG_CATEGORIES.items() if pattern.search(line)]
        if not categories:
            continue
        for category in categories:
            counts[category] += 1
        timestamp = re.match(
            r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))",
            line,
        )
        events.append({
            "time": timestamp.group(1) if timestamp else None,
            "categories": categories,
            "event_sha256_16": fingerprint(line),
        })
    return {"counts": counts, "events": events}


def collect(args: argparse.Namespace) -> dict[str, Any]:
    gateway = run(["docker", "container", "inspect", args.gateway_container], allow_missing=True)
    if gateway is not None:
        raise DiagnosticError("gateway must be absent")
    raw_inspect = run(["docker", "container", "inspect", args.traefik_container])
    assert raw_inspect is not None
    inspect = json.loads(raw_inspect)[0]
    mounts = inspect.get("Mounts", []) or []
    socket_mounts = [mount for mount in mounts if mount.get("Destination") == "/var/run/docker.sock"]
    networks = inspect.get("NetworkSettings", {}).get("Networks", {}) or {}
    network_raw = run(["docker", "network", "inspect", args.traefik_network])
    assert network_raw is not None
    logs = run(["docker", "logs", "--timestamps", "--since", args.since,
                "--until", args.until, args.traefik_container], include_stderr=True)
    assert logs is not None
    return {
        "gateway_absent": True,
        "traefik": {
            "running": inspect.get("State", {}).get("Running") is True,
            "image_digest": fingerprint(str(inspect.get("Image", ""))),
            "started_at": inspect.get("State", {}).get("StartedAt"),
            "docker_socket_mount": {
                "present": bool(socket_mounts),
                "read_write": any(mount.get("RW") is True for mount in socket_mounts),
            },
            "attached_to_expected_network": args.traefik_network in networks,
            "static_from_args_or_env": static_projection(inspect),
            "config_mount_destinations": sorted(
                mount.get("Destination") for mount in mounts
                if isinstance(mount.get("Destination"), str)
                and mount.get("Destination") != "/var/run/docker.sock"
            ),
        },
        "traefik_network_exists": bool(json.loads(network_raw)),
        "planned_gateway": compose_projection(args.gateway_compose),
        "log_window": {"since": args.since, "until": args.until, **log_projection(logs)},
        "limitations": [
            "static file contents and the Traefik API are not read",
            "an absent gateway cannot prove that funix-hml@docker was loaded",
            "historical effective container labels are unavailable after removal",
            "local inspection cannot prove external reachability of HTTP-01 port 80",
        ],
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--since", required=True, type=parse_utc)
    result.add_argument("--until", required=True, type=parse_utc)
    result.add_argument("--gateway-compose", required=True, type=Path)
    result.add_argument("--traefik-container", default="traefik")
    result.add_argument("--gateway-container", default="funix-hml-gateway-1")
    result.add_argument("--traefik-network", default="traefik_default")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        print(json.dumps(collect(args), ensure_ascii=False, indent=2, sort_keys=True))
    except (DiagnosticError, OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"FALHA: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
