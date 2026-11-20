// check-extensions.js — 导航到 chrome://extensions 并列出已装扩展
'use strict';
delete process.env.http_proxy; delete process.env.https_proxy; delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
const CDP = require('./cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const pages = (await CDP.getTargets(api)).filter(t => t.type === 'page');
  const tab = pages.find(t => t.url.includes('chromewebstore')) || pages[0];
  if (!tab) { console.log('no page tab'); process.exit(1); }
  const sid = await CDP.attach(api, tab.targetId);
  await api.send('Page.navigate', { url: 'chrome://extensions/' }, sid);
  await CDP.sleep(6000);
  const expr = '(() => { const mgr = document.querySelector("extensions-manager"); const list = mgr && mgr.shadowRoot.querySelector("extensions-item-list"); const items = list ? list.shadowRoot.querySelectorAll("extensions-item") : []; return JSON.stringify({ count: items.length, ids: [...items].map(i => i.id) }); })()';
  const o = await CDP.evalJson(api, expr, sid, 10000);
  console.log('extensions:', o);
})().catch(e => console.error('ERR', e.message));
