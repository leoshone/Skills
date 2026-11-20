// nav-and-click.js — 导航到 VM 详情页并点击 Add to Chrome
'use strict';
delete process.env.http_proxy; delete process.env.https_proxy; delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
const CDP = require('./cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).find(t => t.type === 'page' && t.url.includes('chromewebstore'));
  if (!tab) { console.log('no store tab'); process.exit(1); }
  const sid = await CDP.attach(api, tab.targetId);
  await api.send('Page.navigate', { url: 'https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag' }, sid);
  await CDP.sleep(10000);
  const clicked = await CDP.evalJson(api, '(() => { const btn = [...document.querySelectorAll("button, a[role=button], div[role=button]")].find(b => /Add to Chrome/i.test(b.innerText || "")); if (!btn) return null; btn.click(); return "clicked"; })()', sid, 10000);
  console.log('clicked:', clicked);
})().catch(e => console.error('ERR', e.message));
