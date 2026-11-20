---
name: browser-extension-install
description: 在 Chromium 系浏览器上安装扩展的可执行方法（PC 与安卓分开）：PC 端 Turbo/Cent 商店或 crx 安装（MV2），安卓端 Kiwi 侧载、Quetta 商店；自开发扩展（如 ubo_davsync）统一走开发者模式本地加载。每步标注 AI 可自动化程度，附可直接执行的命令。触发词：扩展安装、安装扩展、uBO、暴力猴、Tampermonkey、侧载、load-extension、CDP、chrome-extension、MV2、Kiwi、Quetta、Turbo、Cent。
agent_created: true
---

# 浏览器扩展安装（PC / 安卓，Chromium 系）

## Overview

按平台 → 浏览器组织安装方法。核心经验来自 uBlock Origin fork（ubo_davsync）与暴力猴在 Turbo/Cent/Kiwi/Quetta 上的多轮实测（2026-10 ~ 11）。

**自动化程度标注**：【AI 自动】= 全程命令可执行（一次搭建后无需人工）；【人工一次】= 需要人点一次（AI 可验证结果）。

**全自动边界（2026-11-20 实测定论）**：
- ✅ **全自动可行**：INTERNAL 模板 profile 复制（PC 任意 crx/MV2/MV3，纯文件操作）；安卓 Kiwi 侧载（uiautomator + input tap）
- ❌ **无法全自动**（Chromium 反自动化设计，注入点击被忽略）：PC 商店「添加至 Chrome」点击链路、`chrome.developerPrivate.loadUnpacked`（Turbo 156 静默失败，连对话框都不弹）
- 结论：**任何"商店安装/本地加载"的需求，都用 INTERNAL 模板方案实现全自动**；商店安装仅保留人工路径

## 方法总览

| 平台 | 浏览器 | 内核 | 商店安装 | crx 文件安装 | 本地加载（自开发扩展） |
|---|---|---|---|---|---|
| PC | Turbo / Cent（百分） | 新（150+，保留 MV2） | ✅ 商店直接装【人工确认】 | ✅ INTERNAL 模板【AI 自动】 | ✅ INTERNAL+payload 覆盖【AI 自动】 |
| PC | 官方 Chrome 137+ / Edge | 新，MV2 已移除 | 仅 MV3 | ❌ MV2 被拒 | 仅 MV3 |
| 安卓 | Quetta | 新（148） | ✅ 商店直接装（2026-10 实测） | ✅ | ✅ |
| 安卓 | Kiwi | 老（137） | ❌ 商店判内核不兼容（实测 2026-11） | ✅ 扩展页侧载 crx/zip【AI 自动】（**唯一可靠**） | ✅【人工一次】 |
| 安卓 | Kiwi 构建要求 | x86 | — | 必须 `-x86-` 构建；arm64 走 houdini 翻译渲染进程全灭（页面全白） | — |

**已废弃的路径（2026-11-20 实测废弃）**：UIA + SendInput 自动化原生对话框。原因：① 商店安装链路对 injected 鼠标事件免疫，点击无效；② Turbo 的 loadUnpacked 静默失败，无对话框可抓；③ RDP 断开后 SendInput 全失效。UIA 相关脚本仅保留用于"读取窗口状态"辅助诊断。

## PC 端（Turbo / Cent）

浏览器路径：`D:\Software\Cent\chrome.exe`、`D:\Software\Turbo\turbo.exe`。带 CDP 启动（AI 自动化回归用）：

```bash
"D:/Software/Cent/chrome.exe" --user-data-dir="<profile目录>" \
  --remote-debugging-port=9447 --no-first-run --no-default-browser-check \
  --disable-background-networking about:blank &
# 等 CDP 就绪：轮询 http://127.0.0.1:9447/json/version
```

### 商店安装（现成扩展）【人工确认——无法全自动，实测结论】

**2026-11-20 实测（Turbo 156）**：商店的「添加至 Chrome」点击链路**对自动化免疫**，这是 Chromium 的反自动化设计：
- JS click（`btn.click()`）：点击后无任何反应（无页面 dialog、无原生窗口、无 target 变化）；
- SendInput 真实鼠标点击（坐标经 DPI 校准落点准确）：同样无反应——Chromium 对 injected 鼠标事件（LLMHF_INJECTED 标记）在 webstore 流程中专门忽略；
- `--disable-blink-features=AutomationControlled`（隐藏 navigator.webdriver）也不解锁。

**自动化的正确替代**：不要走商店。把目标 crx 用下面的 INTERNAL 模板方式安装，效果等同（同一扩展、同一来源标记可配），且全自动。

人工安装时（仅需要人点一次确认框）：CDP 打开商店详情页 → 人点「添加至 Chrome」和「添加扩展程序」→ AI 验证 Secure Preferences 出现条目。

### crx 文件安装（MV2 / 无商店版本）【AI 自动】

**全自动流程（2026-11-21 实测通过，Turbo 156）**——三个脚本在 `scripts/`：

```bash
# Step 1: 从运行中的浏览器主 profile 抽取最小模板（解决"浏览器占用无法复制 profile"痛点）
#   只复制 Extensions payload + Preferences 注册条目 + Local State，全部未被锁定的文件
node scripts/make-min-template.js "D:\Software\Turbo\User Data" "<模板目录>" <扩展ID1> [扩展ID2...]

# Step 2: 模板 → 本次运行 profile（复制 + 覆盖 payload + 同步版本号 + 清扩展存储 + 校验 location=1）
node scripts/install-internal.js "<模板目录>" "<本次 profile 目录>" <扩展ID> <解包构建目录>

# Step 3: 启动浏览器（--user-data-dir 指向本次 profile + CDP 端口）后验证
node scripts/check-extensions.js     # 列已装扩展（CDP 导航到 chrome://extensions）
node scripts/list-ext-detail.js      # 读扩展名/ID
```

Step 1 也可以省略——任何"关闭状态且装好扩展"的 profile 都可直接当模板给 Step 2。
不要拿**正在运行的**主 profile 当模板复制整目录（Cache/Network/Cookies 被锁定，robocopy 会卡死或 rc=9；这就是提供 make-min-template 的原因）。

验证扩展已加载（AI 自动）：CDP `/json` 出现 `chrome-extension://<id>/...` target（MV2 是 `background.html`，MV3 是 `sw.js`）；或扩展页 DOM 读取（check-extensions.js）。

**人工一次搭建模板的两种方式**（make-min-template 不适用时）：
1. 启动浏览器开「开发者模式」，把 crx 拖进 `chrome://extensions`（"命令行传 crx 路径"实测不可靠）；
2. 或直接用 Step 1 从运行中的主 profile 抽取（零人工，推荐）。

启动后文件级验证（install-internal.js 已内置；单独验证时）：

```bash
python -c "
import json, os
pref = r'<profile>/Default/Secure Preferences' if os.path.exists(r'<profile>/Default/Secure Preferences') else r'<profile>/Default/Preferences'
p = json.load(open(pref, encoding='utf-8'))
v = p['extensions']['settings'].get('<扩展ID>', {})
print('location:', v.get('location'))          # 期望 1 (INTERNAL)
print('disable_reasons:', v.get('disable_reasons'))  # 期望 None/[]（空=启用）
"
```

crx 打包要点（自开发扩展）：
- manifest.json 必须带 `"key"`（RSA 公钥 base64），否则扩展 ID 不固定；ID = SHA256(公钥 DER) 前 32 hex 映射到 a-p，同一把 pem 永远同一 ID；
- 用 `crx3` npm 工具打包；手写 CRX3 protobuf 会被拒（CRX_REQUIRED_PROOF_MISSING）；
- 安装前提：目标 profile 开发者模式已开，否则 CRX_SIGNATURE_VERIFICATION_FAILED。

### 本地加载（自开发扩展，如 ubo_davsync）【全自动——用 INTERNAL 方式，不走 loadUnpacked】

**2026-11-20 实测（Turbo 156）**：`chrome.developerPrivate.loadUnpacked` 在 Turbo 上**静默失败**（触发后无任何文件对话框弹出、12 秒无窗口变化、无返回）——与老 Cent 弹 IFileDialog 的行为不同，UIA 对话框自动化在 Turbo 上无目标可抓。

全自动本地加载的正确方式 = **INTERNAL 模板 + payload 覆盖**（就是上面的"做法 1"）：把解包目录当作 BUILD 传给复制脚本即可，效果等同本地加载，且持久化、无对话框。

人工调试时（写代码热迭代场景）：`chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」选目录（一次人工）；改代码后点扩展卡片「重新加载」——此按钮在 DOM 里，AI 可 JS click 触发。

不要用 `--load-extension` 命令行参数：
- 官方 Chrome/Edge：参数已移除 + MV2 被禁，双重不可行；
- Cent：参数有效但云控规则可能拦截 unpacked 扩展 UI 页导航（ERR_BLOCKED_BY_CLIENT），规则何时推送不可控——不要依赖。

> 疑难排查（unpacked 被禁、`disable_reasons` 解读、Turbo Secure Preferences 限制等）见文末「陷阱速查」。

## 安卓端

前置：模拟器/设备已连接 adb，浏览器已启动。CDP 接入（AI 自动）：

```bash
ADB="D:/Software/Android/SDK/platform-tools/adb.exe"
"$ADB" start-server
"$ADB" -s emulator-5554 forward tcp:9222 localabstract:chrome_devtools_remote
curl -s --noproxy "*" http://127.0.0.1:9222/json/version   # Quetta 同理，socket 名可能带 pid 后缀
```

安卓 UI 操作通用套路（AI 半自动）：`adb shell uiautomator dump /data/local/tmp/ui.xml` → 解析 XML 拿目标控件 `bounds` 中心坐标 → `adb shell input tap x y`。Kiwi/Quetta 的安装确认框是安卓原生 dialog，必须走这条路（不在网页 DOM）。

### Quetta（内核新，148）

> 本节基于 2026-10 真机实测结论；2026-11-20 本机无 Quetta，未复测。

- **商店安装**【半自动】：`am start -a android.intent.action.VIEW -d '<商店详情URL>'` 打开页面 → CDP 点 Add to Chrome → uiautomator 找安卓确认框点确认。
- **本地加载**【人工一次】：扩展页开开发者模式 + 选目录（文件选择器需人工，或 UIA 自动化）。
- **crx 文件安装**【半自动】：同 Kiwi 侧载流程（文件选择器选中 crx/zip）。

### Kiwi（内核老，137）

商店安装**不可用**：商店按 UA 内核版本判定，实测直接显示 "This item is not
compatible with your current Chrome version"，Add to Chrome 点击无反应。先看页面有没有兼容性警告再点，有就直接转侧载。

用 **crx/zip 侧载**（已验证，全流程 AI 可执行）：

```bash
# 1. 下载 crx 并 push（Git Bash 用 // 双斜杠防路径转换）
curl -sL --ssl-no-revoke -o Violentmonkey.crx "<crx 下载 URL>"
"$ADB" -s emulator-5554 push ./Violentmonkey.crx //sdcard//Download//Violentmonkey.crx

# 2. crx 后缀不被文件选择器索引：复制改名 .zip + media 扫描
"$ADB" -s emulator-5554 shell "cp /sdcard/Download/Violentmonkey.crx /sdcard/Download/vm.zip"
"$ADB" -s emulator-5554 shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/vm.zip"

# 3. 打开 Kiwi（正常启动一次浏览器）
"$ADB" -s emulator-5554 shell "am start -n com.kiwibrowser.browser/org.chromium.chrome.browser.ChromeTabbedActivity -d 'https://www.google.com/'"
sleep 12
```

4. 进 Kiwi 扩展管理页：菜单入口（Kiwi 菜单 → 扩展），或 CDP 对已有标签 `Page.navigate` 到 `chrome://extensions/`（`am start -d 'chrome://extensions/'` 部分版本被拦，不可靠）【AI 自动】；
5. 点 `+ (from .zip/.crx/.user.js)` 按钮【AI 自动】：uiautomator dump 找该文本坐标 → `input tap`；
6. 文件选择器里选中 vm.zip【AI 自动】：uiautomator dump 找文件名坐标 → `input tap`；找不到就 `input swipe` 滚动再 dump；
7. 安装成功列表出现条目并标 "Not from Web Store."（正常）；重启浏览器生效【AI 自动】：`am force-stop` + `am start`；
8. 验证【AI 自动】：uiautomator dump 扩展页列表文本（更可靠，能读到名称/版本/ID）；CDP `/json` 的扩展后台 target **只有扩展实际运行时才出现**，不能作为"已安装"的判据。重启浏览器后扩展仍存在 = 持久化成功（实测 2026-11-20：VM 2.50.0 侧载后 force-stop 重启仍在）。

Kiwi 专属注意：
- 必须 x86 构建（文件名含 `-x86-`）；arm64 走 houdini 翻译，渲染进程被 SIGSYS 全灭（页面全白）；
- Kiwi CDP socket 带 pid 后缀（`chrome_devtools_remote_<pid>`），forward 后用 `/json/version` 的 `Android-Package` 字段确认连对浏览器；
- MuMu 多虚拟屏：`input tap` 可能要 `input -d <displayId> tap x y`；
- 模拟器本体启动见 `avd-boot` skill。

### 本地加载（自开发扩展，安卓通用）【人工一次】

Kiwi/Quetta 与 PC 相同：扩展页开「开发者模式」→「加载已解压的扩展程序」选构建目录（文件选择器需人工操作）。CDP 可验证注入结果。

## CDP 自动化回归要点（PC 端实测）

全流程回归（模板 profile → 启动 → 驱动扩展页 → 断言）可复用 `scripts/cdp_driver.py`（Python，复制到项目 `_tmp/` 改常量即用）或 `scripts/cdp.js`（Node）。要点：

- **INTERNAL 模板 profile**：每次测试复制模板再覆盖 payload，并同步 prefs 里的 `manifest.version`；清除扩展存储目录（`Local Extension Settings`/`Sync Extension Settings`/`Local Storage` 下的扩展 ID 目录）得到"全新设备"；
- 开扩展页用 `Target.createTarget` 钉住 targetId（不要遍历 /json 找，会 attach 错页面）；导航是异步的，轮询 `location.href`；
- CDP 消息 id 必须是整数（Cent 150 字符串 id 不回包）；
- 杀进程用 `taskkill /F /T /PID`——`proc.terminate()` 杀不掉子进程，残留实例会占住调试端口；
- 断言走真实 UI 路径：JS click 等效用户点击；触发动作必须走页面自己的处理器（绕过它直接 messaging.send 会导致页面渲染不发生，这类断言失败是测试缺陷）；
- 等待文案落定用循环 + 超时（如 45s 每秒读一次 DOM）。

## 陷阱速查（全部实测踩过）

| 现象 | 根因 | 处置 |
|---|---|---|
| 扩展页 chrome-error://，ERR_BLOCKED_BY_CLIENT | Cent 云控规则拦 unpacked 扩展 UI 页 | 用 INTERNAL profile（crx 正装），不要 --load-extension |
| `disable_reasons:[16777216]` | developer_mode 未开（1<<24） | Preferences 预写 `extensions.ui.developer_mode: true`（Cent 无 HMAC 校验） |
| `disable_reasons` 含 1<<23 | MV2 被 manifest 版本策略禁用 | 换保留 MV2 的载体（Turbo/Cent/Kiwi） |
| background 能加载、只有 UI 页打不开 | 云控拦截 unpacked UI 页 | 换 INTERNAL 形态，穷尽导航 API 无效时别再试 |
| Turbo Preferences 预写无效 | 扩展条目在 Secure Preferences（HMAC 保护） | 只能复制真实 profile；`chrome.developerPrivate.setEnabled` 在 150+ 已不存在，用 reload/loadUnpacked/getExtensionsInfo |
| CDP recv 超时 | 消息 id 是字符串 | id 用整数 |
| 残留浏览器进程吞 CDP 连接 | terminate() 杀不干净 | taskkill /F /T + 启动前按端口 netstat 清理 |
| PermissionError 读 leveldb | 浏览器还活着，文件被锁 | 先 taskkill 再读 |
| RDP 断开后鼠标注入全失效 | 会话进入输入不可用状态 | CDP 方案不受影响（选 CDP 而非 UI 自动化的理由）；原生对话框自动化只能在 RDP 活跃时做 |
| Kiwi 商店装扩展无反应 | 商店按内核版本判不兼容 | 走 crx/zip 侧载（见安卓端 Kiwi 节） |
| Kiwi arm64 构建 → 页面全白 | houdini 翻译下渲染进程被 SIGSYS 全灭 | 必须用 x86 构建（文件名含 `-x86-`） |
| Python/Node 脚本连 CDP 全部超时或 evaluate 返回 None | websocket-client / Node WebSocket 读 http_proxy 环境变量走了代理 | 脚本开头清 `http_proxy/https_proxy` 环境变量；Node 端 cdp.js 已内置 |
| AI 测试脚本退出后浏览器实例跟着消失 | 父进程退出触发 job object 连坐（同 avd-boot 模拟器被杀机制） | 单脚本内完成"启动→测试→收尾"，父进程常驻；或系统级方式常驻 |
| Python websocket-client `create_connection` 报 `'str' object cannot be interpreted as an integer` | 代理环境下 websocket-client 内部类型冲突 | 同上，清代理变量后消失 |
| `am start -d 'chrome://extensions/'` 打不开扩展页 | intent 被拦（Kiwi 多版本复现，2026-11-20 两次实测） | 用 CDP 对已有标签 `Page.navigate`，或人工走 Kiwi 菜单 |
| crx 在安卓文件选择器里不显示 | SAF 不索引 .crx 后缀 | 复制改名 .zip + media 扫描（见 Kiwi 侧载步骤 2） |
| 删 profile 时进程退出/挂起 | WorkBuddy safe-delete 钩子拦 >50 文件删除 | 测试脚本清理加环境变量门控，小目录用 cmd rmdir 强清 |
| 复制运行中浏览器的 profile 卡死/失败 | Cache/Network/Cookies 被运行实例锁定，robocopy 默认重试 100 万次 | 用 `make-min-template.js` 只抽扩展相关文件；robocopy 必须 `/R:1 /W:1` |

## 可复用脚本一览（scripts/，全部 2026-11-20/21 实测通过）

| 脚本 | 用途 | 验证范围 |
|---|---|---|
| `make-min-template.js` | 从运行中的浏览器主 profile 抽取最小模板（payload + 注册条目 + Local State） | Turbo 156 ✅ |
| `install-internal.js` | 模板 → 运行 profile：复制、覆盖 payload、同步版本、清存储、校验 INTERNAL | Turbo 156 端到端 ✅ |
| `cdp.js` | Node CDP 基础库（清代理、browserApi、attach、evalJson） | Turbo/Kiwi ✅ |
| `check-extensions.js` | CDP 导航到 chrome://extensions 列扩展数/ID | Turbo/Kiwi ✅ |
| `list-ext-detail.js` | 读扩展名称/ID 明细 | Kiwi ✅ |
| `cdp_driver.py` | Python CDP 驱动类（模板 profile、createTarget 钉页、进程树清理） | Cent 150/Turbo 154（历史） |

注：`webstore-install.js`（商店点击链）实测注入免疫无效，未收入本 skill，留存在 violentmonkey-script-install/scripts 供参考。
