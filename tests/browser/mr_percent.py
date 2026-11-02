"""Compatibility adapter for regression scenarios written for the former MR selector.
Normal positive MRs exercise the new UI. Missing/reduction legacy records are seeded
through the existing authenticated API, then reopened to verify legacy reading.
"""
from decimal import Decimal
import re
from playwright.async_api import expect
from m1_atendimentos import ORIGIN
async def select_mr(finance,identity):
 page=finance.page
 r=await page.context.request.get(ORIGIN+'/api/precificacao');assert r.ok
 config=(await r.json())['config'];option=next((o for o in config.get('resaleMultipliers',[])if o['id']==identity),None)
 factor=option.get('factor')if option else None
 if factor is not None and Decimal(factor)>=1:
  percent=format((Decimal(factor)-1)*100,'f').rstrip('0').rstrip('.')if '.'in format((Decimal(factor)-1)*100,'f')else format((Decimal(factor)-1)*100,'f')
  field=finance.get_by_label('MR',exact=True);await expect(field).to_be_enabled();await field.fill(percent);await field.press('Enter');return
 at=re.search(r'/atendimentos/([^/?]+)',page.url)[1];path=ORIGIN+'/api/atendimentos/'+at+'/parametros';r=await page.context.request.get(path);s=await r.json()
 r=await page.context.request.patch(path,headers={'Origin':ORIGIN},data={'revision':s['revision'],'mrId':identity or None});assert r.ok
 await page.reload();await expect(finance.locator('.summary')).to_be_visible()
 if not await finance.get_by_label('MR',exact=True).is_visible():await finance.locator('.summary').click()
