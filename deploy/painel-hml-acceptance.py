#!/usr/bin/env python3
"""Verificação externa de HML /painel: sem escrita, sem SSH, sem alterar o gateway.

Pré-implantação: exige 401 sem credenciais em TODAS as rotas.
Aceite: exige também HTTPS/200 e conteúdo do painel com credenciais já provisionadas.
Recusa redirects, inclusive para evitar reenvio de Authorization a outra origem.
"""
import argparse
import base64
import http.client
import json
import os
import ssl
import sys

HOST = 'hml.funix.com.br'
PATHS = ('/painel/', '/painel/index.html', '/painel/styles.css',
         '/painel/app.mjs', '/painel/model.mjs', '/painel/snapshot.json')
EXPECTED = {
    '/painel/': b'ORQUESTRA',
    '/painel/index.html': b'ORQUESTRA',
    '/painel/styles.css': b'body',
    '/painel/app.mjs': b'snapshot.json',
    '/painel/model.mjs': b'validateSnapshot',
    '/painel/snapshot.json': b'"schemaVersion"',
}


def get(path, authorization=None, *, connector=None):
    connection = (connector or http.client.HTTPSConnection)(
        HOST, timeout=8, context=ssl.create_default_context())
    headers = {'Accept': 'text/html,application/json,text/css,application/javascript'}
    if authorization:
        headers['Authorization'] = authorization
    try:
        connection.request('GET', path, headers=headers)
        response = connection.getresponse()
        # Limite deliberado para não consumir dados desconhecidos do servidor.
        body = response.read(1_000_001)
        if len(body) > 1_000_000:
            raise ValueError('Resposta excede 1 MB')
        return response.status, dict(response.getheaders()), body
    finally:
        connection.close()


def check(mode, *, connector=None, username=None, password=None):
    for path in PATHS:
        status, headers, _ = get(path, connector=connector)
        if status != 401 or not any(k.lower() == 'www-authenticate' and 'basic' in v.lower()
                                    for k, v in headers.items()):
            raise ValueError(f'{path}: acesso sem autenticação não bloqueado (HTTP {status})')
    if mode == 'preflight':
        return
    if not username or not password:
        raise ValueError('Credenciais de HML não disponíveis no ambiente local')
    auth = 'Basic ' + base64.b64encode(f'{username}:{password}'.encode()).decode('ascii')
    for path in PATHS:
        status, headers, body = get(path, authorization=auth, connector=connector)
        if status != 200:
            raise ValueError(f'{path}: autenticado retornou HTTP {status}')
        if EXPECTED[path].lower() not in body.lower():
            raise ValueError(f'{path}: conteúdo não corresponde ao painel')
        if path.endswith('.json'):
            record = json.loads(body)
            if record.get('schemaVersion') != 1:
                raise ValueError('Snapshot incompatível')


def main():
    parser = argparse.ArgumentParser(description='Verificação somente leitura do painel HML')
    parser.add_argument('--mode', choices=['preflight', 'accept'], required=True)
    mode = parser.parse_args().mode
    # Credenciais somente por variáveis locais. Nunca colocar senha em argumentos ou logs.
    try:
        check(mode, username=os.environ.get('FUNIX_HML_BASIC_USER'),
              password=os.environ.get('FUNIX_HML_BASIC_PASSWORD'))
    except Exception as err:
        print(f'PAINEL_HML_{mode.upper()}_BLOCKED: {type(err).__name__}: {err}', file=sys.stderr)
        return 1
    print(f'PAINEL_HML_{mode.upper()}_OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
