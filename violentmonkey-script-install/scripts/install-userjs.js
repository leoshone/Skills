// install-userjs.js — 一体化：重建 forward/reverse → 预检暴力猴状态 → 建 target 打开
// .user.js → 等暴力猴 confirm 页 → 自动点安装/重装 → 清理 confirm 标签。自带 6 轮重试。
// 用法：node install-userjs.js <脚本本地路径或URL> [验证URL子串]
//   - 传本地路径时会在脚本目录起 http.server 8899 并 adb reverse（安卓场景）
//   - CDP 端口固定 9222（桌面直连或 adb forward 皆可，lib/cdp.js 自动处理）
//
// ⚠️ 为什么先跑预检（2026-11-21 实测踩坑）：暴力猴被 Chrome「权限提升」自动禁用后，
//   .user.js 页不弹 confirm、直接变下载/ERR_BLOCKED_BY_CLIENT——安装循环盲试 6 轮全败。
//   预检读 extensions 页 shadow DOM 的启用状态；DISABLED 时快速失败并给出恢复步骤
//   （启用需用户手势 + 权限确认框，脚本无法代点，详见 SKILL.md 陷阱表）。
'use strict';
const { execSync, spawn } = require('child_process');
const path = require('path');
const CDP = require('./cdp.js');

const ADB = 'adb';
const sleep = CDP.sleep;
const run = c => { try { execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {} };

// 预检：暴力猴是否存在且启用（桌面/安卓 Chromium 通用，extensions WebUI shadow DOM）
// 返回 {found, enabled, id}；查询失败（页面结构变化等）返回 null，不阻断安装。
async function precheckViolentmonkey(api) {
  try {
    let ext = (await CDP.getTargets(api)).find(t => t.type === 'page' && (t.url || '').includes('chrome://extensions'));
    if (!ext) {
      await api.send('Target.createTarget', { url: 'chrome://extensions/' });
      await sleep(2500);
      ext = (await CDP.getTargets(api)).find(t => (t.url || '').includes('chrome://extensions'));
      if (!ext) return null;
    }
    const sid = await CDP.attach(api, ext.targetId);
    await sleep(1500);
    // Polymer 深层 shadow DOM 递归钻取，读所有扩展的 id/name/enabled
    const r = await CDP.evalJson(api, `(() => {
      function deep(root) {
        const out = [];
        for (const e of root.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) out.push(...deep(e.shadowRoot)); }
        return out;
      }
      const mgr = document.querySelector('extensions-manager');
      if (!mgr) return 'no-mgr';
      const items = [...deep(mgr.shadowRoot)].filter(e => e.tagName === 'EXTENSIONS-ITEM');
      return JSON.stringify(items.map(it => ({
        id: it.id,
        name: it.shadowRoot.querySelector('#name') ? it.shadowRoot.querySelector('#name').textContent.trim() : '?',
        enabled: it.shadowRoot.querySelector('cr-toggle#enableToggle') ? it.shadowRoot.querySelector('cr-toggle#enableToggle').checked : null,
      })));
    })()`, sid, 15000);
    let list;
    try { list = (typeof r === 'string') ? JSON.parse(r) : r; } catch (e) { return null; }
    if (!Array.isArray(list)) return null;
    const vm = list.find(x => (x.name || '').toLowerCase().includes('violentmonkey') || (x.id || '').startsWith('jinjac'));
    if (!vm) return { found: false, enabled: false, id: null };
    return { found: true, enabled: vm.enabled === true, id: vm.id };
  } catch (e) { return null; }
}

(async () => {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node install-userjs.js <script.user.js path|url> [verifyTabSubstr]'); process.exit(1); }
  const isUrl = /^https?:\/\//.test(arg);
  const url = isUrl ? arg : 'http://127.0.0.1:8899/' + path.basename(arg);

  let server = null;
  if (!isUrl) {
    // 本地 HTTP 服务（GitHub raw 在部分网络拉不到；模拟器经 adb reverse 访问宿主机）
    // ⚠️ 服务随本脚本退出而关闭：失败退出后 raw 页会 ERR_EMPTY_RESPONSE，
    //    多轮安装长会话建议外部独立跑服务（后台任务），不要依赖本脚本自起的服务。
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

        // 第 0 轮先预检暴力猴（只跑一次）：禁用状态盲试必败，快速失败并给出恢复步骤
        if (round === 0) {
          const vm = await precheckViolentmonkey(api);
          if (vm && !vm.found) {
            console.log('PRECHECK: 暴力猴未安装（extensions 页无 Violentmonkey）。先装扩展本体（见 SKILL.md → browser-extension-install）。');
            process.exit(2);
          }
          if (vm && !vm.enabled) {
            console.log('PRECHECK: 暴力猴已被禁用（多为权限提升触发，Chrome 自动关闭）。');
            console.log('  恢复步骤（需真实用户手势，脚本无法代点）：');
            console.log('  1. chrome://extensions/ → Violentmonkey → 点启用开关；');
            console.log('  2. 弹「需要新权限」确认框 → 点 OK；');
            console.log('     无头自动化：CDP Input.dispatchMouseEvent 点开关触发确认框，');
            console.log('     再按截图换算物理坐标 adb tap 点 OK（截图横纵缩放系数不同，分别算）；');
            console.log('  3. 重跑本脚本。');
            process.exit(2);
          }
          if (vm) console.log('PRECHECK: 暴力猴已启用（' + vm.id + '），继续安装。');
          // vm === null：查询失败，不阻断，照旧走安装循环
        }

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
        // 首次安装"安装"，已装过"重装"；确认页渲染慢，轮询等按钮。
        // ⚠️ 英文环境文案是 Install…/Reinstall…（带省略号），用 startsWith 匹配
        let btn = null;
        for (let j = 0; j < 10; j++) {
          const btns = await CDP.evalJson(api, "(() => [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean))()", sid);
          const arr = (typeof btns === 'string') ? (() => { try { return JSON.parse(btns); } catch (e) { return []; } })() : (btns || []);
          btn = arr.find(b => ['安装', '重装', 'Install', 'Reinstall'].some(k => b === k || b.startsWith(k)));
          if (btn) break;
          await sleep(1500);
        }
        if (!btn) throw new Error('no install/reinstall button');
        await CDP.evalJs(api, `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim().startsWith('${btn.split('…')[0]}')); if (b) b.click(); return b ? 1 : 0; })()`, sid);
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
