import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'hml-cto-build-request.py'
spec = importlib.util.spec_from_file_location('hml_cto_build_request', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

SHA = '20a1a1561223a00ba4aec6290b55ddd9c0b52696'
COMMENT_ENV = {
    'GITHUB_REPOSITORY': module.REPO,
    'GITHUB_REF': 'refs/heads/main',
    'GITHUB_EVENT_NAME': 'issue_comment',
    'GITHUB_ACTOR': module.ACTOR,
    'HML_COMMENT_ACTOR': module.ACTOR,
    'HML_COMMENT_ASSOCIATION': 'OWNER',
    'HML_ISSUE_IS_PR': 'true',
    'HML_ISSUE_NUMBER': '341',
    'HML_COMMENT_BODY': '/hml-build-panel ' + SHA,
}


class BuildIntentTests(unittest.TestCase):
    def test_panel_command(self):
        self.assertEqual(module.validate(COMMENT_ENV),
                         {'pr': '341', 'revision': SHA, 'authorized': 'true', 'web_target': 'web-hml-painel'})

    def test_web_command(self):
        result = module.validate({**COMMENT_ENV, 'HML_COMMENT_BODY': '/hml-build-web ' + SHA})
        self.assertEqual(result['web_target'], 'web')

    def test_dispatch_contract_retained(self):
        env = {'GITHUB_REPOSITORY': module.REPO, 'GITHUB_REF': 'refs/heads/main',
               'GITHUB_EVENT_NAME': 'workflow_dispatch', 'HML_INPUT_AUTHORIZED': 'true',
               'HML_INPUT_PR': '341', 'HML_INPUT_REVISION': SHA, 'HML_INPUT_WEB_TARGET': 'web'}
        self.assertEqual(module.validate(env)['web_target'], 'web')

    def test_negative_comment_cases(self):
        cases = [
            {'GITHUB_REF': 'refs/pull/341/merge'}, {'GITHUB_REPOSITORY': 'other/repo'},
            {'GITHUB_ACTOR': 'untrusted'}, {'HML_COMMENT_ACTOR': 'untrusted'},
            {'HML_COMMENT_ASSOCIATION': 'COLLABORATOR'}, {'HML_ISSUE_IS_PR': 'false'},
            {'HML_ISSUE_NUMBER': '0'}, {'GITHUB_EVENT_NAME': 'pull_request'},
            {'HML_COMMENT_BODY': '/hml-build-panel abc'},
            {'HML_COMMENT_BODY': '/hml-build-panel ' + SHA + '\nother-command'},
            {'HML_COMMENT_BODY': '/hml-build-panel ' + SHA + ' '},
            {'HML_COMMENT_BODY': '/hml-deploy-panel ' + SHA},
        ]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(module.Denied):
                module.validate({**COMMENT_ENV, **case})

    def test_unauthorized_manual_dispatch(self):
        base = {'GITHUB_REPOSITORY': module.REPO, 'GITHUB_REF': 'refs/heads/main',
                'GITHUB_EVENT_NAME': 'workflow_dispatch', 'HML_INPUT_PR': '341',
                'HML_INPUT_REVISION': SHA, 'HML_INPUT_WEB_TARGET': 'web'}
        for case in ({'HML_INPUT_AUTHORIZED': 'false'}, {'HML_INPUT_AUTHORIZED': 'true', 'HML_INPUT_WEB_TARGET': 'api'}):
            with self.subTest(case=case), self.assertRaises(module.Denied):
                module.validate({**base, **case})


if __name__ == '__main__':
    unittest.main()
