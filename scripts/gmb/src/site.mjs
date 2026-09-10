import fs from "node:fs";
import path from "node:path";

/**
 * gemini.google.com 页面交互层
 *
 * 所有选择器均来自真机验证（2026-09），完整记录见 references/site-map.md。
 * 与 DeepSeek 的关键差异：
 *   - 输入框是 contenteditable（Quill），不能用 React setter 注入
 *   - 代码/长内容走 Canvas 面板，答案不在聊天区
 *   - 图片/代码通过面板的「下载」按钮取原文件（不是 blob fetch）
 */

export const SITE_URL = "https://gemini.google.com/app";

/** 会话 URL：https://gemini.google.com/app/<16位十六进制>；无 ID 的是新对话页 */
export const CONV_URL_RE = /\/app\/[0-9a-f]{16}/;

export const LABELS = {
  editor: "为 Gemini 输入提示",
  modelSelector: "打开模式选择器",
  newChat: "发起新对话",
  copy: "复制",
  download: "下载",
};

/** 生成请求端点（完成判定的网络信号） */
export const COMPLETION_URL_PART = "StreamGenerate";

export async function gotoSite(page, url = SITE_URL) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
}

/* --------------------------------- 状态探测 --------------------------------- */

export const STATE_FN = () => {
  const body = document.body ? document.body.innerText || "" : "";
  const ce = [...document.querySelectorAll('[contenteditable="true"]')].filter((e) => e.getClientRects().length);
  return {
    url: location.href,
    title: document.title,
    hasEditor: ce.length > 0,
    editorCount: ce.length,
    // 注意：未登录也可能有编辑器，不能只看这个
    signedOut: document.querySelectorAll(".signed-out-buttons").length,
    hasSignInButton: [...document.querySelectorAll("button,a")].some((e) => (e.innerText || "").trim() === "登录"),
    challenge: /证明您不是自动程序|reCAPTCHA|人机验证|unusual traffic/i.test(`${document.title} ${body.slice(0, 1500)}`),
    rateLimited: /请求过于频繁|too many requests|稍后再试|已达到上限|try again later/i.test(body),
    consent: /我同意|接受并继续|accept all|before you continue/i.test(body.slice(0, 800)),
    textSample: body.replace(/\s+/g, " ").trim().slice(0, 240),
  };
};

export async function pageState(page) {
  return page.evaluate(STATE_FN);
}

/** 等输入框就绪（不做登录判定——登录必须看 cookie） */
export async function waitForEditor(page, { timeoutMs = 1800000, pollMs = 3000, onTick } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(STATE_FN).catch(() => null);
    if (last?.hasEditor) return { ok: true, state: last };
    onTick?.(last, Date.now() - started);
    await page.waitForTimeout(pollMs);
  }
  return { ok: false, state: last };
}

/* --------------------------------- 输入与发送 -------------------------------- */

/**
 * 注入 prompt。
 * ⚠️ 必须一次性插入：`keyboard.type()` 逐字符输入时，Quill 会把换行当作发送信号，
 *    导致长 prompt 被拦腰截断（实测踩过，prompt 被切成两段）。
 *    React setter 法对 contenteditable 无效。
 */
export async function injectPrompt(page, text) {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor({ state: "visible", timeout: 20000 });
  await editor.click();
  await page.waitForTimeout(300);

  const insert = async (t) =>
    page.evaluate((value) => {
      const ed = document.querySelector('[contenteditable="true"]');
      if (!ed) return { ok: false, len: 0 };
      ed.focus();
      const ok = document.execCommand("insertText", false, value);
      return { ok, len: (ed.innerText || "").length };
    }, t);

  const first = await insert(text);
  const expected = text.replace(/\s+/g, " ").trim().length;
  // 大文本可能一次插不全，补插剩余部分
  if (first.len < expected * 0.9) {
    for (let i = 0; i < 3; i++) {
      const cur = await page.evaluate(() => (document.querySelector('[contenteditable="true"]')?.innerText || "").length);
      if (cur >= expected * 0.9) break;
      await insert(text.slice(cur));
      await page.waitForTimeout(400);
    }
  }
  await page.waitForTimeout(400);
  const finalLen = await page.evaluate(() => (document.querySelector('[contenteditable="true"]')?.innerText || "").length);
  return { ok: finalLen > 0, valueLength: finalLen, expected };
}

export async function sendPrompt(page) {
  await page.locator('[contenteditable="true"]').first().press("Enter");
  await page.waitForTimeout(1500);
  // 兜底：找发送按钮
  const box = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const hit = btns.find((b) => /发送|send/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`));
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    if (r.width < 8) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (box) {
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1200);
    return { ok: true, method: "button" };
  }
  return { ok: true, method: "enter" };
}

/* ---------------------------------- 模型选择器 -------------------------------- */

/** 读取当前模型（从选择器 aria-label 解析，形如「打开模式选择器，当前模式为“Pro”」）
 *  注意：引号是中文弯引号 “ ”，正则必须兼容直引号与弯引号。
 */
export async function readModel(page) {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll("button,[role=button]")].find((b) =>
      /打开模式选择器/.test(b.getAttribute("aria-label") ?? "")
    );
    if (!btn) return null;
    const label = btn.getAttribute("aria-label") ?? "";
    const m = label.match(/当前模式为\s*[“"『「]?\s*([^”"』」]+?)\s*[”"』」]?\s*$/);
    const fallback = (btn.innerText || "").trim();
    return { raw: label, current: m ? m[1].trim() : fallback || null };
  });
}

/** 切换模型：点开选择器 → 选目标项。返回切换前后的模型名。 */
export async function setModel(page, target) {
  const before = await readModel(page);
  if (!before) return { ok: false, reason: "SITE_CHANGED", message: "未找到模型选择器" };
  if (target === null || target === undefined) return { ok: true, before: before.current, after: before.current, clicked: false };
  if (before.current?.toLowerCase().includes(String(target).toLowerCase())) {
    return { ok: true, before: before.current, after: before.current, clicked: false };
  }

  // 点开选择器
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button,[role=button]")].find((b) =>
      /打开模式选择器/.test(b.getAttribute("aria-label") ?? "")
    );
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    btn.click();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!opened) return { ok: false, reason: "SITE_CHANGED", message: "模型选择器不可点击" };
  await page.waitForTimeout(1500);

  // 在弹出菜单里找目标项
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"], [role="option"], .mat-mdc-menu-item, button')]
      .map((e) => {
        const r = e.getBoundingClientRect();
        return {
          text: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
          visible: r.width > 10 && r.height > 10,
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
        };
      })
      .filter((o) => o.visible && o.text.length > 0)
  );

  const hit = options.find((o) => o.text.toLowerCase().includes(String(target).toLowerCase()));
  if (!hit) {
    await page.keyboard.press("Escape");
    return { ok: false, reason: "INVALID_ARGUMENTS", message: `模型列表里没有「${target}」`, options: options.map((o) => o.text) };
  }
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(2000);
  const after = await readModel(page);
  return { ok: true, before: before.current, after: after?.current ?? null, clicked: true };
}

/* ---------------------------------- 完成判定 --------------------------------- */

/**
 * 监听生成请求（主判据：页面自身的 StreamGenerate 流结束 = 生成结束）
 */
export function watchCompletion(page, urlPart = COMPLETION_URL_PART) {
  const state = { seen: false, done: false, failed: false };
  const match = (req) => req.url().includes(urlPart);
  const onRequest = (req) => match(req) && (state.seen = true);
  const onFinished = (req) => match(req) && (state.done = true);
  const onFailed = (req) => match(req) && (state.failed = true);
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  return {
    get state() {
      return { ...state };
    },
    reset() {
      state.seen = false;
      state.done = false;
      state.failed = false;
    },
    dispose() {
      page.off("request", onRequest);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    },
  };
}

/** 面板（Canvas）是否已就绪：出现下载/复制按钮即视为就绪 */
export const PANEL_FN = () => {
  const buttons = [...document.querySelectorAll("button, [role=button]")]
    .map((b) => ({
      label: `${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`.trim(),
      visible: b.getBoundingClientRect().width > 0,
    }))
    .filter((b) => b.visible && /下载|复制|download|copy/i.test(b.label));
  const panelEl = [...document.querySelectorAll("*")].find((e) =>
    /canvas|artifact|code-panel/i.test(typeof e.className === "string" ? e.className : "")
  );
  return {
    hasPanel: !!panelEl,
    buttons,
    downloadLabel: buttons.find((b) => /下载|download/i.test(b.label))?.label ?? null,
  };
};

/** 回答区状态：聊天区文本 + 面板状态 */
export const EXTRACT_FN = () => {
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const clean = (s) =>
    (s || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  /** 自己遍历 DOM 取文本：行内元素不换行，上标/下标压紧，块级元素换行 */
  const BLOCK = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "section", "article", "table", "ul", "ol"]);
  const collectText = (node) => {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.nodeValue;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style") continue;
      if (/\bsup\b|\bsub\b/.test(tag)) {
        // 上标/下标：压紧，不加空白（避免 O(n^2) 被切碎）
        out += collectText(el);
        continue;
      }
      if (tag === "br") {
        out += "\n";
        continue;
      }
      if (tag === "tr") out += "\n";
      if (tag === "td" || tag === "th") out += " | ";
      const isBlock = BLOCK.has(tag);
      if (isBlock) out += "\n";
      out += collectText(el);
      if (isBlock) out += "\n";
    }
    return out;
  };

  // 语义化自定义元素（Gemini 用的不是哈希类名）
  const responses = [...document.querySelectorAll("model-response")].filter(visible);
  const last = responses[responses.length - 1] ?? null;
  // 正文容器优先级（实测 2026-09）：
  //   .model-response-text / .markdown-main-panel 是纯净正文；
  //   model-response 自身 innerText 含「Gemini 说」前缀，只在兜底时用。
  const bodyEl =
    last?.querySelector(".model-response-text") ??
    last?.querySelector(".markdown-main-panel") ??
    last?.querySelector(".message-content") ??
    last;
  let text = bodyEl ? clean(collectText(bodyEl)) : "";
  // 兜底清理「Gemini 说」前缀
  text = text.replace(/^Gemini\s*说\s*/i, "").trim();

  const buttons = [...document.querySelectorAll("button, [role=button]")]
    .map((b) => ({
      label: `${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`.trim(),
      visible: b.getBoundingClientRect().width > 0,
    }))
    .filter((b) => b.visible && /下载|复制|download|copy/i.test(b.label));

  return {
    text,
    textLen: text.length,
    responseCount: responses.length,
    stopVisible: [...document.querySelectorAll("div,button,span")].some(
      (el) => el.children.length === 0 && /^(停止|Stop)$/.test((el.textContent || "").trim()) && el.getClientRects().length > 0
    ),
    hasPanel: !!document.querySelector("[class*='canvas'], [class*='artifact']"),
    buttons,
    downloadLabel: buttons.find((b) => /下载|download/i.test(b.label))?.label ?? null,
    url: location.href,
  };
};

export async function snapshotMarkers(page) {
  try {
    return await page.evaluate(EXTRACT_FN);
  } catch {
    return { text: "", textLen: 0, responseCount: 0, hasPanel: false, buttons: [] };
  }
}

/**
 * 等本次回答完成。
 *
 * 两条路径（缺一不可）：
 *   A. 聊天区模式：StreamGenerate 结束 + 文本连续 N 次采样不变
 *   B. Canvas 模式：代码/长内容进面板时聊天区永远为空 → 检测面板按钮 + 网络结束
 *
 * ⚠️ Gemini 常见「一次性返回完整回答 → 界面逐字播放」，
 *    只等网络结束会在打字机动画播到一半时抓到答案，所以两个条件都要满足。
 */
export async function waitForAnswer(page, { timeoutMs = 300000, pollMs = 2500, stableSamples = 3, completion = null, onPoll } = {}) {
  const started = Date.now();
  let last = "";
  let stable = 0;
  let canvasSettled = false;
  let lastState = null;

  while (Date.now() - started < timeoutMs) {
    lastState = await page.evaluate(EXTRACT_FN).catch(() => null);
    const cs = completion?.state ?? { seen: false, done: false, failed: false };
    const netIdle = !cs.seen || cs.done || cs.failed;

    if (lastState) {
      const t = lastState.text ?? "";
      // 路径 A
      if (netIdle && t.length > 0 && t === last) stable++;
      else stable = 0;
      last = t;

      // 路径 B：面板出现下载按钮 + 网络结束 → 再等一小段确保渲染完
      if (lastState.downloadLabel && netIdle) {
        if (!canvasSettled) {
          canvasSettled = true;
          onPoll?.({ phase: "canvas-detected", downloadLabel: lastState.downloadLabel });
          await page.waitForTimeout(4000);
          continue;
        }
      }

      onPoll?.({
        len: t.length,
        stable,
        net: `${cs.seen ? "seen" : "-"}/${cs.done ? "done" : cs.failed ? "failed" : "-"}`,
        panel: lastState.downloadLabel ?? "-",
      });

      if (netIdle && t.length > 0 && stable >= stableSamples) {
        return { ok: true, ...lastState, mode: "chat", elapsedMs: Date.now() - started };
      }
      if (canvasSettled && netIdle) {
        return { ok: true, ...lastState, mode: "canvas", elapsedMs: Date.now() - started };
      }
    }
    await page.waitForTimeout(pollMs);
  }
  return { ok: false, reason: "STREAM_STALLED", ...(lastState ?? {}), elapsedMs: Date.now() - started };
}

/* ---------------------------------- 产物下载 --------------------------------- */

/**
 * 点击面板的下载按钮，把服务器原始文件存到 outDir。
 * 适用于：生成的图片（下载完整尺寸的图片）、SVG（下载 SVG）、代码（下载代码）
 */
export async function downloadArtifact(page, ctx, outDir, { timeoutMs = 60000 } = {}) {
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll("button, [role=button]")]
      .map((b) => {
        const r = b.getBoundingClientRect();
        return {
          label: `${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""}`.trim(),
          visible: r.width > 0 && r.height > 0,
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
        };
      })
      .filter((b) => b.visible && /下载|download/i.test(b.label))
  );
  if (!buttons.length) return { ok: false, reason: "NOT_FOUND", message: "页面上没有下载按钮" };

  // 优先「完整尺寸」/「下载 SVG」/「下载代码」这类明确的，否则第一个
  const btn =
    buttons.find((b) => /完整尺寸|full/i.test(b.label)) ??
    buttons.find((b) => /下载\s*(SVG|代码|图片)|download\s*(svg|code|image)/i.test(b.label)) ??
    buttons[0];

  const saved = [];
  const onDownload = async (d) => {
    try {
      const file = path.join(outDir, d.suggestedFilename());
      await d.saveAs(file);
      saved.push({ file, suggested: d.suggestedFilename(), bytes: fs.statSync(file).size });
    } catch (error) {
      saved.push({ ok: false, error: String(error).slice(0, 150) });
    }
  };
  page.on("download", onDownload);
  try {
    await page.mouse.click(btn.x, btn.y);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await page.waitForTimeout(800);
      if (saved.length) break;
    }
  } finally {
    page.off("download", onDownload);
  }
  return saved.length ? { ok: true, label: btn.label, files: saved } : { ok: false, reason: "SEND_FAILED", message: "点击下载后没有触发下载事件" };
}
