// activate-tab.js — 激活指定 targetId 的标签
'use strict';
delete process.env.http_proxy; delete process.env.https_proxy; delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
const CDP = require('./cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const targetId = process.argv[2];
  await api.send('Target.activateTarget', { targetId });
  console.log('activated', targetId);
})().catch(e => console.error('ERR', e.message));
