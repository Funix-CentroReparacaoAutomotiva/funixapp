#!/usr/bin/env python3
"""Validate the two revision contracts exposed through the HML gateway.

This program is deliberately read-only.  It does not call Docker, change
Traefik, or start/stop any service.  Credentials are read from a protected
file and are never printed.
"""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import re
import ssl
import stat
import sys
from pathlib import Path
from typing import Any


SHA40 = re.compile(r"^[0-9a-f]{40}$")


class ValidationError(RuntimeError):
    pass


def release_revision(path: Path, key: str) -> str:
    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValidationError(f"{path}:{number}: linha de ambiente invalida")
        name, value = line.split("=", 1)
        if name in values:
            raise ValidationError(f"{path}:{number}: variavel duplicada: {name}")
        values[name] = value
    revision = values.get(key, "")
    if not SHA40.fullmatch(revision):
        raise ValidationError(f"{path}: {key} deve conter um SHA-1 completo em minusculas")
    return revision


def basic_credentials(path: Path) -> tuple[str, str]:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise ValidationError(f"{path}: arquivo de credenciais invalido")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValidationError(f"{path}: credenciais devem estar inacessiveis para grupo/outros")
    fields: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        if ": " in raw:
            name, value = raw.split(": ", 1)
            fields[name.strip().lower()] = value
    username = fields.get("usuario", "")
    password = fields.get("senha", "")
    if not username or not password:
        raise ValidationError(f"{path}: credenciais no formato Usuario/Senha nao encontradas")
    return username, password


def json_object(body: bytes, endpoint: str) -> dict[str, Any]:
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"{endpoint}: resposta nao e JSON valido") from error
    if not isinstance(value, dict):
        raise ValidationError(f"{endpoint}: resposta JSON deve ser um objeto")
    return value


def revision_diagnostics(release: Any, api: Any, web: Any) -> list[str]:
    """Render complete, non-secret evidence before making any assertion."""
    values = (("release.env", release), ("/api/ready", api), ("/release.json", web))
    lines = []
    for source, value in values:
        length = len(value) if isinstance(value, str) else "n/a"
        lines.append(
            f"revision source={source} type={type(value).__name__} "
            f"length={length} value={value!r}"
        )
    lines.append(
        "revision comparisons "
        f"api==release:{api == release} "
        f"web==release:{web == release} "
        f"api==web:{api == web}"
    )
    return lines


def validate_revisions(release: Any, api: Any, web: Any) -> None:
    invalid = [
        source
        for source, value in (
            ("release.env", release),
            ("/api/ready", api),
            ("/release.json", web),
        )
        if not isinstance(value, str) or not SHA40.fullmatch(value)
    ]
    if invalid:
        raise ValidationError("revisao ausente ou invalida em: " + ", ".join(invalid))
    divergent = [
        source
        for source, value in (("/api/ready", api), ("/release.json", web))
        if value != release
    ]
    if divergent:
        raise ValidationError("revisao divergente de release.env em: " + ", ".join(divergent))


def validate_api_contract(payload: dict[str, Any]) -> None:
    contract = {"status": "ready", "source": "app", "storage": "sqlite"}
    differences = {
        key: (expected_value, payload.get(key))
        for key, expected_value in contract.items()
        if payload.get(key) != expected_value
    }
    if differences:
        raise ValidationError(f"/api/ready: contrato de prontidao invalido: {differences!r}")


def request_json(
    scheme: str,
    connect_host: str,
    port: int,
    host_header: str,
    endpoint: str,
    credentials: tuple[str, str],
    timeout: float,
) -> dict[str, Any]:
    connection_class = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    connection = connection_class(
        connect_host,
        port,
        timeout=timeout,
        context=ssl.create_default_context() if scheme == "https" else None,
    ) if scheme == "https" else connection_class(connect_host, port, timeout=timeout)
    token = base64.b64encode(f"{credentials[0]}:{credentials[1]}".encode()).decode("ascii")
    try:
        connection.request(
            "GET",
            endpoint,
            headers={
                "Host": host_header,
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
                "User-Agent": "funix-hml-revision-validator/1",
            },
        )
        response = connection.getresponse()
        body = response.read(100_001)
    except (OSError, http.client.HTTPException) as error:
        raise ValidationError(f"{endpoint}: falha HTTP: {error}") from error
    finally:
        connection.close()
    if len(body) > 100_000:
        raise ValidationError(f"{endpoint}: resposta excede 100000 bytes")
    if response.status != 200:
        raise ValidationError(f"{endpoint}: HTTP {response.status}, esperado 200")
    return json_object(body, endpoint)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--release-env", type=Path, required=True)
    result.add_argument("--release-key", default="FUNIX_RELEASE")
    result.add_argument("--credentials-file", type=Path, required=True)
    result.add_argument("--scheme", choices=("http", "https"), default="http")
    result.add_argument("--connect-host", required=True)
    result.add_argument("--port", type=int, default=8080)
    result.add_argument("--host-header", default="hml.funix.com.br")
    result.add_argument("--timeout", type=float, default=6.0)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        expected = release_revision(args.release_env, args.release_key)
        credentials = basic_credentials(args.credentials_file)
        api_data = request_json(
            args.scheme,
            args.connect_host,
            args.port,
            args.host_header,
            "/api/ready",
            credentials,
            args.timeout,
        )
        web_data = request_json(
            args.scheme,
            args.connect_host,
            args.port,
            args.host_header,
            "/release.json",
            credentials,
            args.timeout,
        )
        api_revision = api_data.get("revision")
        web_revision = web_data.get("revision")
        for line in revision_diagnostics(expected, api_revision, web_revision):
            print(line, flush=True)
        validate_revisions(expected, api_revision, web_revision)
        validate_api_contract(api_data)
        print("revisions: OK", flush=True)
    except (OSError, ValidationError) as error:
        print(f"FALHA: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
