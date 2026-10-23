"""Read-only collision checks. Called before installing any persistent files."""
import json
import sys


def validate(containers):
    for container in containers:
        labels = container.get('Config', {}).get('Labels') or {}
        if labels.get('com.docker.compose.project') == 'funixapp':
            raise ValueError('Projeto Compose funixapp já existe, inclusive parado.')
        for key, value in labels.items():
            if key.startswith('traefik.') and (
                '.funixapp-' in key or 'app.funix.com.br' in str(value).lower()
            ):
                raise ValueError('Conflito com router/service/domínio FUNIX em contêiner existente.')


if __name__ == '__main__':
    try:
        with open(sys.argv[1], encoding='utf-8') as source:
            validate(json.load(source))
    except (ValueError, KeyError, TypeError) as error:
        sys.exit(str(error))
