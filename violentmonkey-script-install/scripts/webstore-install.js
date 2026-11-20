// webstore-install.js — 通过 CDP 在 Chrome Web Store 页自动点"添加至 Chrome"并确认
// 用法: node webstore-install.js <store-url>
// 依赖: cdp.js (同目录)
'use strict';
const CDP = require('./cdp.js');

(async () => {
  const url = process.argv[2] || 'https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag';
  const api = await CDP.browserApi();

  // 找商店标签；没有就开一个
  let tab = (await CDP.getTargets(api)).find(t => t.type === 'page' && t.url.includes('chromewebstore.google.com'));
  if (!tab) {
    await api.send('Target.createTarget', { url });
    await CDP.sleep(12000);
    tab = (await CDP.getTargets(api)).find(t => t.type === 'page' && t.url.includes('chromewebstore.google.com'));
  }
  if (!tab) { console.error('no store tab'); process.exit(1); }
  console.log('store tab:', tab.url.slice(0, 80));

  const sid = await CDP.attach(api, tab.targetId);
  await CDP.sleep(2000);

  // 点击"添加至 Chrome"（中英文都试）
  const clicked = await CDP.evalJson(api, `(() => {
    const btn = [...document.querySelectorAll('button, a[role=button], div[role=button]')]
      .find(b => /添加至 Chrome|Add to Chrome|新增至 Chrome/i.test(b.innerText || ''));
    if (!btn) return null;
    btn.click();
    return (btn.innerText || '').trim().slice(0, 30);
  })()`, sid, 10000);
  console.log('clicked:', clicked);
  if (!clicked) {
    // dump 页面按钮帮助诊断
    const btns = await CDP.evalJson(api, `(() => JSON.stringify(
      [...document.querySelectorAll('button, a[role=button], div[role=button]')]
        .map(b => (b.innerText||'').trim()).filter(Boolean).slice(0, 15)))()`, sid);
    console.log('page buttons:', btns);
    process.exit(1);
  }

  // 等浏览器确认对话框（"添加扩展程序？"），点确认
  await CDP.sleep(4000);
  for (let i = 0; i < 6; i++) {
    const ok = await CDP.evalJson(api, `(() => {
      const dlg = document.querySelector('cr-dialog') || document.querySelector('dialog');
      const btn = dlg && [...dlg.querySelectorAll('button')].find(b => /添加扩展程序|Add extension/i.test(b.innerText || ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`, sid, 8000);
    if (ok) { console.log('confirmed dialog'); break; }
    await CDP.sleep(3000);
  }

  await CDP.sleep(8000);
  // 验证扩展已装：查扩展后台页 target
  const ts = await CDP.getTargets(api);
  const vm = ts.find(t => (t.url || '').includes('jinjaccalgkegednnccohejagnlnfdag'));
  console.log(vm ? 'VM INSTALLED: ' + vm.url.slice(0, 80) : 'VM not detected yet');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
