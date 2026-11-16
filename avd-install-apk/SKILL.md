---
name: avd-install-apk
description: 在 Android 模拟器（AVD）上安装第三方 APK/APKS/XAPK 应用的完整流程。当用户要求"往模拟器装个 App"、"在 AVD 里安装某应用"、"给模拟器装 APK"时使用。涵盖 adb 设备选择、ABI 确认、APK 下载源选择（官网/APKPure/apk.cafe）、split APK 安装等，含实际踩坑经验（INSTALL_FAILED_MISSING_SPLIT、Cloudflare 拦截、curl 代理证书问题等）。
agent_created: true
---

# AVD 安装 APK 应用

## Overview

将第三方 Android 应用（APK / APKS / XAPK）安装到本机 Android 模拟器并验证启动。核心流程：确认设备 → 确认架构 → 获取安装包 → 安装 → 启动验证（截图）。

## 工作流程

### 1. 确认 adb 设备与架构

```bash
adb devices                          # 找到目标设备（emulator-5554 或设备序列号）
adb -s <serial> shell getprop ro.product.cpu.abilist   # 支持的 ABI 列表
adb -s <serial> shell getprop ro.build.version.sdk     # Android API 版本
```

要点：
- 多设备在线时必须用 `-s <serial>` 指定目标，避免装错。
- x86_64 模拟器若 abilist 含 `arm64-v8a`（Android 12+ 通常支持转译），可以安装 arm64-only 应用；不含则必须找 x86_64 包，否则报 `INSTALL_FAILED_NO_MATCHING_ABIS`。
- 对比应用的最低 Android 版本（API level）与模拟器版本。

### 2. 获取安装包（按优先级尝试）

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 应用官网 | 最可靠，但很多应用（如 Quetta）官网只给 Google Play 链接，无 APK 直链。先抓官网 HTML 搜 `.apk` 链接确认 |
| 2 | APKPure | 版本全，但 API 和下载页有 Cloudflare 拦截，curl 直接请求会返回 "Just a moment..." 挑战页。可尝试但常失败 |
| 3 | apk.cafe | 无 Cloudflare，可脚本化下载。解析版本列表页拿 `file_id`，再请求 download 页提取 `apk.cafe/go/?...b=<base64>` 中的 base64 直链（解码后为 filestorage CDN 地址） |
| 4 | apkmirror 等 | 备选 |

apk.cafe 下载套路（已验证）：
```bash
# 1) 抓应用版本列表页，找目标版本/架构的 file_id
curl -sL --ssl-no-revoke -A "Mozilla/5.0" "https://apk.cafe/<app-slug>" -o list.html
# 2) 请求 download?file_id=xxx 页面，提取 go 跳转链接里的 base64 直链
# 3) curl -L 下载直链；单 APK 约 200+MB，注意加 --max-time 和超时
```

下载注意事项：
- 本机代理环境下 curl 必须加 `--ssl-no-revoke`，否则报 `CRYPT_E_REVOCATION_OFFLINE`。
- 校验：对比页面标注的字节数、检查文件头为 `PK\x03\x04`。
- 大文件下载放后台执行（curl 580s 内约 250MB 可完成）。

**区分 APK 与 APKS**：现代大应用（尤其 Chromium 系）多为 split 分发。apk.cafe 页面上标注 `APKS` 的条目是分发包（zip 内含 base.apk + chrome/config/on_demand 等 split），不要下成单 base APK。

### 3. 安装

优先使用脚本 `scripts/install_apk.sh`（自动区分单 APK 与 zip bundle）：

```bash
# 单 APK
bash scripts/install_apk.sh -s emulator-5554 app.apk
# APKS/XAPK zip 包（自动解压 install-multiple）
bash scripts/install_apk.sh -s emulator-5554 app.apks.zip
```

手动操作等价命令：

```bash
# 单 APK
adb -s <serial> install app.apk
# 分发包：解压后 install-multiple 全部 apk（顺序无关）
python -c "import zipfile; zipfile.ZipFile('app.zip').extractall('apks')"
adb -s <serial> install-multiple apks/*.apk
```

**关键坑：`INSTALL_FAILED_MISSING_SPLIT`** —— 单独安装 base APK 必报此错，说明该应用是 split 分发，必须下载完整 APKS 包后用 `install-multiple` 安装，无本地补救办法。

### 4. 启动并验证（必须截图查验）

```bash
adb -s <serial> shell monkey -p <package> -c android.intent.category.LAUNCHER 1
sleep 5
adb -s <serial> shell pidof <package>        # 有 pid 即进程存活
adb -s <serial> exec-out screencap -p > screen.png
```

截图后必须用视觉工具查验界面是否正常（引导页/主页），不能只看进程存活。包名可从下载页或 `aapt dump badging` 获取（如 Quetta 为 `net.quetta.browser`）。

## 常见错误速查

| 错误 | 原因与对策 |
|---|---|
| `INSTALL_FAILED_MISSING_SPLIT` | base APK 缺 split，下载完整 APKS 包用 install-multiple |
| `INSTALL_FAILED_NO_MATCHING_ABIS` | 应用无模拟器支持的架构，找 x86_64 包或换支持转译的镜像 |
| Cloudflare "Just a moment..." | 换下载源（apk.cafe） |
| `CRYPT_E_REVOCATION_OFFLINE` | curl 走代理，加 `--ssl-no-revoke` |
| 安装卡住/超时 | 大 APK 用后台任务执行 adb install |
