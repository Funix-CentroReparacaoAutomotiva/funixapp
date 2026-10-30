"""Shared controls for the approved Issue15 scenario menu."""
from playwright.async_api import expect


def active_scenario(page,label):
    return page.get_by_role('button',name='Cenários: '+label,exact=True)

async def menu(page):
    # Etapa B: scenario controls live on the main Atendimento screen.
    if not await page.locator('.scenario-trigger').count():
        await page.locator('.detail-header .back-detail').click()
    trigger=page.locator('.scenario-trigger')
    if await trigger.get_attribute('aria-expanded')!='true': await trigger.click()
    return page.get_by_role('menu',name='Cenários do Atendimento')

async def select_named_scenario(page,label):
    await (await menu(page)).get_by_role('menuitemradio',name=label,exact=True).click()
    await expect(active_scenario(page,label)).to_be_visible()
    await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-expanded','false')

async def select_scenario(page,number): await select_named_scenario(page,f'Cenário {number}')

async def add_scenario(page):
    await (await menu(page)).get_by_role('menuitem',name='+ Nova variação',exact=True).click()
    await expect(page.locator('.scenario-trigger')).to_have_attribute('aria-expanded','false')

async def compare(page):
    if await page.get_by_role('region',name='Matriz de cenários',exact=True).count():
        await page.locator('.detail-header .back-detail').click()
        return
    await (await menu(page)).get_by_role('menuitem',name='Comparação',exact=True).click()
    await expect(page.get_by_role('region',name='Matriz de cenários',exact=True)).to_be_visible()
    await expect(page.locator('.scenario-trigger')).to_have_count(0)
