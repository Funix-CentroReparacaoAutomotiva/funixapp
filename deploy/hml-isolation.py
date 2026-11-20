"""Independent HML isolation checks based on the reviewed installation.

No environment values are printed. The caller supplies only the canonical HML
data directory and the two expected gateway mounts (normal or maintenance).
This is defense in depth, not sandboxing of malicious candidate code.
"""
from pathlib import Path
import re

PROJECT = "funix-hml"
ROLES = {"api", "web", "gateway"}
PRIVATE = "funix-hml_privada"
EDGE = "traefik_default"
LABELS = {
    "traefik.enable": "true",
    "traefik.docker.network": EDGE,
    "traefik.http.routers.funix-hml.rule": "Host(\x60hml.funix.com.br\x60)",
    "traefik.http.routers.funix-hml.entrypoints": "websecure",
    "traefik.http.routers.funix-hml.tls": "true",
    "traefik.http.routers.funix-hml.tls.certresolver": "letsencrypt",
    "traefik.http.routers.funix-hml.service": "funix-hml-gateway",
    "traefik.http.services.funix-hml-gateway.loadbalancer.server.port": "8080",
}
FLAGS = {
    "FUNIX_" + flag + "_ENABLED" for flag in (
        "CHAT_V20_LINKS", "CODA_RECONCILIATION", "DIAGNOSIS_QUOTE",
        "EVOLUTION_READ", "GMAIL_ANALYSIS", "GMAIL_INTAKE_DECISIONS",
        "GMAIL_INTAKE_INGEST", "GMAIL_INTAKE_STORAGE", "GMAIL_QUEUE_API",
        "GMAIL_QUEUE_STORAGE", "QUOTE", "UPDATES_CLARIFICATIONS",
        "UPDATES_DECISIONS", "UPDATES_INGEST", "UPDATES_STORAGE", "WHATSAPP_INGEST",
    )
}
FIXED = {"FUNIX_APP_ORIGIN": "https://hml.funix.com.br",
         "FUNIX_DATABASE_PATH": "/data/funix.sqlite",
         "FUNIX_API_HOST": "0.0.0.0", "FUNIX_API_PORT": "8787"}
EXTERNAL = re.compile(r"(?:TOKEN|PASSWORD|SECRET|API_KEY|ENDPOINT|PROXY|URL|WEBHOOK|CREDENTIAL|PRIVATE_KEY)", re.I)
FLAG = re.compile(r"^FUNIX_[A-Z0-9_]+_(?:ENABLED|ENABLE|ACTIVE|V2)$")
CILIA_PREVIEW = "FUNIX_CILIA_PREVIEW_ENABLED"
CILIA_WRITE = "FUNIX_CILIA_WRITE_ENABLED"



def require(ok, reason):
    if not ok:
        raise ValueError("HML isolation: " + reason)


def network_names(role):
    return {PRIVATE, EDGE} if role == "gateway" else {PRIVATE}


def labels(role, data):
    actual = {k: v for k, v in (data or {}).items() if k.startswith("traefik.")}
    require(actual == LABELS if role == "gateway"
            else actual in ({}, {"traefik.enable": "false"}), "unexpected routing labels")


def env_dict(raw):
    if isinstance(raw, list):
        result = {}
        for item in raw:
            key, sep, value = item.partition("=")
            require(bool(sep) and key not in result, "invalid or duplicate environment key")
            result[key] = value
        return result
    require(isinstance(raw, dict), "invalid environment")
    return raw


def environment(role, raw, revision):
    env = env_dict(raw)
    if role == "api":
        require(all(str(env.get(k)) == v for k, v in FIXED.items()), "API origin or storage differs")
        require(env.get("FUNIX_REVISION") == revision and re.fullmatch(r"[a-f0-9]{40}", revision),
                "API revision differs")
        password = env.get("FUNIX_OPERATOR_PASSWORD")
        require(isinstance(password, str) and 12 <= len(password) <= 256, "operator credential missing/invalid")
        require(all(str(env.get(flag)).lower() == "false" for flag in FLAGS), "required integration flag not disabled")
        # The Cilia preview is local-only. Its write gate is never permitted here.
        require(str(env.get(CILIA_WRITE, "false")).lower() in ("false", "0"),
                "Cilia write flag must remain disabled")
        require(str(env.get(CILIA_PREVIEW, "false")).lower() in ("true", "false", "0"),
                "invalid Cilia preview flag")
    for key, value in env.items():
        if value in ("", None):
            continue
        if role == "api" and key in set(FIXED) | {"FUNIX_REVISION", "FUNIX_OPERATOR_PASSWORD"}:
            continue
        if FLAG.fullmatch(key):
            require(role == "api" and (str(value).lower() in ("false", "0")
                    or (key == CILIA_PREVIEW and str(value) == "true")),
                    "integration flag enabled")
        else:
            require(not key.startswith("FUNIX_") and not EXTERNAL.search(key), "unexpected external configuration")
    return env


def hardening(role, service):
    require(service.get("read_only") is True and "ALL" in (service.get("cap_drop") or []),
            "missing rootfs or capability protection")
    require(any(opt in ("no-new-privileges", "no-new-privileges:true", "no-new-privileges=true")
                for opt in service.get("security_opt") or []), "missing no-new-privileges")
    for key in ("privileged", "ports", "network_mode", "build", "devices", "device_cgroup_rules",
                "cap_add", "volumes_from", "external_links", "links", "secrets", "configs"):
        require(not service.get(key), "unsafe Compose service option")
    for key in ("pid", "ipc", "uts", "userns_mode"):
        require(not str(service.get(key, "")).startswith(("host", "container:", "service:")),
                "shared host/container namespace")
    require(not service.get("extra_hosts") and not service.get("dns"), "unexpected name resolution override")
    for item in service.get("tmpfs") or []:
        require(isinstance(item, str) and item.split(":", 1)[0] == "/tmp", "unexpected tmpfs")
    labels(role, service.get("labels"))


def expected_binds(role, database, gateway_mounts):
    if role == "api":
        return {"/data": (str(database.parent), False)}
    if role == "gateway":
        return {target: (str(source), True) for target, source in gateway_mounts.items()}
    return {}


def check_mounts(role, mounts, database, gateway_mounts, *, live=False):
    actual = {}
    tmp = set()
    for mount in mounts:
        kind = mount.get("Type" if live else "type")
        target = mount.get("Destination" if live else "target")
        source = mount.get("Source" if live else "source")
        require(target not in actual and target not in tmp, "duplicate mount")
        if kind == "tmpfs":
            require(target == "/tmp" and not source, "unexpected tmpfs")
            tmp.add(target)
            continue
        require(kind == "bind" and source and Path(source).is_absolute()
                and Path(source).resolve() == Path(source), "unexpected mount type or path")
        if live:
            require(type(mount.get("RW")) is bool, "mount permission unknown")
            readonly = not mount["RW"]
        else:
            readonly = mount.get("read_only", False) is True
            # Compose's normalized JSON can omit false (zero-value) fields.
            # Only an existing, canonical, explicitly allowed source is valid.
            require(mount.get("bind", {}).get("create_host_path", False) is False,
                    "implicit host path creation")
            require(Path(source).exists(), "bind source missing")
        actual[target] = (source, readonly)
    require(actual == expected_binds(role, database, gateway_mounts), "unexpected bind mounts")


def compose(config, database, gateway_mounts, revision):
    require(config.get("name") == PROJECT and set(config.get("services", {})) == ROLES,
            "unexpected project or services")
    networks = config.get("networks", {})
    require(len(networks) == 2 and {n.get("name") for n in networks.values()} == {PRIVATE, EDGE},
            "unexpected network definitions")
    private = next(n for n in networks.values() if n.get("name") == PRIVATE)
    require(private.get("internal") is True and private.get("driver", "bridge") == "bridge",
            "private network is not internal bridge")
    for role, service in config["services"].items():
        hardening(role, service)
        physical = {networks[name]["name"] for name in service.get("networks", {})}
        require(physical == network_names(role), "unexpected configured networks")
        check_mounts(role, service.get("volumes", []), database, gateway_mounts)
        environment(role, service.get("environment") or {}, revision)


def runtime(records, config, database, gateway_mounts, release, private):
    actual = {}
    for item in records:
        cfg, host = item["Config"], item["HostConfig"]
        meta = cfg.get("Labels") or {}
        role = meta.get("com.docker.compose.service")
        require(meta.get("com.docker.compose.project") == PROJECT and role in ROLES
                and role not in actual and item.get("Name") == "/" + PROJECT + "-" + role + "-1",
                "unexpected live container")
        actual[role] = item["Id"]
        require(item.get("Image") == release[role] and item["State"].get("Running") is True,
                "live image or state differs")
        labels(role, meta)
        require(host.get("ReadonlyRootfs") is True and "ALL" in (host.get("CapDrop") or []),
                "live hardening differs")
        require(any(opt in ("no-new-privileges", "no-new-privileges:true", "no-new-privileges=true")
                    for opt in host.get("SecurityOpt") or []), "live no-new-privileges missing")
        for key in ("Privileged", "PortBindings", "PublishAllPorts", "Devices", "DeviceRequests",
                    "DeviceCgroupRules", "CapAdd", "VolumesFrom", "Links", "ExtraHosts", "Dns"):
            require(not host.get(key), "unsafe live host option")
        for key in ("NetworkMode", "PidMode", "IpcMode", "UTSMode", "UsernsMode"):
            require(not str(host.get(key, "")).startswith(("host", "container:", "service:")),
                    "live shared namespace")
        require(set(item["NetworkSettings"]["Networks"]) == network_names(role),
                "unexpected live networks")
        require(set(host.get("Tmpfs") or {}) <= {"/tmp"}, "unexpected live tmpfs")
        check_mounts(role, item.get("Mounts", []), database, gateway_mounts, live=True)
        env = environment(role, cfg.get("Env", []), release["revision"])
        declared = env_dict(config["services"][role].get("environment") or {})
        require(all(env.get(key) == str(value) for key, value in declared.items() if value is not None),
                "live environment differs from Compose")
    require(set(actual) == ROLES, "incomplete live project")
    require(private.get("Name") == PRIVATE and private.get("Driver") == "bridge"
            and private.get("Internal") is True and set(private.get("Containers") or {}) == set(actual.values()),
            "unexpected members or settings in private network")
