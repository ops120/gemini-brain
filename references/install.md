# 安装、配置与维护

## 依赖

- Node.js ≥ 20
- 系统已安装 Chrome / Edge / Brave / Chromium 任一（自动探测，无需下载 Chromium）
- 能访问 `gemini.google.com` 的**浏览器**（Node 直连可能因 TLS/代理失败，不影响使用）
- 一个 Google 账号（**建议用小号**：Google 对自动化浏览器有风控）

**无需 API key。**

## 安装

本仓库根目录就是 skill 目录：

```bash
git clone <repo-url> ~/.claude/skills/gemini-brain     # Claude Code
git clone <repo-url> ~/.codex/skills/gemini-brain      # Codex
git clone <repo-url> ~/.agents/skills/gemini-brain     # 通用
```

## 定位 skill 根

命令里的 `<skill-root>` = `SKILL.md` 所在目录。按顺序尝试：

1. 宿主的 skill 加载路径（通常已在上下文里给出）；
2. 常见位置：`~/.claude/skills/gemini-brain`、`~/.codex/skills/gemini-brain`、`~/.agents/skills/gemini-brain`；
3. 仍找不到 → 问用户。

## 首次配置

```bash
node "<skill-root>/scripts/gmb/cli.mjs" setup
```

依次：检查 Node 与浏览器 → 把依赖装到状态目录 → 打开浏览器**请用户登录 Google** → 导出登录态。

登录时**可能遇到 reCAPTCHA「证明您不是自动程序」**，需要用户本人点击——这是正常的风控，
通过后长期有效。

## 登录持久化原理（重要，排障必读）

Gemini 相比 DeepSeek 难在登录态。**根因**：
Playwright 的 `launchPersistentContext` **有意不保存 session cookie**
（[microsoft/playwright#36139](https://github.com/microsoft/playwright/issues/36139)，
维护者称"真实浏览器关闭时 session cookie 也会失效"），而 Google 登录态重度依赖
`__Secure-1PSID` 等 session cookie。

**三重保险**（缺一不可，已在 `src/browser.mjs` 实现）：

| 措施 | 作用 |
| --- | --- |
| `--restore-last-session` 启动参数 | 让 Chrome 恢复 session cookie |
| `storage-state.json` 导出 + 启动时注入 | session cookie 的完整备份 |
| 优雅关闭 `ctx.close()` | 触发 Chrome 落盘（强杀会跳过 → 登录态必丢） |

**登录判定必须用 cookie，不能看界面**：Gemini 未登录时会**自动隐藏「登录」按钮**，
看界面会产生假阳性（已踩过此坑）。标志性 cookie：
`SID / HSID / SSID / APISID / SAPISID / LSID / SIDCC / __Secure-1PSID / __Secure-1PSIDTS / __Secure-3PSID / __Secure-3PSIDTS`

**降低风控的启动参数**（已内置）：`chromiumSandbox: true`（默认 false 会注入 `--no-sandbox`，
触发「不受支持的命令行标记」警告条，是自动化特征）、`viewport: null`（否则窗口无法最大化）、
`--disable-blink-features=AutomationControlled`、抹除 `navigator.webdriver`。

## 状态目录

- Windows `%LOCALAPPDATA%\gemini-brain\`；macOS `~/Library/Application Support/gemini-brain/`；Linux `$XDG_STATE_HOME/gemini-brain/`（`GMB_STATE_DIR` 可覆盖）。
- 内容：`profile/`（登录态）、`storage-state.json`（cookie 备份）、`downloads/<workspace>/`（生图/代码产物）、`threads/`、`logs/`、`outputs/`。
- cookie **永不**导出到项目目录、**永不**进日志、**永不**进 prompt。

## 更新

```bash
cd <skill-root> && git pull
node scripts/gmb/cli.mjs update-check --force --json
```

站点改版时 `doctor --deep` 会报 `SITE_CHANGED`，拉取最新版即可（选择器集中在 `src/site.mjs`）。

## 敏感数据与 `--allow-sensitive`

默认拒绝私钥、`.env`、密钥形状。确需发送时（**用户明确知情同意**后）加 `--allow-sensitive`。
不要替用户做这个决定。

## 卸载

1. 删除宿主 skills 目录下的 `gemini-brain/`；
2. 删除状态目录（含登录态与产物）。
