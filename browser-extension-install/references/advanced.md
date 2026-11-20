# 进阶：其他载体与特殊路径

默认主线（Cent/Turbo INTERNAL + CDP）覆盖绝大多数场景。以下内容按需取用。

## 1. 官方 Chrome 137+ 侧载（仅 MV3 适用）

- `--load-extension` 已被移除（开发者模式/组策略均救不回），唯一通道是
  `chrome://extensions` → 开发者模式 toggle → 「加载未打包的扩展程序」→ 原生目录对话框。
- 对话框自动化组合：UIA 定位按钮矩形 → `SendInput` 真实鼠标点击（`BM_CLICK`/UIA Invoke
  对 IFileDialog 无效）→ 对文件夹输入框 hwnd 发 `WM_SETTEXT`（UIA ValuePattern 跨进程失败）
  → `SendInput` 点「选择文件夹」。
- MV2 扩展在 137+ 必然被拒（「不受支持的清单版本」），不要浪费时间。
- RDP 断开后 SendInput/SetCursorPos 全部失效——结论性验证必须在 RDP 活跃时做，
  或改用 CDP（不受影响）。

## 2. Android（AVD/模拟器 + Kiwi x86）

### 2.1 载体与准备

- Kiwi 是 Android 上唯一可用的完整扩展载体：**必须用 x86 构建**
  （github kiwibrowser/src.next releases，文件名含 `-x86-`）；arm64 包走 houdini
  翻译，渲染进程被 SIGSYS 全灭（页面全白）。
- adb push 的文件 SAF 选择器看不到，必须先发
  `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://<path>`。
  **实测补充（2026-11-20）**：`.crx` 后缀即使扫描后 Recent 里也可能不显示；
  复制一份改名为 `.zip` 再扫一次即可出现在文件选择器（Kiwi 按 ZIP archive 识别）。
- Git Bash 下 adb push 要加 `MSYS_NO_PATHCONV=1`（或用 `//sdcard//` 双斜杠），
  否则报成功但文件不存在。
- MuMu 多虚拟屏陷阱：app 每次启动可能落在不同 displayId，`input tap` 要
  `input -d <displayId> tap x y`（`-d` 在子命令前）；或一行修复
  `adb shell setprop persist.tab_manager.use_vaddress false` + 重启回落 displayId=0。
- Kiwi 的 CDP socket 带 pid 后缀（`chrome_devtools_remote_<pid>`），adb forward 后
  用 `/json/version` 的 `Android-Package` 字段确认连对了浏览器。
- 扩展后台 target 类型是 "other"，可直接 Runtime.evaluate；配置注入用
  `chrome.storage.local.set({<configKey>: {...}})`，改配置后需重启浏览器。
- 模拟器本体启动见 `avd-boot` skill（计划任务方式，工具调用里后台启动会被连坐杀掉）。

### 2.2 安装扩展的三条路径（按优先级）

#### 路径 A：Chrome Web Store 安装（仅当扩展与内核兼容）

1. `am start` 打开商店详情页（如 `https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag`）。
2. CDP attach 后点页面上的 `Add to Chrome` 按钮（DOM 里 `button/a[role=button]`）。
3. **兼容性门槛**：商店会按浏览器 UA 内核版本判定。实测 Kiwi（Chrome 137）装
   Violentmonkey 直接显示 "This item is not compatible with your current Chrome
   version"，Add to Chrome 按钮点击后无任何反应——**先看页面有没有兼容性警告再点**。
4. 即使能装，点击后的确认对话框是浏览器原生的，不在页面 DOM（cr-dialog 找不到），
   要用 `uiautomator dump` 找安卓侧按钮坐标再 `input tap`。

#### 路径 B：Kiwi 扩展页 + crx/zip 侧载（推荐，绕开兼容性检查）✅ 已验证

1. 下载扩展 crx（如暴力猴官方 GitHub releases 提供 `Violentmonkey-mv2-vX.Y.Z.crx`），
   `adb push` 到 `/sdcard/Download/`；`crx` 不被文件选择器索引时，复制改名 `.zip` 后
   重新扫 media（见 2.1）。
2. 打开 Kiwi 扩展管理页。注意 **`am start -d 'chrome://extensions/'` 在部分 Kiwi 版本
   打不开**（intent 被拦）；可靠做法：商店页/任意页打开后，通过 Kiwi 菜单进扩展页；
   或 CDP 对已有标签 `Page.navigate` 到 `chrome://extensions/`。
   Kiwi 的扩展页是**自定义页面**（非标准 chrome://extensions DOM），上面有：
   - `+ (from store)` —— 走路径 A
   - `+ (from .zip/.crx/.user.js)` —— 侧载入口
3. 点侧载按钮 → 弹安卓文件选择器 → `uiautomator dump` 找到目标文件坐标 → `input tap` 选中。
4. 安装成功后扩展页列表出现条目并标 "Not from Chrome Web Store."（非商店来源标记，
   正常现象）；重启浏览器后扩展生效。
5. 验证：CDP `/json` 里看扩展后台 target，或 `uiautomator dump` 扩展页列表文本。

#### 路径 C：命令行预设（未验证）

Kiwi 也支持把 crx 放进 profile 的 Extensions 目录 + Preferences 预写（同桌面 INTERNAL
思路），但安卓下 profile 在 `/data/data/` 非 root 不可写，仅模拟器 debuggable 包可行，
未实测，优先走路径 B。

### 2.3 实测案例时间线（2026-11-20，AVD TestPhone / Kiwi 137）

1. Web Store 装 Violentmonkey → "not compatible"（路径 A 失败）
2. GitHub 下载 `Violentmonkey-mv2-v2.50.0.crx` → push 到 Download → crx 在选择器里
   不显示 → 复制为 `vm.zip` + media 扫描 → 出现
3. Kiwi 扩展页 → `+ (from .zip/.crx/.user.js)` → 文件选择器选中 vm.zip →
   列表出现 "Not from Chrome Web Store. Violentmonkey" → 重启浏览器生效 ✅

## 3. Firefox（仅验证引擎逻辑时）

- 正式版不接受未签名 xpi；用 `web-ext run --source-dir <build> --firefox <exe>
  --firefox-profile <dir>` 装临时附加组件。
- BiDi（`ws://127.0.0.1:9223/session`，先 `session.new`）**不允许导航到
  moz-extension://**，`script.evaluate` 打扩展页要求 System access 且 web-ext 启动
  时传不进去 → **UI 断言在 Firefox 上不可用**。
- 替代方案「日志钩子构建」：复制一份构建目录，在背景脚本末尾插入仅测试用的
  自配置 + `fetch('http://127.0.0.1:8088/log/<msg>')` 回传，结果从 WebDAV/HTTP
  服务访问日志读回。同步引擎代码与发布版一致。
- 扩展 UUID 从 `<profile>/prefs.js` 的 `extensions.webextensions.uuids` 里按
  gecko id 查；`web-ext run --start-url moz-extension://<uuid>/settings.html` 可开页
  （先删 sessionstore.jsonlz4，否则被会话恢复顶掉）。
- 同一时刻只允许 1 个 BiDi 活动会话，脚本退出前必须 `session.end`。

## 4. 拦截类问题的排查套路

1. **先看 `disable_reasons`**：读 `<profile>/Default/Preferences` 里
   `extensions.settings.<id>.disable_reasons`，对照 Chromium
   `extensions/browser/disable_reason.h`：
   - `1<<24` = 开发者模式未开导致 unpacked 扩展被禁（预写 `extensions.ui.developer_mode:true`）；
   - `1<<23` = MV2 被 manifest 版本策略禁用（换载体）。
2. **background 能加载、只有 UI 页打不开** → 云控拦截 unpacked UI 页（Cent 实测）。
   验证方法：INTERNAL 形态对照。穷尽 createTarget/Page.navigate/window.open/
   tabs.create 都被拦时不要再试，直接换 INTERNAL。
3. **Turbo 特殊性**：扩展条目在 Secure Preferences（HMAC 保护），Preferences 预写
   无效；长流程只能复制真实 profile。`chrome.developerPrivate.setEnabled` 在
   154/150 已不存在；可用 reload/loadUnpacked/getExtensionsInfo。
   Turbo 的 vAPI.defer.onon 回调静默不执行，代码里用原生 setTimeout。

## 5. crx 打包要点（self-signed，配合 INTERNAL 安装）

- manifest.json 必须带 `"key"`（RSA 公钥 base64），否则扩展 ID 不固定；
  ID = SHA256(公钥 DER) 前 32 hex 映射到 a-p。同一把 pem 永远同一 ID。
- 打包用 `crx3` npm 工具（node 一行）；手写 CRX3 protobuf 在 Turbo 上会被
  CRX_REQUIRED_PROOF_MISSING 拒，统一用 crx3 工具。
- 安装前提：目标 profile 开发者模式已开，否则 CRX_SIGNATURE_VERIFICATION_FAILED。
- crx 正规安装后状态持久 ENABLED 且重启后启动同步自动执行（区别于
  --load-extension 的会话级）。
