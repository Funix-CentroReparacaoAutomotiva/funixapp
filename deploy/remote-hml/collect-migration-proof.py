"""Collect a status body over the existing private mTLS route."""
import argparse
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import ssl
import stat
import sys

PRIVATE_NETWORKS = tuple(ipaddress.ip_network(value) for value in
                         ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'))
MAX_BODY = 32768


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate response field')
        result[key] = value
    return result


def collect(gateway, ca, certificate, key, *, probe, port=18443):
    address = ipaddress.IPv4Address(gateway)
    if not any(address in network for network in PRIVATE_NETWORKS):
        raise ValueError('private IPv4 required')
    key = Path(key)
    info = key.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError('private client key required')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_verify_locations(cafile=ca)
    context.load_cert_chain(certificate, key)
    connection = http.client.HTTPSConnection(str(address), port, context=context, timeout=8)
    try:
        connection.request('GET', '/v1/status')
        with connection.getresponse() as response:
            if response.status != 200 or response.headers.get_content_type() != 'application/json':
                raise ValueError('unexpected status response')
            body = response.read(MAX_BODY + 1)
    finally:
        connection.close()
    if len(body) > MAX_BODY:
        raise ValueError('response size')
    state = json.loads(body.decode('utf-8'), object_pairs_hook=unique)
    if (not isinstance(state, dict) or state.get('schema') != 'funix-hml-ops/1'
            or state.get('scope') != 'funix-hml' or state.get('status') != 'ok'
            or 'armed' not in state or state['armed'] is not None
            or 'last_request' not in state or not isinstance(state.get('journal'), dict)
            or state['journal'].get('phase') not in ('accepted', 'restored')):
        raise ValueError('unexpected operational state')
    last = state['last_request']
    if last is not None and (not isinstance(last, dict) or last.get('status') not in
                             ('accepted', 'auto_restored', 'blocked_before_journal')):
        raise ValueError('last request is not terminal')
    if probe:
        challenge = state.get('migration_probe')
        if not isinstance(challenge, str) or not re.fullmatch('[a-f0-9]{64}', challenge):
            raise ValueError('missing or invalid migration challenge')
    elif 'migration_probe' in state:
        raise ValueError('expected normal transport')
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('status', 'probe'))
    for name in ('gateway', 'ca', 'certificate', 'key'):
        parser.add_argument(name)
    args = parser.parse_args()
    try:
        if args.mode == 'probe' and not stat.S_ISFIFO(os.fstat(sys.stdout.fileno()).st_mode):
            raise ValueError('proof must be piped directly to the administrative channel')
        body = collect(args.gateway, args.ca, args.certificate, args.key, probe=args.mode == 'probe')
        if args.mode == 'probe':
            sys.stdout.buffer.write(body)
            sys.stdout.buffer.flush()
        else:
            print('HML mTLS status verified')
    except Exception:
        raise SystemExit('BLOCKED: HML mTLS status or evidence unavailable') from None


if __name__ == '__main__':
    main()
