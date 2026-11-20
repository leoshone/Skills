// click-add-and-confirm.js — 点击"Add to Chrome"并高频轮询确认对话框
'use strict';
delete process.env.http_proxy; delete process.env.https_proxy; delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
const CDP = require('./cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).find(t => t.type === 'page' && t.url.includes('chromewebstore'));
  if (!tab) { console.log('no store tab'); process.exit(1); }
  const sid = await CDP.attach(api, tab.targetId);
  const clicked = await CDP.evalJson(api, '(() => { const btn = [...document.querySelectorAll("button, a[role=button], div[role=button]")].find(b => /Add to Chrome/i.test(b.innerText || "")); if (!btn) return null; btn.click(); return "clicked"; })()', sid, 10000);
  console.log('clicked:', clicked);
  for (let i = 0; i < 10; i++) {
    await CDP.sleep(1000);
    const st = await CDP.evalJson(api, '(() => { const dlg = document.querySelector("cr-dialog"); if (!dlg) return null; const btn = [...dlg.querySelectorAll("button")].find(b => /Add extension/i.test(b.innerText || "")); if (btn) { btn.click(); return "CONFIRMED"; } return "dlg-no-btn"; })()', sid, 8000);
    if (st) { console.log(i, st); if (st === 'CONFIRMED') break; }
  }
  await CDP.sleep(6000);
  const ts = await CDP.getTargets(api);
  const vm = ts.find(t => (t.url || '').includes('jinjac'));
  console.log(vm ? 'VM INSTALLED: ' + vm.url.slice(0, 70) : 'VM NOT DETECTED');
})().catch(e => console.error('ERR', e.message));
