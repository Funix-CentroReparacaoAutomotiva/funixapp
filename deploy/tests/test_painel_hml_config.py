import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class NginxHMLVariantTest(unittest.TestCase):
    def test_hml_config_is_exact_extension_of_web_config(self):
        # Qualquer alteração futura na configuração normal exige revisão explícita da variante HML.
        ordinary=(ROOT/'deploy/nginx.conf').read_text()
        hml=(ROOT/'deploy/painel-hml-nginx.conf').read_text()
        lead='        # Rota estática exclusiva da imagem Web HML.'
        start=hml.index(lead)
        end=hml.index('        location / {',start)
        panel=hml[start:end]
        self.assertEqual(hml.replace(panel,''),ordinary)
        self.assertIn('application/javascript js mjs;',panel)
        self.assertIn('try_files $uri $uri/ =404;',panel)
        self.assertIn('location ^~ /painel/',panel)

if __name__=='__main__': unittest.main()
