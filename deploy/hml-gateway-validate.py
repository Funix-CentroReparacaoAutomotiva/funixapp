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
import math
import socket
from datetime import datetime, timezone
import re
import ssl
import stat
import sys
from pathlib import Path
from typing import Any


SHA40 = re.compile(r"^[0-9a-f]{40}$")
HML_HOST = "hml.funix.com.br"


def probe_https(address: str, timeout: float = 6.0) -> dict[str, Any]:
    """One unauthenticated GET, strict TLS, explicit separation of TCP and SNI."""
    result: dict[str, Any] = {
        "time": datetime.now(timezone.utc).isoformat(),
        "target": address, "port": 443, "sni": HML_HOST,
        "host": HML_HOST, "stage": "tcp",
    }
    raw = None
    connection = None
    tls = None
    response = None
    try:
        raw = socket.create_connection((address, 443), timeout=timeout)
        result["tcp"] = "ok"
        result["stage"] = "tls"
        tls = ssl.create_default_context().wrap_socket(raw, server_hostname=HML_HOST)
        cert = tls.getpeercert()
        result.update(tls="ok", certificate="verified", protocol=tls.version(),
                      san=cert.get("subjectAltName", ()),
                      not_after=cert.get("notAfter"))
        result["stage"] = "http"
        connection = http.client.HTTPConnection(HML_HOST, 443, timeout=timeout)
        connection.sock = tls
        connection.request("GET", "/", headers={
            "Host": HML_HOST, "Connection": "close",
            "User-Agent": "funix-hml-https-diagnostic/1",
        })
        response = connection.getresponse()
        result.update(status=response.status,
                      basic_challenge=response.getheader("WWW-Authenticate", "").lower().startswith("basic "))
        # No body, cookies, arbitrary headers or exception text in the report.
        result["stage"] = "complete"
    except ssl.SSLCertVerificationError as error:
        result.update(category="certificate", verify_code=error.verify_code)
    except ssl.SSLError:
        result.update(category="tls")
    except (OSError, http.client.HTTPException) as error:
        result.update(category=result["stage"], error_type=type(error).__name__,
                      errno=getattr(error, "errno", None))
    finally:
        if response is not None:
            response.close()
        if connection is not None:
            connection.close()
        if tls is not None:
            tls.close()
        if raw is not None:
            raw.close()
    return result


def diagnose_https() -> int:
    """Observe loopback and every distinct A/AAAA result; never publish."""
    addresses = []
    failed = False
    try:
        answers = socket.getaddrinfo(HML_HOST, 443, type=socket.SOCK_STREAM)
        addresses = sorted({answer[4][0] for answer in answers})
        print(json.dumps({"stage": "dns", "host": HML_HOST, "addresses": addresses}), flush=True)
    except socket.gaierror as error:
        failed = True
        print(json.dumps({"stage": "dns", "category": "dns", "errno": error.errno}), flush=True)
    for address in dict.fromkeys(["127.0.0.1", *addresses]):
        observation = probe_https(address)
        print(json.dumps(observation), flush=True)
        failed |= "category" in observation
    # HTTP status is evidence, not an acceptance gate while gateway is absent.
    return int(failed)


class ValidationError(RuntimeError):
    pass


class DuplicateJsonKey(ValueError):
    pass


def release_revision(path: Path, key: str) -> str | None:
    try:
        content = path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValidationError(f"{path}: arquivo de ambiente nao e UTF-8 valido") from error
    # Split only the LF record separator. Any CR, space or other character in
    # the value remains observable and must fail revision validation later.
    prefix = key + "="
    values: list[str] = []
    for number, line in enumerate(content.split("\n"), 1):
        if not line.startswith(prefix):
            continue
        values.append(line[len(prefix):])
        if len(values) > 1:
            raise ValidationError(f"{path}:{number}: variavel duplicada: {key}")
    return values[0] if values else None


def basic_credentials(path: Path) -> tuple[str, str]:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise ValidationError(f"{path}: arquivo de credenciais invalido")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValidationError(f"{path}: credenciais devem estar inacessiveis para grupo/outros")
    fields: dict[str, str] = {}
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise ValidationError(f"{path}: arquivo de credenciais nao e UTF-8 valido") from error
    for raw in content.splitlines():
        if ": " in raw:
            name, value = raw.split(": ", 1)
            fields[name.strip().lower()] = value
    username = fields.get("usuario", "")
    password = fields.get("senha", "")
    if not username or not password:
        raise ValidationError(f"{path}: credenciais no formato Usuario/Senha nao encontradas")
    return username, password


def json_object(body: bytes, endpoint: str) -> dict[str, Any]:
    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise DuplicateJsonKey(key)
            result[key] = value
        return result

    try:
        value = json.loads(body, object_pairs_hook=unique_object)
    except DuplicateJsonKey as error:
        raise ValidationError(f"{endpoint}: resposta JSON contem chave duplicada: {error}") from error
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
    port: int | None,
    host_header: str,
    endpoint: str,
    credentials: tuple[str, str],
    timeout: float,
) -> dict[str, Any]:
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValidationError(f"timeout invalido: {timeout!r}")
    selected_port = port if port is not None else (443 if scheme == "https" else 8080)
    if selected_port < 1 or selected_port > 65535:
        raise ValidationError(f"porta invalida: {selected_port}")
    connection_class = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    connection = connection_class(
        connect_host,
        selected_port,
        timeout=timeout,
        context=ssl.create_default_context() if scheme == "https" else None,
    ) if scheme == "https" else connection_class(connect_host, selected_port, timeout=timeout)
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
    content_type = response.getheader("Content-Type", "").partition(";")[0].strip().lower()
    if content_type != "application/json":
        raise ValidationError(
            f"{endpoint}: Content-Type {content_type!r}, esperado 'application/json'"
        )
    return json_object(body, endpoint)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--diagnose-https", action="store_true",
                        help="Unauthenticated HML DNS/TCP/TLS/HTTP observations; no files read")
    result.add_argument("--release-env", type=Path)
    result.add_argument("--release-key", default="FUNIX_HML_REVISION")
    result.add_argument("--credentials-file", type=Path)
    result.add_argument("--scheme", choices=("http", "https"), default="http")
    result.add_argument("--connect-host")
    result.add_argument("--port", type=int)
    result.add_argument("--host-header", default="hml.funix.com.br")
    result.add_argument("--timeout", type=float, default=6.0)
    return result


def main() -> int:
    cli = parser()
    args = cli.parse_args()
    if args.diagnose_https:
        return diagnose_https()
    if not args.release_env or not args.credentials_file or not args.connect_host:
        cli.error("revision validation requires --release-env, --credentials-file and --connect-host")
    if args.scheme == "https" and args.connect_host != args.host_header:
        cli.error("HTTPS revision validation requires connect-host == host-header for SNI; use --diagnose-https for IP probes")
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
