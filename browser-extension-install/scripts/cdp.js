// cdp.js — 可复用的 CDP 工具库（桌面浏览器直连 / 安卓设备经 adb forward 皆可用）
// 职责：建立 browser 级 WS 连接、attach 到指定标签页、执行 JS、截图。
// 设计要点：
//  - 每轮 bash 都会重置 adb forward，所以模块加载时自动重建（已有 forward 时跳过，避免顶掉桌面浏览器的 9222）。
//  - 所有 evaluate 都带超时包装（CDP 长会话可能挂死 renderer）。
'use strict';
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');

// 关键：Node 的全局 WebSocket（undici）会读 http_proxy/https_proxy 环境变量走代理，
// 对 127.0.0.1 的 CDP ws 握手返回非 101（实测 "ws onerror non-101 status code"）。
// 连接前必须清掉代理变量（本机 v2rayN 等代理环境必踩）。
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) delete process.env[k];

const ADB_FORWARD = () => {
  // 9222 已有监听时不再 adb forward——可能是宿主机浏览器直接开的 9222，
  // 盲目 forward 会把它顶掉（2026-11-20 实测：连 Turbo 时 forward 反而把端口抢走）。
  try {
    const out = execSync('adb forward --list', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    if (out.includes('tcp:9222')) return;                    // 已有 forward，保持
  } catch (e) {}                                             // adb 不在 PATH 或无设备 → 走宿主机直连
};
ADB_FORWARD();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connectWs(url, timeout = 6000) {
  return new Promise((res, rej) => {
    const ws = new globalThis.WebSocket(url);
    const pend = new Map();
    let id = 0;
    const evh = new Map();
    const api = {
      ws,
      send: (m, p = {}, sid) => new Promise((r2, j2) => {
        const i = ++id;                                       // id 必须整数（Cent 150 实测字符串不回包）
        pend.set(i, { r2, j2 });
        const msg = { id: i, method: m, params: p };
        if (sid) msg.sessionId = sid;
        try { ws.send(JSON.stringify(msg)); } catch (e) { j2(e); }
      }),
      on: (e, cb) => evh.set(e, cb),
      close: () => { try { ws.close(); } catch (e) {} },
    };
    const timer = setTimeout(() => rej(new Error('ws timeout')), timeout);
    const done = () => clearTimeout(timer);
    ws.onopen = () => { done(); res(api); };
    ws.onerror = e => { if (pend.size === 0) { done(); rej(new Error('ws onerror ' + (e && e.message))); } };
    ws.onmessage = m => {
      let j; try { j = JSON.parse(m.data); } catch (e) { return; }
      if (j.id && pend.has(j.id)) {
        const { r2, j2 } = pend.get(j.id); pend.delete(j.id);
        j.error ? j2(new Error(JSON.stringify(j.error))) : r2(j.result);
      } else if (j.method && evh.has(j.method)) {
        try { evh.get(j.method)(j.params || {}); } catch (e) {}
      }
    };
  });
}

async function browserApi() {
  // browser 级 ws 必须带 GUID（不带会 404，Chrome 140+ 实测）——从 /json/version 取
  try {
    const v = await new Promise((res, rej) => {
      const req = http.get('http://127.0.0.1:9222/json/version', r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
      });
      req.on('error', rej);
    });
    if (v && v.webSocketDebuggerUrl) return connectWs(v.webSocketDebuggerUrl);
  } catch (e) {}
  return connectWs('ws://127.0.0.1:9222/devtools/browser');
}
async function getTargets(api) { return (await api.send('Target.getTargets')).targetInfos || []; }

// 找到第一个匹配 url 子串的 page 标签；无子串时取第一个 page
async function findTab(api, substr) {
  const ts = await getTargets(api);
  const pages = ts.filter(t => t.type === 'page');
  if (!substr) return pages[0] || null;
  return pages.find(t => (t.url || '').includes(substr)) || null;
}

// attach 并打开 Runtime，返回 sessionId
async function attach(api, targetId) {
  // 先激活目标标签：后台标签会被浏览器冻结，冻结的 target 不响应 attachToTarget ——
  // 症状是整个 node 进程卡死且不报错。统一在这里处理。
  try { await api.send('Target.activateTarget', { targetId }); } catch (e) {}
  const sid = (await api.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await api.send('Runtime.enable', {}, sid);
  await api.send('Page.enable', {}, sid).catch(() => {});
  return sid;
}

// 带超时的 Runtime.evaluate；返回 result 对象 {type, value, ...}
async function evalJs(api, expr, sid, timeout = 15000) {
  const r = await Promise.race([
    api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), timeout)),
  ]);
  if (r && r.exceptionDetails) throw new Error('JS exception: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r && r.result;
}

// evaluate 并解析 JSON 返回值（调用方用 JSON.stringify 返回）
async function evalJson(api, expr, sid, timeout) {
  const r = await evalJs(api, expr, sid, timeout);
  if (!r || r.value == null) return null;
  try { return JSON.parse(r.value); } catch (e) { return r.value; }
}

async function shot(api, sid, path, timeout = 10000) {
  try {
    const r = await Promise.race([
      api.send('Page.captureScreenshot', { format: 'png' }, sid),
      new Promise((_, rej) => setTimeout(() => rej(new Error('shot timeout')), timeout)),
    ]);
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  } catch (e) { console.log('  (shot skipped:', e.message + ')'); return null; }
}

// 等待 document.readyState === 'complete'
async function waitReady(api, sid, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const o = await evalJson(api, `JSON.stringify({rs:document.readyState,de:!!document.documentElement})`, sid, 5000);
      if (o && o.de && o.rs === 'complete') return true;
    } catch (e) {}
    await sleep(800);
  }
  return false;
}

async function openTab(api, url) { return api.send('Target.createTarget', { url }); }

module.exports = { ADB_FORWARD, sleep, connectWs, browserApi, getTargets, findTab, attach, evalJs, evalJson, shot, waitReady, openTab };
