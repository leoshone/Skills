#!/usr/bin/env node
// install-internal.js — INTERNAL 模板 profile 全自动安装/更新扩展（PC，实测 2026-11-20 Turbo 156）
// 原理：复制含 crx 正装扩展的模板 profile → 覆盖 payload → 同步 Preferences 里的 manifest.version
// 用法: node install-internal.js <templateProfile> <newProfile> <extId> <unpackedBuildDir>
// 注意: Turbo 的扩展条目在 Secure Preferences（无 state 键，用 disable_reasons 判启用）；Cent 在 Preferences
'use strict';
delete process.env.http_proxy; delete process.env.https_proxy; delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const [template, profile, extId, build] = process.argv.slice(2);
if (!template || !profile || !extId || !build) {
  console.error('usage: node install-internal.js <templateProfile> <newProfile> <extId> <unpackedBuildDir>');
  process.exit(1);
}
if (!fs.existsSync(path.join(build, 'manifest.json'))) {
  console.error('build dir has no manifest.json:', build);
  process.exit(1);
}
const extDir = path.join(template, 'Default', 'Extensions', extId);
if (!fs.existsSync(extDir)) {
  console.error('template has no payload for', extId, '— 模板须先用 crx 人工装一次');
  process.exit(1);
}

// 1. 清理旧 profile（Windows 上浏览器占用时 rmdir 才可靠）
if (fs.existsSync(profile)) {
  try { execSync(`rmdir /s /q "${profile}"`, { stdio: 'ignore' }); } catch (e) {}
}

// 2. 复制模板——用 robocopy（浏览器在运行时有锁定文件，fs.cpSync 会崩）
//    /R:1 /W:1 快速放弃锁定文件（默认重试 100 万次会永久卡住）
//    /XD 排除运行时缓存目录（被浏览器锁定且与扩展无关）：Cache/Code Cache/GPUCache/Network 等
const { execSync: _rs } = require('child_process');
const EXCL = ['Cache', 'Code Cache', 'GPUCache', 'Network', 'Crashpad', 'Snapshots', 'ShaderCache', 'GrShaderCache', 'component_crx_cache', 'extensions_crx_cache', 'OptimizationGuideModelStore', 'optimization_guide_model_store'];
let rc = 0;
try {
  const xdArgs = EXCL.map(d => `/XD "${path.join(template, d)}" "${path.join(template, 'Default', d)}"`).join(' ');
  _rs(`robocopy "${template}" "${profile}" /E /R:1 /W:1 ${xdArgs} /NFL /NDL /NJH /NJS /NP`, { stdio: 'ignore', shell: 'cmd.exe', timeout: 600000 });
} catch (e) { rc = e.status; }
if (!(rc >= 0 && rc < 8)) {
  console.error('robocopy failed rc=' + rc + '（浏览器主实例运行中；建议先关闭 Turbo 后重试）');
  process.exit(1);
}

// 3. 覆盖 payload（Cent/Turbo 不做 hash 校验）
const payloadName = fs.readdirSync(path.join(profile, 'Default', 'Extensions', extId))[0];
const payload = path.join(profile, 'Default', 'Extensions', extId, payloadName);
fs.cpSync(build, payload, { recursive: true });

// 4. 同步 manifest.version（Turbo 还要改 Secure Preferences）
const newVer = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json'), 'utf8')).version;
for (const prefName of ['Preferences', 'Secure Preferences']) {
  const pref = path.join(profile, 'Default', prefName);
  if (!fs.existsSync(pref)) continue;
  try {
    const p = JSON.parse(fs.readFileSync(pref, 'utf8'));
    const entry = (((p.extensions || {}).settings || {})[extId]);
    if (entry && entry.manifest) {
      entry.manifest.version = newVer;
      fs.writeFileSync(pref, JSON.stringify(p));
      console.log('synced', prefName, '→', newVer);
    }
  } catch (e) { /* 该文件没有此扩展条目则跳过 */ }
}

// 5. 清扩展存储 → 全新设备状态
for (const sub of ['Local Extension Settings', 'Sync Extension Settings']) {
  const d = path.join(profile, 'Default', sub, extId);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

// 6. 验证（读 INTERNAL 标记）
let verified = false;
for (const prefName of ['Preferences', 'Secure Preferences']) {
  const pref = path.join(profile, 'Default', prefName);
  if (!fs.existsSync(pref)) continue;
  try {
    const p = JSON.parse(fs.readFileSync(pref, 'utf8'));
    const entry = (((p.extensions || {}).settings || {})[extId]);
    if (entry && entry.location === 1) {
      verified = true;
      console.log(`verified: ${prefName} location=1 disable_reasons=${JSON.stringify(entry.disable_reasons || null)}`);
    }
  } catch (e) {}
}
console.log(verified ? 'OK: INTERNAL profile ready at ' + profile : 'WARN: location!=1 — 检查模板是否为 crx 正装');
