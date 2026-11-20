// install-userjs.js — 一体化：重建 forward/reverse → 建 target 打开 .user.js →
// 等暴力猴 confirm 页 → 自动点安装/重装 → 清理 confirm 标签。自带 6 轮重试。
// 用法：node install-userjs.js <脚本本地路径或URL> [验证URL子串]
//   - 传本地路径时会在脚本目录起 http.server 8899 并 adb reverse（安卓场景）
//   - CDP 端口固定 9222（桌面直连或 adb forward 皆可，lib/cdp.js 自动处理）
'use strict';
const { execSync, spawn } = require('child_process');
const path = require('path');
const CDP = require('./cdp.js');

const ADB = 'adb';
const sleep = CDP.sleep;
const run = c => { try { execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {} };

(async () => {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node install-userjs.js <script.user.js path|url> [verifyTabSubstr]'); process.exit(1); }
  const isUrl = /^https?:\/\//.test(arg);
  const url = isUrl ? arg : 'http://127.0.0.1:8899/' + path.basename(arg);

  let server = null;
  if (!isUrl) {
    // 本地 HTTP 服务（GitHub raw 在部分网络拉不到；模拟器经 adb reverse 访问宿主机）
    server = spawn('python', ['-m', 'http.server', '8899'], {
      cwd: path.dirname(path.resolve(arg)),
      stdio: 'ignore',
    });
    run(`${ADB} reverse --remove tcp:8899`);
    run(`${ADB} reverse tcp:8899 tcp:8899`);   // reverse 每轮 shell 都会丢，先重建
    await sleep(1500);
  }

  try {
    for (let round = 0; round < 6; round++) {
      try {
        run(`${ADB} forward --remove tcp:9222`);
        run(`${ADB} forward tcp:9222 localabstract:chrome_devtools_remote`);
        await sleep(1500);
        const api = await CDP.browserApi();

        // 清旧 raw 页（缓存命中会让 webRequest 拦截不触发）
        for (const t of (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('8899'))) {
          try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
        }

        // 关键：URL 加时间戳防缓存，否则 confirm 页不弹
        await api.send('Target.createTarget', { url: url + '?t=' + Date.now() });
        await sleep(7000);
        let cts = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('confirm'));
        if (!cts.length) { await sleep(4000); cts = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('confirm')); }
        if (!cts.length) throw new Error('no confirm tab');
        console.log('confirm page:', cts[0].url.slice(0, 80));

        const sid = await CDP.attach(api, cts[0].targetId);
        // 首次安装按钮文案"安装"，已装过是"重装"；确认页渲染慢，轮询等按钮
        let btn = null;
        for (let j = 0; j < 10; j++) {
          const btns = await CDP.evalJson(api, "(() => [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean))()", sid);
          btn = (btns || []).find(b => b === '安装' || b === '重装');
          if (btn) break;
          await sleep(1500);
        }
        if (!btn) throw new Error('no install/reinstall button');
        await CDP.evalJs(api, `(() => { [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '${btn}').click(); return 1; })()`, sid);
        console.log('clicked', btn);
        await sleep(2500);

        // 收尾：关掉所有 confirm 标签
        for (const t of (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('confirm'))) {
          try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
        }
        console.log('INSTALLED OK');
        if (server) server.kill();
        process.exit(0);
      } catch (e) {
        console.log('round', round, 'fail:', e.message.slice(0, 80));
        await sleep(3000);
      }
    }
    console.log('FAILED after retries');
    if (server) server.kill();
    process.exit(1);
  } catch (e) {
    if (server) server.kill();
    throw e;
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
