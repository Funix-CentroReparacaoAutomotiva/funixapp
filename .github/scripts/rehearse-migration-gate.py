"""Run the migration gate and mTLS trial on the disposable systemd runner."""
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import time

assert os.geteuid() == 0 and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
assert Path("/proc/1/comm").read_text().strip() == "systemd"
source = Path("deploy/remote-hml")
spec = importlib.util.spec_from_file_location("migration", source / "migrate.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
run = migration.command
root = Path("/var/lib/funix-hml-ops")
directory = root / "migration"
tls = Path("/etc/funix-hml-ops")
assert not directory.exists() and not migration.GATE.exists() and not tls.exists()
target = root / "fixture-old.py"
new_module = root / "fixture-added.py"
target.write_text("old")
expected = migration.idle()

with tempfile.TemporaryDirectory() as tmp:
    workspace = Path(tmp)
    new = workspace / "new.py"
    new.write_text("new")
    mapping = {target:new,new_module:new}
    approval = {"old":migration.inventory(mapping),
                "new":{str(t):migration.digest(s) for t,s in mapping.items()}}
    record = migration.snapshot(mapping,directory,approval)
    migration.set_gate(directory)
    migration.persist(directory,record,"installing")
    migration.replace_code(new,target,record["modes"][str(target)])
    assert not new_module.exists()
    run("systemctl","daemon-reexec")
    run("systemctl","start",migration.TRANSPORT)
    assert run("systemctl","show","-p","MainPID","--value",migration.TRANSPORT) == "0"
    assert run("systemctl","show","-p","ConditionResult","--value",migration.TRANSPORT) == "no"
    assert migration.recover(mapping,directory,expected,lambda: None) == "restored"
    assert target.read_text() == "old" and not new_module.exists()
    print("FUNIX_MIGRATION_GATE_REEXEC_OK", flush=True)

    # A fresh, isolated synthetic operation after recovery of the first one.
    directory.rename(root / "migration-first-evidence")
    tls.mkdir(mode=0o750)
    run("chgrp","funix-hml-ops",str(tls))
    tls.chmod(0o750)
    cert = workspace / "client.crt"
    key = workspace / "client.key"
    subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-days","1",
                    "-subj","/CN=fixture","-addext","subjectAltName=IP:127.0.0.1",
                    "-keyout",str(key),"-out",str(cert)],check=True,capture_output=True)
    fp = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
    for name,data in (("ca.crt",cert.read_bytes()),("server.crt",cert.read_bytes()),
                      ("server.key",key.read_bytes()),("transport.json",json.dumps(
                          dict(source="127.0.0.1",gateway="127.0.0.1",port=18443,
                               client_fingerprint=fp)).encode())):
        path = tls / name
        path.write_bytes(data)
        path.chmod(0o640)
        run("chgrp","funix-hml-ops",str(path))
    # Replace only the test shim used by the earlier system boundary exercise.
    migration.durable_bytes(Path("/usr/local/lib/funix-hml-ops/transport.py"),
                            (source / "transport.py").read_bytes(),0o644)
    context = ssl.create_default_context(cafile=str(cert))
    context.load_cert_chain(cert,key)

    def request(method,path):
        connection = http.client.HTTPSConnection("127.0.0.1",18443,timeout=3,context=context)
        try:
            connection.request(method,path)
            reply = connection.getresponse()
            return reply.status,json.loads(reply.read())
        finally:
            connection.close()

    assert migration.begin(mapping,directory,approval,lambda: None) == "awaiting_probe"
    assert migration.open_probe(mapping,directory,expected) == "probing"
    for _ in range(20):
        try:
            status,proof = request("GET","/v1/status")
            break
        except ConnectionRefusedError:
            time.sleep(.15)
    else:
        raise RuntimeError("transient transport unavailable")
    assert status == 200 and "migration_probe" in proof
    assert request("POST","/v1/update")[0] == 404
    assert migration.accept(mapping,directory,proof,expected,lambda: None) == "accepted"
    migration.set_gate(directory)
    journal = Path("/var/lib/funix-hml/updater/op-fixture/operation.json")
    accepted_journal = journal.read_bytes()
    changed = json.loads(accepted_journal)
    changed["candidate"] = {"revision": "b"*40}
    journal.write_text(json.dumps(changed))
    try:
        migration.recover(mapping,directory,migration.idle(),lambda: None)
    except ValueError as error:
        assert str(error) == "operational state changed since acceptance probe"
    else:
        raise AssertionError("terminal recovery released a changed journal")
    assert (directory/"hold").is_file()
    assert run("systemctl","show","-p","MainPID","--value",migration.TRANSPORT) == "0"
    journal.write_bytes(accepted_journal)
    assert migration.recover(mapping,directory,migration.idle(),lambda: None) == "accepted"
    assert not (directory/"hold").exists()
    print("FUNIX_TERMINAL_RECOVERY_STATE_OK", flush=True)
    record = migration.current_record(mapping,directory)
    approval = {key:record[key] for key in ("id","old","new")}
    assert migration.rollback(mapping,directory,approval,expected,lambda: None) == "restored"
    assert target.read_text() == "old" and not new_module.exists()
    assert migration.idle() == expected
    print("FUNIX_MIGRATION_MTLS_PROBE_ROLLBACK_OK", flush=True)
