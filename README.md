# gemini-brain

把 **Gemini 网页版**当作编码 agent 的**外部大脑**：它出推理、代码与图像，你的 agent 出执行。
不需要 API key，不做逆向代理 —— 只驱动官方网页。

- 由本地 CLI 驱动（文档中简写为 `gmb`；它等价于 `node "$SKILL_ROOT/scripts/gmb/cli.mjs"`，不是安装出来的可执行文件），Agent 只负责调用与判断
- 登录一次后**尽量**长期复用（登录持久化是本项目最复杂的一环，见下文原理；
  Google 侧策略可能导致较频繁地要求重新登录，被登出时 CLI 会停下等人）
- 发送前有确定性脱敏闸门（私钥整段拒绝、密钥形状脱敏、家目录路径脱敏、尺寸上限）
- 支持 `[GMB]` 协作协议：让 Gemini 做 PLAN → 你执行 → 它 REVIEW 的循环

> ⚠️ **合规与账号风险**：本项目通过浏览器自动化驱动 Gemini 官方网页版，
> 可能不符合 Google 服务条款，存在账号被风控、限制或封禁的风险。
> **强烈建议使用小号**（不要把主账号 —— Gmail / Drive / 相册 —— 暴露给自动化）。
> 请自行评估并遵守平台条款，**风险自负**；仅供低频个人使用，不要批量滥用。

## 目录

- [能力](#能力)
- [安装](#安装)
- [登录持久化（重要）](#登录持久化重要)
- [快速上手](#快速上手)
- [命令面](#命令面)
- [返回值契约](#返回值契约)
- [协作协议](#协作协议gmb)
- [失败处理](#失败处理)
- [状态与隐私](#状态与隐私)
- [原理与已知坑](#原理与已知坑)
- [边界](#边界)
- [项目结构](#项目结构)
- [同族项目](#同族项目)

## 能力

Gemini 网页版相对其他「网页版大脑」的差异能力：

| 能力 | 说明 | 怎么用 |
| --- | --- | --- |
| **生成图片** | 出图后可下载**原始分辨率**（实测原图 2816×1536，页面缩略图仅约 885×484 —— 像素总数差约 10 倍） | 直接提问即可 |
| **写代码 / 页面 / 动画** | 代码进 **Canvas 面板**，可下载源文件（`.py` / `.svg` / …） | 直接提问即可 |
| **切换模型** | Flash-Lite（极速）/ Flash（均衡）/ Pro（高级推理） | `--model Pro` |
| **图片 / 文件分析** | 多模态输入（图片 / PDF / 文本文件，逗号分隔多个路径） | `--attach a.png,b.pdf`（大小与格式上限由 Gemini 网页端决定，被拒时报 `UPLOAD_REJECTED`） |
| **长文本** | 单次正文 ≤ 50 KB（按 UTF-8 字节计，仅正文、不含附件）；超过会被闸门拒绝（`PAYLOAD_TOO_LARGE`），需先摘要或分片 | `--allow-large` 放宽到 200 KB；超过仍报同一失败码 |
| **协作循环** | 规划 / 执行 / 复核的迭代协议 | `--protocol <状态>`（合法值见命令面：`INIT` / `PLAN` / `EXECUTING` / `EXECUTED` / `REVIEW` / `HANDOFF`） |

> **注意**：Gemini 网页版**有模型选择器**（这点和 DeepSeek 不同）。
> `modes.model` 返回的是**从选择器 aria 读出的实际生效模型**，不是我们假设的。
> 表中的模型档位、分辨率等为编写时实测值，会随站点更新，**实际以页面为准**。

**不支持**：生视频、生音频。

## 安装

### 前置要求

- **Node.js ≥ 20**，含 npm —— 首次配置要把 `playwright-core` 装到状态目录
- 系统已装 **Chrome / Edge / Brave / Chromium** 任一（自动探测，不下载 Chromium）
- 能访问 `gemini.google.com` 的**浏览器**
- 一个 Google 账号 —— **建议用小号**：Google 对自动化浏览器有风控，主账号（Gmail / Drive / 相册）被风控代价较大
- **需要图形界面**：首次配置要打开有头浏览器请你本人登录（含 reCAPTCHA），之后**每次问答也会真实打开浏览器窗口**（问完自动关闭）；后续风控重弹验证同样需人工处理。纯 SSH / 容器环境无法使用

### 作为 Skill 安装

目标目录不存在时先建父目录（`git clone` 不会自动创建）：

```bash
mkdir -p ~/.claude/skills ~/.codex/skills ~/.agents/skills   # 已存在则无副作用
# Windows cmd（三个父目录一次建好）:
#   mkdir "%USERPROFILE%\.claude\skills" "%USERPROFILE%\.codex\skills" "%USERPROFILE%\.agents\skills"
# PowerShell:
#   "$env:USERPROFILE\.claude\skills","$env:USERPROFILE\.codex\skills","$env:USERPROFILE\.agents\skills" | ForEach-Object { mkdir $_ -Force }

# 三条命令按你的宿主任选其一，不要全都执行
git clone https://github.com/ops120/gemini-brain ~/.claude/skills/gemini-brain     # Claude Code
git clone https://github.com/ops120/gemini-brain ~/.codex/skills/gemini-brain      # Codex
git clone https://github.com/ops120/gemini-brain ~/.agents/skills/gemini-brain     # 通用 / ZCode
```

> Windows 的 cmd / PowerShell 不展开 `~`，请改用绝对路径，例如：
> ```bat
> REM cmd
> git clone https://github.com/ops120/gemini-brain "%USERPROFILE%\.agents\skills\gemini-brain"
> ```
> ```powershell
> # PowerShell
> git clone https://github.com/ops120/gemini-brain "$env:USERPROFILE\.agents\skills\gemini-brain"
> ```
> 目标目录已存在时 `git clone` 会失败：改用 `git -C <目录> pull` 更新，或先删掉旧目录。

装好后对 agent 说：**「用 gemini-brain 完成首次配置」**。

> **关于命令写法（重要）**：本文档里的 `gmb <命令>` 是**文档简写**，并非已安装的命令，
> 等价于 `node "$SKILL_ROOT/scripts/gmb/cli.mjs" <命令>`，
> 其中 `SKILL_ROOT` 就是你 clone 下来的仓库目录。
>
> **推荐先设变量再配别名**（路径按你的实际安装位置改）：
> ```bash
> # Claude Code：SKILL_ROOT="$HOME/.claude/skills/gemini-brain"
> # Codex：      SKILL_ROOT="$HOME/.codex/skills/gemini-brain"
> # 通用/ZCode： SKILL_ROOT="$HOME/.agents/skills/gemini-brain"
> SKILL_ROOT="$HOME/.agents/skills/gemini-brain"   # ← 改成你实际用的那个
> export SKILL_ROOT
> alias gmb='node "$SKILL_ROOT/scripts/gmb/cli.mjs"'
> ```
> 不配别名也可以，把示例里的 `gmb` 整体替换成 `node "$SKILL_ROOT/scripts/gmb/cli.mjs"`。
> 想长期生效就把这几行写进 `~/.bashrc` / `~/.zshrc`。
>
> **Windows 用户注意**：cmd / PowerShell **不展开 `$SKILL_ROOT` 这种 bash 变量**，也没有 `alias`。
> 两种可行做法：
> ```bat
> REM cmd：每次直接用完整路径（把路径换成你的实际安装位置）
> node "%USERPROFILE%\.agents\skills\gemini-brain\scripts\gmb\cli.mjs" doctor --json
> ```
> ```powershell
# PowerShell：可先设变量，同一会话内后续命令都能用
$SKILL_ROOT = "$env:USERPROFILE\.agents\skills\gemini-brain"
node "$SKILL_ROOT\scripts\gmb\cli.mjs" doctor --json
```
> 把上面几行写进 PowerShell 的 `$PROFILE` 即可长期生效。

### 首次配置

```bash
node "$SKILL_ROOT/scripts/gmb/cli.mjs" setup
```

1. 检查 Node 版本与系统浏览器
2. 把 `playwright-core` 装到**状态目录**
3. 打开有头浏览器，**请你本人登录 Google**（含 reCAPTCHA，需你手动点选）
4. 导出登录态并冒烟验证

> **登录时会遇到 reCAPTCHA**（"证明您不是自动程序"）—— 这是 Google 对自动化浏览器的常规风控，
> **必须你本人点击**（agent 不代点验证码：既违反条款也无意义）。通过后通常可复用一段时间，
> 但**不保证长期有效**——服务端会话过期或风控触发时仍会要求重新登录，届时 CLI 会停下等人。

## 登录持久化（重要）

这是 Gemini 相对 DeepSeek **最大的技术差异**，也是本项目最值得记录的部分。

### 根因：Playwright 有意不保存 session cookie

`launchPersistentContext` **不保存没有 `Expires` 属性的 cookie**（session cookie），
这是 [microsoft/playwright#36139](https://github.com/microsoft/playwright/issues/36139)
里维护者回复的**预期行为**（"真实浏览器关闭时 session cookie 也会失效"）。
该结论基于编写时的 Playwright 版本（`playwright-core` ^1.40）与本文实测环境；不同版本行为可能不同，
**以你自己的实测为准**（`doctor --deep` 可打印实际依赖版本）。

而 **Google 的登录态重度依赖 session cookie**（`__Secure-1PSID` 等）——
所以 Gemini 会频繁丢登录态，DeepSeek 却不会（它的 cookie 是持久型的）。

### 解法：三重保险

| 措施 | 作用 | 实现位置 |
| --- | --- | --- |
| **`--restore-last-session`** 启动参数 | 让 Chrome 恢复上次会话，session cookie 才有机会被恢复 | `src/browser.mjs` |
| **`storage-state.json`** 导出 + 启动时注入 | session cookie 的完整备份（Playwright 官方 API） | `src/browser.mjs` |
| **优雅关闭 `ctx.close()`** | 触发 Chrome 落盘 cookie（**强杀会跳过落盘，登录态必丢**） | CLI 各处 |

**实测验证**：round1 人工登录 → 导出 32 个 cookie（含 11 个登录 cookie）→ 关闭 →
round2 重启 → 注入后**直接是登录态，没有任何人工介入**。

> 这三项是当前实现采用的组合措施，实测有效；但登录能否长期保持仍取决于 Google 侧策略
> （服务端会话过期、风控触发时仍会要求重新登录）。被登出时 CLI 会以 `LOGIN_REQUIRED` 停下，不会硬试。

### 登录判定必须用 cookie，不能看界面

⚠️ **不要用界面元素判断登录态**：实测中「登录」按钮的显示与否并不稳定
（未登录时也可能看不到它），靠它判断会产生**假阳性**（本项目开发时因此误判过两次）。
界面行为随站点版本会变，可靠判据只有下面的 cookie。

可靠判据是 cookie 里**存在以下任一身份 cookie**（实现在 `src/browser.mjs` 的 `LOGIN_COOKIE_RE`）。
这份名单来自登录成功时的实测比对（一次出现 11 个）；**不要**用 `NID`、`_ga` 这类通用 cookie
判断登录态 —— 它们未登录时也存在，会产生假阳性：

```
SID, HSID, SSID, APISID, SAPISID, LSID, SIDCC,
__Secure-1PSID, __Secure-1PSIDTS, __Secure-3PSID, __Secure-3PSIDTS
```


CLI 里由 `readLoginCookies()` 统一判定，`doctor --deep` 会报告登录 cookie 数量。

### 降低风控的启动参数（已内置）

```js
{
  chromiumSandbox: true,   // 关键！默认 false 会注入 --no-sandbox，
                           // Chrome 顶部显示「不受支持的命令行标记」警告条，
                           // 且是自动化特征，明显提高风控概率
  viewport: null,          // 固定视口会阻止窗口最大化
  args: ["--disable-blink-features=AutomationControlled", "--restore-last-session", ...],
}
// 另有 initScript 抹除 navigator.webdriver
```

## 快速上手

> **以下命令假定你已按安装章节设置 `SKILL_ROOT`**（或已配好别名）；
> 没设过就直接复制会因变量为空而报错，请先把占位路径换成你的实际安装目录。

```bash
# 体检（建议每次任务前跑；普通模式不查登录态，要查请用 doctor --deep --json）
node "$SKILL_ROOT/scripts/gmb/cli.mjs" doctor --json

# 写检查点（session set 完整形态；protocol-state / waiting-for 只接受枚举值）
#   --protocol-state: INIT | PLAN_RECEIVED | EXECUTING | EXECUTED_LOCAL | EXECUTED_SENT | DONE | BLOCKED
#   --waiting-for:    none | BRAIN_PLAN | BRAIN_REVIEW | USER
node "$SKILL_ROOT/scripts/gmb/cli.mjs" session set   --protocol-state PLAN_RECEIVED --waiting-for none --next-step "execute PLAN" --json

# 普通问答
node "$SKILL_ROOT/scripts/gmb/cli.mjs" ask --prompt-file ./question.txt --json

# 指定模型
node "$SKILL_ROOT/scripts/gmb/cli.mjs" ask --prompt "分析下这段代码" --model Pro --json

# 列出可用模型
node "$SKILL_ROOT/scripts/gmb/cli.mjs" list-models --json

# 生成图片（产物自动下载到本地，files[] 给绝对路径）
node "$SKILL_ROOT/scripts/gmb/cli.mjs" ask \
  --prompt "一只柴犬坐在樱花树下的草地上，水彩插画风格" --thread new --json

# 写代码 / 页面 / 动画（代码走 Canvas 面板，产物自动下载）
node "$SKILL_ROOT/scripts/gmb/cli.mjs" ask \
  --prompt "用纯 SVG 写一个循环动画：鹈鹕骑自行车" --thread new --json

# 附件分析
node "$SKILL_ROOT/scripts/gmb/cli.mjs" ask --prompt "分析这张图" --attach ./pic.png --json
```

对 agent 说人话也一样：**「让 gemini 画一只猫」**、**「用 gemini Pro 分析下这个报错」**。

## 命令面

`--json`（机器可读）与 `--debug`（保存页面 HTML）为全局选项；
`--keep-open`（保留浏览器窗口）只对会打开浏览器的命令（`ask` / `setup` / `login` / `list-models`，以及带 `--deep` 的 `doctor`）有意义。
各命令的完整参数以 `--help` 为准。示例使用 `gmb` 简写，未配别名时请展开为 `node "$SKILL_ROOT/scripts/gmb/cli.mjs"`。

| 命令 | 作用 | 关键参数 |
| --- | --- | --- |
| `setup` | 首次配置：装依赖 → 打开浏览器 → 人工登录 | `--timeout <ms>` |
| `login` | 重新登录 | `--timeout <ms>` |
| `logout` | 清除登录态（清 `profile/` 与 `storage-state.json`） | — |
| `doctor` | 体检 | `--deep`（真机探测页面/cookie/模型选择器；**同时才会检查登录态**）、`--html`（doctor 专用的页面 HTML 转储；全局 `--debug` 是通用排障快照） |
| `ask` | 提问 / 生成 | `--prompt` / `--prompt-file`、`--model`、`--attach`、`--thread new`（省略则复用当前线程）、`--protocol <状态>`、`--task <id>`、`--iteration <n>`、`--timeout`、`--allow-sensitive`、`--allow-large` |
| `list-models` | 列出可用模型（打开选择器读取） | — |
| `thread` | 线程管理 | `status` / `use <url>` / `new` |
| `session` | 工作区级线程与检查点 | `get` / `set --protocol-state --waiting-for --next-step ...` |
| `logs` | 查看脱敏日志 | `-n <行数>`、`--verbose` |
| `update-check` | 检查更新 | `--force` |

运行方式：`node "$SKILL_ROOT/scripts/gmb/cli.mjs" <命令>`。

> **注意 `--protocol` 与 `--protocol-state` 是两套不同的枚举，别混用**：
> `--protocol`（用于 `ask`）取 `INIT` / `PLAN` / `EXECUTING` / `EXECUTED` / `REVIEW` / `HANDOFF`；
> `--protocol-state`（用于 `session set`）取 `INIT` / `PLAN_RECEIVED` / `EXECUTING` / `EXECUTED_LOCAL` / `EXECUTED_SENT` / `DONE` / `BLOCKED`。

### doctor 检查项

| 检查项 | 含义 |
| --- | --- |
| `node` | Node 版本 ≥ 20 |
| `deps` | `playwright-core` 已装到状态目录 |
| `browser` | 找到可用的 Chromium 系浏览器（含走哪条探测路径） |
| `stateDir` | 状态目录可写 |
| `network` | 能访问站点（Node 直连失败不算死，会注明） |
| `login` | **仅 `--deep` 时**：cookie 里有登录标志（列出具体 cookie） |
| `deep` | **仅 `--deep` 时**：真机探测页面状态 / 登录 cookie / 模型选择器，并截图 |

## 返回值契约

```json
{
  "ok": true,
  "requestId": "gmb_ab12",
  "threadUrl": "https://gemini.google.com/app/2365c02ac27ab65d",
  "modes": { "model": "Pro", "requested": "Pro" },
  "text": "……回答正文……",
  "files": [{ "file": "<state>/downloads/<wsid>/Gemini_Generated_Image_xxx.png",
              "bytes": 9791938 }],
  "mode": "artifact",
  "truncated": false,
  "elapsedMs": 41000
}
```

> `file` 是**运行时字段**，运行时值为状态目录下的绝对路径（Windows 形如
> `%LOCALAPPDATA%\gemini-brain\downloads\<workspaceId>\xxx.png`，macOS / Linux 对应各自的状态目录）；
> 上面 JSON 里的尖括号是占位符说明，不是可复制的字面量。

**字段说明**：

- `modes.model` —— **实际生效**的模型（从选择器 aria 读取）。与 `requested` 不一致时必须标注
- `mode` —— 承载形态，**单个字符串**（不是多个值的并列）。判定优先级：
  `canvas`（走到 Canvas 面板）> `artifact`（有产物下载）> `chat`（纯文本）：

  | 值 | 含义 | `text` | `files[]` |
  | --- | --- | --- | --- |
  | `"canvas"` | 代码等长内容进了 **Canvas 面板**（**正常情况，不是失败**） | 通常为空 | 通常有（面板里的源文件） |
  | `"chat"` | 普通文本回答 | 有 | 无 |
  | `"artifact"` | 有产物被下载（图片等），且未走 Canvas | 可能有 | 有 |
- `files[]` —— **已下载到本地的产物**绝对路径（图片 / 代码文件）
- `truncated` —— `true` 表示可能被截断，需如实告知用户

失败（**判别联合**）：`{ "ok": false, "reason": "LOGIN_REQUIRED", "message": "…" }`；
限流场景会额外带 `retryAfterMs`（建议退避毫秒数）。

## 协作协议（`[GMB]`）

与 deepseek-brain 同构：让 Gemini 当「规划与审查大脑」，**执行权始终在本地 agent 手里**。
示例使用 `gmb` 简写，未配别名时请展开为全路径。

```bash
gmb ask --protocol INIT --task gmb_f81a --iteration 0 --prompt-file goal.txt --json
#   → protocol.reply.state：PLAN = 拿到方案 | BLOCKED = 停下问用户

gmb ask --protocol EXECUTED --iteration 1 --prompt-file report.txt --json
#   → DONE = 结束 | PLAN = 还有下一轮 | BLOCKED = 停下
#   --task / --iteration 省略时会自动沿用工作区 session 里的值

gmb thread status --json   # 查进度（checkpoint 自动落盘）

# 线程丢失时用 HANDOFF 重新交接（协议同样支持）
gmb ask --protocol HANDOFF --prompt-file handoff.txt --json
```

- 信封由 CLI 自动封装，回复状态由代码解析；`--task` 首次可自取任意标识（如 `gmb_f81a`），
  也可省略（省略时 CLI 自动生成并写入 session，后续轮次自动沿用）
- 建议同一任务不超过 12 轮，到顶暂停问用户（这是给 agent 的使用约定，不是 CLI 参数）
- 线程丢失 → 依据 checkpoint 发 HANDOFF，**不粘贴日志或 diff**
- 协议模式下返回值会多一个 `protocol` 字段：
  `{ sent, taskId, iteration, reply }`，其中 `reply` 是对象 `{ state, taskId, iteration }`
  （`state` 取 `PLAN` / `DONE` / `BLOCKED`，无协议回复时为 `null`），
  详见 [references/protocol.md](references/protocol.md)

## 失败处理

| reason | 含义 | 动作 |
| --- | --- | --- |
| `LOGIN_REQUIRED` | 登录失效（cookie 里无登录标志） | 停；让用户登录（含 reCAPTCHA），一次一个动作 |
| `HUMAN_VERIFICATION_REQUIRED` | Google 风控（**reCAPTCHA**「证明您不是自动程序」） | 停；用户手动完成后重试 |
| `RATE_LIMITED` | 限流 | 停；按 `retryAfterMs` 退避 |
| `COMPOSER_NOT_FOUND` / `SITE_CHANGED` | 站点改版、选择器漂移 | **版本问题**：先 `doctor --deep` 确认；普通用户提 issue 等上游发版即可，`scripts/gmb/src/site.mjs` 的修改面向维护者 |
| `SEND_FAILED` | 发送失败 | 重试一次 |
| `STREAM_STALLED` | 流式停滞 / 超时 | 标注「可能截断」；可重试一次 |
| `UPLOAD_REJECTED` | 附件被拒 | 检查格式与大小（网页端限制由 Gemini 决定） |
| `THREAD_LOST` | 会话 404 | 新会话重问（或 HANDOFF） |
| `LOCKED` | 浏览器被占用 | 等，或问用户 |
| `DEPENDENCY_MISSING` | 依赖缺失 | 运行 `setup` 重装依赖（该命令会打开浏览器，可能需要人工登录） |
| `SENSITIVE_BLOCKED` | 闸门拦截 | 移除敏感内容；确需发送须用户明确同意后加 `--allow-sensitive`（仅关闭脱敏，**私钥块仍拒绝**） |
| `PAYLOAD_TOO_LARGE` | 正文超 50 KB | 摘要或分片；`--allow-large` 放宽到 200 KB |

完整表（含对用户话术）见 [references/failure-taxonomy.md](references/failure-taxonomy.md)。

遇到站点改版等问题，可在 <https://github.com/ops120/gemini-brain/issues> 反馈。

**硬规则**：绝不把失败伪装成结果；绝不静默降级后不告知；同类失败最多重试 2 次。

## 状态与隐私

状态目录（`GMB_STATE_DIR` 可覆盖）：

```
Windows  %LOCALAPPDATA%\gemini-brain\
macOS    ~/Library/Application Support/gemini-brain/
Linux    $XDG_STATE_HOME/gemini-brain/   （该变量未设置时通常为 ~/.local/state/gemini-brain/）
```

| 内容 | 说明 |
| --- | --- |
| `deps/` | `playwright-core` |
| `profile/` | 持久化浏览器 profile —— 登录态来源 |
| `storage-state.json` | **session cookie 备份**（Gemini 必需，见上文） |
| `downloads/<workspaceId>/` | 产物：生成的图片、下载的代码文件 |
| `threads/<workspaceId>.json` | 工作区级线程与检查点 |
| `outputs/<workspaceId>.jsonl` | 审计：每次问答一行元数据 |
| `logs/gmb.log` | 脱敏日志 |
| `debug/` | `--debug`、`doctor --html` **或失败时自动**保存的页面截图与 HTML —— ⚠️ **含你的输入与回答原文、未脱敏**；失败自动保存是默认行为（当前无开关可关），排障后**务必删除**，且**不要上传到公开 issue** |

**隐私要点**：

- 状态目录权限 `0700`、文件 `0600`（**仅 Unix/macOS 生效**；Windows 依赖用户目录 ACL）
- **不要把状态目录同步 / 备份 / 分享** —— `storage-state.json` 与 `profile/` 含登录 cookie
- **回答正文默认不落盘**，只记录元数据（例外：`--debug` 或失败时保存的 `debug/` 快照会含未脱敏正文，排障后请删除）；产物文件按需落盘
- cookie / storageState **永不**导出到项目目录、**永不**进日志、**永不**进 prompt
- `logout` 会清除 `profile/` 与 `storage-state.json` 两者（下次使用需重新登录）

## 原理与已知坑

### 工作方式

```
你 / Agent ──调用──▶ gmb CLI ──Playwright──▶ 持久 Chrome ──▶ gemini.google.com
                        │
                        ├─ 发送前：确定性净化闸门
                        ├─ 输入框：contenteditable（Quill）→ execCommand insertText 一次性注入
                        ├─ 等待：StreamGenerate 网络信号 + 文本稳定性 双判据
                        └─ 抽取：语义化自定义元素 + DOM 文本收集
```

### 真机验证过的坑（别再踩）

1. **输入框不是 textarea**，是 `div.ql-editor[contenteditable]`（Quill 富文本）。
   React setter 注入法**无效**；必须用 `execCommand("insertText")` 一次性插入。
   ⚠️ 用 `keyboard.type()` 逐字符输入时，**Quill 会把换行当成发送信号**，
   导致长 prompt 被拦腰截断（实测被切成两段）。
2. **代码请求会开 Canvas 面板**，答案**不在聊天区**（`.message-content` 长度恒为 0）。
   完成判定必须双路径：
   - 路径 A（聊天区）：网络结束 + 文本连续 N 次采样不变
   - 路径 B（Canvas）：检测到面板的下载/复制按钮 + 网络结束
   > 只判断聊天区文本会**死等超时**。
3. **生成是「一次性返回 + 界面打字机播放」**。只等网络结束会在**动画播到一半时**抓到答案 ——
   所以「网络结束」与「文本稳定」两个条件都要满足（这点和 DeepSeek 的纯流式不同）。
4. **产物要下载才有原始分辨率**。三种取法实测差了 12 倍（**指文件大小**，像素总数差约 10 倍）：

   | 方式 | 分辨率 | 大小 |
   | --- | --- | --- |
   | 元素截图 | 885×484 | 0.78 MB |
   | 页面内 canvas | 1024×559 | 1.40 MB |
   | **面板「下载」按钮** | **2816×1536** | **9.34 MB** |

   页面显示的和 canvas 能取的**都只是缩略图**。实现用 `acceptDownloads: true` + download 事件。
   ⚠️ 图片的下载按钮**只在 hover 时出现**，需要先 `mouse.move` 到图片中心等约 2 秒。
5. **产物文件名由服务器给出**（含语言/类型信息，可直接用作文件名）：
   - SVG → `gemini-svg.svg`
   - 代码 → `gemini-code-<时间戳>.py`
   - 图片 → `Gemini_Generated_Image_<random>.png`
6. **回答正文容器优先级**：`.model-response-text` / `.markdown-main-panel` 是纯净正文；
   `<model-response>` 自身的 `innerText` 含「Gemini 说」前缀，只在兜底时用。
7. **上标会被切碎**：`O(n^2)` 抽成 `O(n\n2\n)` —— Gemini 用 `<sup>` 渲染，
   需要自写 DOM 遍历（上标压紧、行内不换行、块级换行）。
8. **会话 URL 格式**：`https://gemini.google.com/app/<16位十六进制>`；
   无 ID 的 `/app` 是**新对话页**，不是会话。
9. **模型选择器的 aria 用中文弯引号**：如 `打开模式选择器，当前模式为“Pro”` ——
   正则必须同时兼容直引号与弯引号（`“”` / `""`）。

### 站点改版了怎么办

**普通用户**：跑 `doctor --deep --json` 确认是选择器漂移（报 `SITE_CHANGED` / `COMPOSER_NOT_FOUND`）后，
提 issue 等上游发版即可，不需要自己改代码。

**维护者**：站点层改动通常只需改 **`scripts/gmb/src/site.mjs`**（选择器集中在此）：

```bash
# 在 skill 根目录执行
node "$SKILL_ROOT/scripts/gmb/cli.mjs" doctor --deep --html --json   # 定位漂移
# 改 scripts/gmb/src/site.mjs
node "$SKILL_ROOT/scripts/gmb/cli.mjs" doctor --deep --json          # 改完必须重跑，确认探测通过
node "$SKILL_ROOT/scripts/gmb/tests/sanitize.test.mjs"               # 仅覆盖脱敏/限额，与选择器无关
```

> 若站点连登录流程或浏览器行为也改了，可能还需调整 `scripts/gmb/src/browser.mjs`。

## 边界

- **低频辅助工具**：每次问答会真实打开浏览器窗口，不适合批量调用；
  生图 / Canvas 类请求单次可达 30–60 秒，属正常。
- **不做批量 / 不做并发**：同一时间只跑一个会话。
- **不做 web2api**：只在本机驱动官方网页，不逆向私有协议、不做 HTTP 代理、不对外暴露接口。
- **不生视频 / 生音频**：可理解图片与文件，但不产出音视频。
- **模型是固定几档**（Flash-Lite / Flash / Pro），不能自选版本号。
- **Google 账号风控**：建议用小号（别用主账号）；被登出时会停下要求人工重登，不会硬试。
- **合规风险**：自动化驱动网页版可能违反 Google 服务条款，详见文首警告。

## 项目结构

```
LICENSE                 MIT 许可证
SKILL.md                给 agent 的说明书
README.md               本文件
references/
  install.md            安装 + 登录持久化原理（排障必读）
  failure-taxonomy.md   失败码 → 动作
  site-map.md           站点交互地图（含 Canvas / 产物下载的坑）
  protocol.md           [GMB] 协作协议
scripts/gmb/
  cli.mjs               命令面 + JSON 契约
  src/browser.mjs       浏览器探测 + 三重登录保险 + cookie 判定
  src/site.mjs          站点层（输入、完成判定、模型选择器、Canvas、产物下载）
  src/sanitize.mjs      发送前确定性净化闸门
  src/session.mjs       线程 / 检查点 / 审计
  src/paths.mjs         状态目录布局
  src/logger.mjs        脱敏日志
  tests/sanitize.test.mjs   14 项净化闸门单测
```

## 同族项目

三个「网页版大脑」共享同一套机制层，但**各自独立仓库、独立 skill、互不依赖**：

| | deepseek-brain | gemini-brain | doubao-brain |
| --- | --- | --- | --- |
| CLI（均为文档简写，实际入口是 `node <仓库>/scripts/<cli>/cli.mjs`） | `dsb` | `gmb` | `dbb` |
| 定位 | 推理 + 联网搜索 | **生图 + 代码 Canvas** | 生图 + 生视频 + 音乐/播客 |
| 生图 | ✗ | ✓（2816×1536 原图） | ✓（2048×2048） |
| 生视频 | ✗ | ✗ | ✓（1280×720） |
| 模型可选 | ✗（只有思考/搜索开关） | ✓（Flash-Lite / Flash / Pro） | ✓（快速 / 2.1 Turbo） |
| 登录持久化 | 简单 | **复杂**（需三重保险） | 简单 |

> 上表涉及他仓的信息均为**编写时**的观察，未在本仓库核实，仅供参考；
> 请以 [deepseek-brain](https://github.com/ops120/deepseek-brain) 与 [doubao-brain](https://github.com/ops120/doubao-brain) 的最新 README 为准。

## 许可证

本项目基于 MIT License 开源，完整条款见 [LICENSE](LICENSE)。

## 社区

本项目在 [LINUX DO](https://linux.do/) 社区进行开源推广，感谢社区佬友的交流、反馈与建议。
