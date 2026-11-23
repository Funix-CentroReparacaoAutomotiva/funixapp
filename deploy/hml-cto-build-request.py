#!/usr/bin/env python3
"""HML candidate build request validator: no deployment or elevated credentials."""
import os
import re
import sys

REPO = 'Funix-CentroReparacaoAutomotiva/funixapp'
ACTOR = 'Funix-CentroReparacaoAutomotiva'
COMMENT = re.compile(r'\A/hml-build-(panel|web) ([a-f0-9]{40})\Z')
SHA = re.compile(r'\A[a-f0-9]{40}\Z')
PR = re.compile(r'\A[1-9][0-9]{0,9}\Z')


class Denied(ValueError):
    pass


def validate(env):
    if env.get('GITHUB_REPOSITORY', '').lower() != REPO.lower() or env.get('GITHUB_REF') != 'refs/heads/main':
        raise Denied('trusted_main_required')
    event = env.get('GITHUB_EVENT_NAME')
    if event == 'workflow_dispatch':
        if env.get('HML_INPUT_AUTHORIZED') != 'true':
            raise Denied('manual_authorization_required')
        number = env.get('HML_INPUT_PR', '')
        revision = env.get('HML_INPUT_REVISION', '')
        target = env.get('HML_INPUT_WEB_TARGET', '')
        if target not in ('web', 'web-hml-painel'):
            raise Denied('target_invalid')
    elif event == 'issue_comment':
        if env.get('HML_COMMENT_ACTOR') != ACTOR or env.get('GITHUB_ACTOR') != ACTOR:
            raise Denied('comment_actor_untrusted')
        if env.get('HML_COMMENT_ASSOCIATION') != 'OWNER' or env.get('HML_ISSUE_IS_PR') != 'true':
            raise Denied('not_an_owner_pr_comment')
        match = COMMENT.fullmatch(env.get('HML_COMMENT_BODY', ''))
        if not match:
            raise Denied('command_not_allowed')
        number = env.get('HML_ISSUE_NUMBER', '')
        revision = match.group(2)
        target = 'web-hml-painel' if match.group(1) == 'panel' else 'web'
    else:
        raise Denied('unsupported_event')
    if not PR.fullmatch(number) or not SHA.fullmatch(revision):
        raise Denied('pr_or_sha_invalid')
    return {'pr': number, 'revision': revision, 'authorized': 'true', 'web_target': target}


def main():
    try:
        data = validate(os.environ)
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf8') as fh:
            for key, value in data.items():
                fh.write(f'{key}={value}\n')
        print('HML build request validated. Artifact only; no deploy.')
        return 0
    except (Denied, OSError, KeyError):
        print('BLOCKED: invalid or unauthorized HML build request', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
