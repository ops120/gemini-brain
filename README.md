# gemini-brain

把 **Gemini 网页版**当作编码 agent 的**外部大脑**：它出推理、代码与图像，你的 agent 出执行。

**Gemini 独有能力**（相对其他网页版大脑）：

- 🎨 **生成图片** —— 可下载**原始分辨率**（实测 2816×1536，是页面缩略图的 12 倍）
- 💻 **写代码 / 页面 / 动画** —— 代码在 Canvas 面板，可下载源文件（`.py` / `.svg` / …）
- 🧠 **切换模型** —— Flash-Lite（极速）/ Flash（均衡）/ Pro（高级推理）
- 🖼️ **图片与文件分析** —— 多模态输入

其他特性：

- 不用 API key，不做逆向代理 —— 只驱动官方网页。
- 人工登录一次，长期复用；只有网站重弹验证时才再打扰你。
- 发送前有确定性脱敏闸门：私钥整段拒绝、密钥形状脱敏、家目录路径脱敏、尺寸上限。
- 机制全在一个可测试的本地 CLI（`gmb`）里，Skill 只负责判断与汇报。

## 安装

把本仓库 clone 到宿主（Claude Code / Codex / ZCode…）的 skills 目录即可，**无需修改任何路径**：

```bash
git clone <repo-url> ~/.claude/skills/gemini-brain     # Claude Code
git clone <repo-url> ~/.codex/skills/gemini-brain      # Codex
git clone <repo-url> ~/.agents/skills/gemini-brain     # 通用
```

然后对 agent 说：**「用 gemini-brain 完成首次配置」**——它会装好依赖、打开浏览器让你登录一次。

依赖：Node.js ≥ 20、系统已装 Chrome / Edge / Brave 任一、一个 Google 账号（**建议用小号**）。
**不需要 API key。**

## 使用

直接对 agent 说人话：

- 「让 gemini 画一只橘猫坐在窗台上，水彩风格」
- 「用 gemini 写一个贪吃蛇网页游戏，然后跑起来看看」
- 「用 gemini Pro 分析下这个报错」
- 「让 gemini 审查下这段代码」（规划 / 执行 / 复核循环）

## 命令面

agent 直接调用，人也可以手跑；全部支持 `--json`。

| 命令 | 作用 |
| --- | --- |
| `gmb setup` / `login` / `logout` | 首次配置 / 重新登录 / 清除登录态 |
| `gmb doctor [--deep]` | 体检（`--deep` 真机探测页面、cookie、模型选择器） |
| `gmb ask --prompt-file f [--model Pro] [--attach a.png,b.pdf] [--thread new\|<url>]` | 单次问答 / 生图 / 写代码 |
| `gmb list-models` | 列出可用模型 |
| `gmb ask --protocol INIT\|EXECUTED --task <id> --iteration <n>` | 协作循环（PLAN → EXECUTED → DONE） |
| `gmb thread status` / `gmb session get` | 查看会话与进度检查点 |
| `gmb logs [-n 50]` | 查看脱敏日志 |

运行方式：`node <skill-root>/scripts/gmb/cli.mjs <命令>`。

## 产物

生图 / 生成的代码会**下载到本地**并在返回的 `files[]` 里给出绝对路径：

```
{ "ok": true, "mode": "canvas", "text": "",
  "files": [{ "file": "C:/Users/…/downloads/<wsid>/gemini-svg.svg", "bytes": 8199 }] }
```

## 结构

```
SKILL.md           给 agent 的说明书：何时用、怎么调、失败怎么办
references/        安装与登录持久化原理、失败分类、站点地图、[GMB] 协作协议
scripts/gmb/       机制层 CLI（setup/login/doctor/ask/list-models/thread/session/logs）
  tests/           单元测试：node scripts/gmb/tests/sanitize.test.mjs
```

## 状态与隐私

- 状态目录：Windows `%LOCALAPPDATA%\gemini-brain`，macOS / Linux 对应位置；项目目录零残留。
- 登录态存在专用 profile；`storage-state.json` 存 session cookie 备份（**Gemini 必需**）。
- cookie **永不**导出到项目目录、**永不**进日志、**永不**进 prompt。
- 回答正文默认不落盘，只记录元数据；**产物文件**（图片/代码）按需落盘到状态目录。

## 登录持久化（排障要点）

Gemini 比 DeepSeek 难在登录态：Playwright **有意不保存 session cookie**
（[microsoft/playwright#36139](https://github.com/microsoft/playwright/issues/36139)），
而 Google 登录态重度依赖它。本项目用**三重保险**解决：
`--restore-last-session` 启动参数 + `storage-state.json` 导出/注入 + 优雅关闭。

细节见 [references/install.md](references/install.md)。

## 边界

- 不生成视频 / 音频；可理解图片与文件。
- 低频辅助工具：每次问答会真实打开浏览器窗口，不适合批量调用。
- 登录时可能需要过一次 reCAPTCHA（需人工点击），之后长期有效。

## License

MIT
