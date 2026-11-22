from pathlib import Path
import re,json
root=Path(__file__).resolve().parent
html=(root/'index.html').read_text()
css=(root/'styles.css').read_text()
model=(root/'model.mjs').read_text()
app=(root/'app.mjs').read_text()
snapshot=(root/'snapshot.json').read_text()
# Static standalone renders embedded snapshot without a server; when hosted, index.html uses external snapshot.json.
html=re.sub(r'\s*<meta http-equiv="Content-Security-Policy"[^>]*>', '',html)
html=html.replace('<link rel="stylesheet" href="./styles.css">',f'<style>\n{css}\n</style>')
html=html.replace('<script type="module" src="./app.mjs"></script>', '')
model=model.replace('export const','const').replace('export function','function')
app=app.replace("import {validateSnapshot,childrenOf,recordsOf,branchOf,metrics,STATUS_LABEL,KIND_LABEL,stateOfRecord,repoUrl} from './model.mjs';",'')
# This replacement stays literal data, not executable: encode < to prevent a closing script injection.
snapshot=json.dumps(json.loads(snapshot),ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
html=html.replace('</body>',f'<script type="application/json" id="embedded-snapshot">{snapshot}</script>\n<script type="module">\n{model}\n{app}\n</script>\n</body>')
(root/'FUNIX_Painel_Orquestracao_Funcional.html').write_text(html)
print('Standalone:',(root/'FUNIX_Painel_Orquestracao_Funcional.html').stat().st_size)