# Gemini 网页版交互地图（仅诊断 / 维护用）

> 正常流程一律走 `gmb` CLI，不要读本文件去手写 DOM 操作。
> 本文件只在 `SITE_CHANGED` 诊断或维护选择器时使用。
> **全部来自真机验证（2026-09，Windows / Chrome 151 / Playwright）**。

## 页面结构

- **输入框**：`div.ql-editor[contenteditable="true"]`（Quill 富文本），外层 `<rich-textarea>`
  - 定位锚点：`aria-label="为 Gemini 输入提示"`（稳定）
  - **不是 textarea**，React setter 注入法无效
- **发送**：`Enter` 可发送
- **模型选择器**：按钮 `aria-label="打开模式选择器，当前模式为"Pro""`
  - **aria 里带当前模型名**，可直接解析出当前生效模型
  - 可选：Flash-Lite（极速）/ Flash（全方位）/ Pro（高级推理，含"扩展思考"）
  - 点开是 Material 菜单（`[role="menuitem"]` / `.mat-mdc-menu-item`）
- **工具栏按钮 aria**：`上传和工具`、`语音输入 (^⇧D)`
- **侧栏**：`发起新对话`、会话历史（`<a href="/app/<id>">`）

## 回答 DOM（语义化自定义元素，非哈希类名）

| 元素 | 用途 |
| --- | --- |
| `<model-response>` | 单条模型回答容器 |
| `<response-container>` | 回答内部容器 |
| `.message-content` | **纯净正文**（推荐用这个） |
| `<user-query>` | 用户提问 |
| `<chat-window>` | 整个对话窗口 |
| `<rich-textarea>` | 输入框 |
| `<chat-loading-animation>` | 生成中动画 |

**注意**：`model-response` 的 `innerText` 含前缀「Gemini 说」
（如 `"Gemini 说 可以"`），而 `.message-content` 是纯净的 `"可以"`。**用后者。**

## ⚠️ Canvas 面板（最容易踩坑的地方）

**Gemini 对「写代码 / 长内容」类请求会开 Canvas 面板**，代码在里面，**聊天区永远为空**。

- 表现：`.message-content` 长度为 0，但网络已完成
- 面板按钮（中文界面）：
  - `复制提示` / `复制代码` / `下载代码` → 产出 `gemini-code-<时间戳>.py`
  - `复制 SVG` / `下载 SVG` → 产出 `gemini-svg.svg`
  - `下载完整尺寸的图片` → 产出 `Gemini_Generated_Image_<random>.png`
- **完成判定必须双路径**（只判断聊天区文本会死等超时）：
  - 路径 A（聊天区）：`StreamGenerate` 结束 + 文本连续 N 次采样不变
  - 路径 B（Canvas）：检测到面板下载按钮 + 网络结束

## 生成请求端点

```
gemini.google.com/_/BardChatUi/data/batchexecute                              (通用 RPC，23x)
gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate  (生成，主判据)
```

**⚠️ 与 DeepSeek 的关键差异**：Gemini 常见「一次性返回完整回答 → 界面逐字打字机播放」。
只等网络结束会在**动画播到一半时**抓到答案，所以「网络结束」与「文本稳定」两个条件都要满足。

## 会话 URL

```
https://gemini.google.com/app/<16位十六进制>
例：https://gemini.google.com/app/2365c02ac27ab65d
```
- 无 ID 的 `/app` 是**新对话页**，不是会话
- 侧栏历史项的 `href` 直接给出会话 ID

## 输入注入（关键）

**必须一次性插入**（`execCommand("insertText")`）。
`keyboard.type()` 逐字符输入时，Quill 会把**换行当作发送信号**，
导致长 prompt 被拦腰截断（实测：prompt 被切成两段，第一段发出、第二段留在输入框）。

## 产物下载（v1 已确认）

| 内容 | 下载按钮 aria | 产物文件名 | 实测大小 |
| --- | --- | --- | --- |
| 生成图片 | `下载完整尺寸的图片` | `Gemini_Generated_Image_<random>.png` | **2816×1536 / 9.34 MB** |
| SVG | `下载 SVG` | `gemini-svg.svg` | 8199 B |
| 代码 | `下载代码` | `gemini-code-<ts>.py` | 620 B |

**⚠️ 图片必须走下载按钮**：页面显示的和 canvas 能取的都只是**缩略图**（1024×559 / 1.4 MB），
下载按钮给的是原图（2816×1536 / 9.34 MB），**差 12 倍**。

**实现要点**：
1. `acceptDownloads: true` **必须显式设置**，否则 download 事件不触发
2. 图片的「下载」按钮**只在 hover 图片时出现** → 先 `mouse.move` 到图片中心，等约 2 秒
3. `blob:` URL 无法用 `fetch`/`ctx.request` 取（跨上下文 / 协议不支持）——不要走这条路

## 失败形态

- 未登录：**cookie 里无 `SID`/`__Secure-1PSID`**（不要看界面，未登录时「登录」按钮会被隐藏）
- reCAPTCHA：`证明您不是自动程序` / reCAPTCHA iframe
- 限流：`请求过于频繁` / `too many requests`
- 站点改版：`rich-textarea` / `model-response` / 模型选择器定位失败

## 维护规则

- 选择器集中在 `scripts/gmb/src/site.mjs`，改完跑 `doctor --deep` 与单测。
- 不要在别处散落选择器。
