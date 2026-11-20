// list-ext-detail.js — 从 chrome://extensions 页 DOM 读已装扩展
'use strict';
delete process.env.http_proxy; delete process.env.https_proxy; delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
const CDP = require('./cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).find(t => t.type === 'page' && t.url.startsWith('chrome://extensions'));
  if (!tab) { console.log('no ext tab'); process.exit(1); }
  const sid = await CDP.attach(api, tab.targetId);
  await CDP.sleep(2000);
  const expr = '(() => { const mgr = document.querySelector("extensions-manager"); const list = mgr && mgr.shadowRoot.querySelector("extensions-item-list"); const items = list ? list.shadowRoot.querySelectorAll("extensions-item") : []; return JSON.stringify([...items].map(i => { const n = i.shadowRoot.querySelector("#name"); return { id: i.id.slice(0, 12), name: n ? n.textContent : "?" }; })); })()';
  console.log(await CDP.evalJson(api, expr, sid, 10000));
})().catch(e => console.error('ERR', e.message));
