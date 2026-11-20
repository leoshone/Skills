#!/usr/bin/env node
// make-min-template.js — 从运行中的浏览器主 profile 抽取最小模板（只复制扩展运行所需文件，全部未锁定）
// 原理：扩展加载只需要 Extensions/<id>/ payload + Preferences/Secure Preferences 里的注册条目 + Local State
// 用法: node make-min-template.js <runningUserProfile> <outTemplateDir> <extId1> [extId2...]
'use strict';
delete process.env.http_proxy; delete process.env.https_proxy; delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const path = require('path');

const [srcProfile, outDir, ...extIds] = process.argv.slice(2);
if (!srcProfile || !outDir || extIds.length === 0) {
  console.error('usage: node make-min-template.js <runningUserProfile> <outTemplateDir> <extId...>');
  process.exit(1);
}
const srcDefault = path.join(srcProfile, 'Default');
const outDefault = path.join(outDir, 'Default');
fs.mkdirSync(outDefault, { recursive: true });

// 1. Extensions payload（插件目录是普通文件，运行中也可读）
for (const id of extIds) {
  const src = path.join(srcDefault, 'Extensions', id);
  if (!fs.existsSync(src)) { console.error('no payload for', id); process.exit(1); }
  fs.cpSync(src, path.join(outDefault, 'Extensions', id), { recursive: true });
  console.log('copied payload:', id);
}

// 2. Preferences / Secure Preferences（读取通常没锁；写入用 JSON 重排）
for (const prefName of ['Preferences', 'Secure Preferences']) {
  const src = path.join(srcDefault, prefName);
  if (!fs.existsSync(src)) continue;
  try {
    const p = JSON.parse(fs.readFileSync(src, 'utf8'));
    const settings = ((p.extensions || {}).settings) || {};
    const keep = {};
    for (const id of extIds) if (settings[id]) keep[id] = settings[id];
    if (p.extensions) p.extensions.settings = keep;
    // 清运行态
    delete p.profile;
    delete p.session;
    if (p.extensions) { delete p.extensions.chrome_url_overrides; }
    fs.writeFileSync(path.join(outDefault, prefName), JSON.stringify(p));
    console.log('wrote', prefName, 'kept', Object.keys(keep).length, 'extension entries');
  } catch (e) {
    console.error('read/write', prefName, 'failed:', e.message.slice(0, 80), '（文件被锁？先用浏览器扩展页导出或关闭浏览器）');
    process.exit(1);
  }
}

// 3. Local State（组件注册；可选用）
const ls = path.join(srcProfile, 'Local State');
if (fs.existsSync(ls)) {
  try { fs.copyFileSync(ls, path.join(outDir, 'Local State')); console.log('copied Local State'); } catch (e) {}
}

// 4. First Run 标记（跳过首启向导）
fs.writeFileSync(path.join(outDir, 'First Run'), '');
console.log('OK: minimal template at', outDir);
