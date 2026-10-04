import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(".output/chrome-mv3");
const sidePanelPath = resolve(outputDirectory, "sidepanel.html");
const previewPath = resolve(outputDirectory, "preview.html");
const html = await readFile(sidePanelPath, "utf8");

const browserMock = String.raw`<script>
  (() => {
    const localState = Object.create(null);
    const event = { addListener() {}, removeListener() {} };
    globalThis.chrome = {
      runtime: {
        id: "discussion-map-preview",
        getManifest() { return { version: "1.0.0" }; },
        onMessage: event,
        async sendMessage() { return undefined; },
      },
      storage: {
        onChanged: event,
        local: {
          async get(keys) {
            if (typeof keys === "string") return { [keys]: localState[keys] };
            if (Array.isArray(keys)) {
              return Object.fromEntries(keys.map((key) => [key, localState[key]]));
            }
            return { ...localState };
          },
          async set(values) { Object.assign(localState, values); },
          async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete localState[key];
          },
        },
      },
      permissions: {
        async contains() { return true; },
        async request() { return true; },
      },
      tabs: {
        onActivated: event,
        onUpdated: event,
        async sendMessage() { return undefined; },
        async query() {
          return [{
            id: 1,
            active: true,
            url: "https://chatgpt.com/c/local-preview",
            title: "本地验收对话 | ChatGPT",
          }];
        },
        async create({ url }) {
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          return { id: 2, url };
        },
      },
    };
  })();
</script>`;

const reviewPreviewStyle = String.raw`<style>
  #review-v1-launcher {
    position: fixed;
    z-index: 2147483000;
    right: 18px;
    top: 18px;
    padding: 10px 14px;
    border: 1px solid #6d28d9;
    border-radius: 999px;
    background: #7c3aed;
    color: #fff;
    box-shadow: 0 10px 30px rgba(76, 29, 149, .25);
    font: 700 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }

  #review-v1-preview[hidden] { display: none !important; }
  #review-v1-preview {
    position: fixed;
    z-index: 2147483001;
    inset: 0;
    overflow: auto;
    box-sizing: border-box;
    padding: 24px;
    background:
      radial-gradient(circle at 10% 0%, rgba(196, 181, 253, .44), transparent 30%),
      radial-gradient(circle at 100% 80%, rgba(191, 219, 254, .35), transparent 28%),
      #f4f6fa;
    color: #172033;
    font: 13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .review-preview__frame {
    width: min(1180px, calc(100vw - 48px));
    min-width: 940px;
    margin: 0 auto;
  }

  .review-preview__topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 14px;
    padding: 13px 16px;
    border: 1px solid #ddd6fe;
    border-radius: 16px;
    background: rgba(255, 255, 255, .92);
    box-shadow: 0 12px 36px rgba(51, 65, 85, .08);
    backdrop-filter: blur(10px);
  }

  .review-preview__brand,
  .review-preview__top-actions,
  .review-preview__entrypoints,
  .review-preview__metadata,
  .review-preview__toolbar,
  .review-preview__module-title,
  .review-preview__tags,
  .review-preview__evidence-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .review-preview__logo {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 11px;
    background: linear-gradient(145deg, #7c3aed, #4f46e5);
    color: #fff;
    font-size: 17px;
    box-shadow: 0 8px 18px rgba(109, 40, 217, .28);
  }

  .review-preview__brand strong { display: block; font-size: 14px; }
  .review-preview__brand small { display: block; color: #64748b; }

  .review-preview__pill,
  .review-preview__tag,
  .review-preview__status {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 999px;
    background: #ede9fe;
    color: #5b21b6;
    font-size: 10px;
    font-weight: 750;
    letter-spacing: .01em;
  }

  .review-preview__pill--version { background: #172033; color: #fff; }
  .review-preview__pill--entry { border: 1px solid #e2e8f0; background: #fff; color: #475569; }
  .review-preview__status--consensus,
  .review-preview__status--decision { background: #dcfce7; color: #166534; }
  .review-preview__status--suggestion { background: #e0f2fe; color: #075985; }
  .review-preview__status--unresolved { background: #fff7ed; color: #9a3412; }
  .review-preview__tag--edited { background: #ede9fe; color: #5b21b6; }

  .review-preview__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 30px;
    padding: 6px 10px;
    border: 1px solid #d7dee8;
    border-radius: 8px;
    background: #fff;
    color: #334155;
    font: inherit;
    font-weight: 650;
  }

  .review-preview__button--primary { border-color: #7c3aed; background: #7c3aed; color: #fff; }
  .review-preview__button--quiet { background: #f8fafc; }
  .review-preview__button--close { width: 32px; padding: 0; font-size: 17px; cursor: pointer; }

  .review-preview__layout {
    display: grid;
    grid-template-columns: minmax(600px, 1.65fr) minmax(320px, .8fr);
    gap: 14px;
    align-items: start;
  }

  .review-preview__panel {
    overflow: hidden;
    border: 1px solid #dce3ec;
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 18px 48px rgba(51, 65, 85, .12);
  }

  .review-preview__panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px 13px;
    border-bottom: 1px solid #eef2f7;
  }

  .review-preview__panel-head h1,
  .review-preview__panel-head h2 { margin: 0; font-size: 17px; letter-spacing: -.01em; }
  .review-preview__panel-head p { margin: 4px 0 0; color: #64748b; font-size: 11px; }
  .review-preview__panel-body { padding: 14px 16px 16px; }

  .review-preview__title {
    margin: 0 0 9px;
    padding: 10px 12px;
    border: 1px solid #d7dee8;
    border-radius: 10px;
    background: #fff;
    font-size: 16px;
    font-weight: 750;
  }

  .review-preview__metadata { margin-bottom: 11px; color: #64748b; font-size: 10px; }
  .review-preview__metadata b { color: #334155; }
  .review-preview__toolbar { margin-bottom: 11px; }

  .review-preview__module {
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid #e3e8f0;
    border-radius: 12px;
    background: #fff;
  }

  .review-preview__module-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 11px;
    background: #f8fafc;
  }

  .review-preview__module-title { font-weight: 750; }
  .review-preview__module-index { color: #7c3aed; font-size: 10px; }
  .review-preview__module-body { padding: 10px 12px 11px; }
  .review-preview__module-summary { margin: 0 0 8px; color: #334155; }
  .review-preview__item { padding: 8px 9px; border-radius: 9px; background: #f8fafc; }
  .review-preview__item + .review-preview__item { margin-top: 7px; }
  .review-preview__item p { margin: 5px 0 0; }

  .review-preview__evidence {
    margin-top: 10px;
    padding: 10px 11px;
    border: 1px solid #93c5fd;
    border-radius: 11px;
    background: #eff6ff;
  }

  .review-preview__evidence-head { justify-content: space-between; color: #1e3a8a; font-weight: 750; }
  .review-preview__quote {
    margin: 8px 0;
    padding: 8px 10px;
    border-left: 3px solid #60a5fa;
    border-radius: 0 8px 8px 0;
    background: #fff;
    color: #334155;
  }

  .review-preview__locator { color: #64748b; font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }

  .review-preview__graph-wrap { padding: 14px; }
  .review-preview__graph-note {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
    color: #64748b;
    font-size: 10px;
  }

  .review-preview__graph {
    position: relative;
    height: 390px;
    overflow: hidden;
    border: 1px solid #e3e8f0;
    border-radius: 14px;
    background:
      linear-gradient(rgba(148, 163, 184, .1) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148, 163, 184, .1) 1px, transparent 1px),
      #f8fafc;
    background-size: 22px 22px;
  }

  .review-preview__graph svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .review-preview__node {
    position: absolute;
    box-sizing: border-box;
    width: 145px;
    padding: 10px;
    border: 1px solid #cbd5e1;
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 7px 18px rgba(51, 65, 85, .1);
  }

  .review-preview__node strong { display: block; font-size: 11px; line-height: 1.35; }
  .review-preview__node small { display: block; margin-top: 4px; color: #64748b; font-size: 9px; }
  .review-preview__node--root { left: 22px; top: 52px; }
  .review-preview__node--current { left: 194px; top: 52px; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
  .review-preview__node--planned { left: 194px; top: 208px; border-style: dashed; border-color: #a78bfa; background: #faf5ff; }
  .review-preview__node--review {
    left: 93px;
    top: 292px;
    width: 178px;
    padding-left: 42px;
    border-color: #8b5cf6;
    background: linear-gradient(145deg, #faf5ff, #f5f3ff);
    box-shadow: 0 9px 22px rgba(124, 58, 237, .18);
  }

  .review-preview__document-icon {
    position: absolute;
    left: 12px;
    top: 11px;
    width: 20px;
    height: 25px;
    border-radius: 4px;
    background: #8b5cf6;
  }

  .review-preview__document-icon::after {
    content: "";
    position: absolute;
    right: 3px;
    top: 6px;
    width: 10px;
    height: 2px;
    border-radius: 2px;
    background: rgba(255,255,255,.9);
    box-shadow: 0 5px 0 rgba(255,255,255,.75), 0 10px 0 rgba(255,255,255,.6);
  }

  .review-preview__legend { display: grid; gap: 8px; margin-top: 11px; }
  .review-preview__legend-row { display: flex; align-items: center; gap: 8px; color: #475569; font-size: 10px; }
  .review-preview__legend-swatch { width: 22px; border-top: 2px dashed #8b5cf6; }
  .review-preview__privacy {
    margin-top: 12px;
    padding: 10px 11px;
    border-radius: 11px;
    background: #f5f3ff;
    color: #5b21b6;
    font-size: 10px;
  }

  @media (max-width: 980px) {
    .review-preview__frame { min-width: 0; }
    .review-preview__layout { grid-template-columns: 1fr; }
    .review-preview__graph { height: 370px; }
  }
</style>`;

const reviewPreviewMarkup = String.raw`<button id="review-v1-launcher" type="button">打开 v1.0 总结演示</button>
<main id="review-v1-preview" hidden aria-label="Chat Graph v1.0 总结截图演示">
  <div class="review-preview__frame">
    <header class="review-preview__topbar">
      <div class="review-preview__brand">
        <span class="review-preview__logo" aria-hidden="true">◇</span>
        <span><strong>Chat Graph · Conversation Review</strong><small>稳定截图模式 · 本地演示数据</small></span>
        <span class="review-preview__pill review-preview__pill--version">v1.0.0</span>
      </div>
      <div class="review-preview__top-actions">
        <div class="review-preview__entrypoints" aria-label="总结入口">
          <span class="review-preview__pill review-preview__pill--entry">页内浮窗 · 总结</span>
          <span class="review-preview__pill review-preview__pill--entry">Side Panel · 总结</span>
          <span class="review-preview__pill review-preview__pill--entry">节点菜单 · 总结此节点</span>
        </div>
        <button id="review-v1-close" class="review-preview__button review-preview__button--close" type="button" aria-label="关闭演示">×</button>
      </div>
    </header>

    <div class="review-preview__layout">
      <section class="review-preview__panel" aria-label="总结结果">
        <header class="review-preview__panel-head">
          <div><h1>对话总结</h1><p>按固定模块浏览、编辑、定位证据并保存到图</p></div>
          <div class="review-preview__tags">
            <span class="review-preview__pill">当前分支</span>
            <span class="review-preview__status review-preview__status--consensus">完成</span>
          </div>
        </header>
        <div class="review-preview__panel-body">
          <div class="review-preview__title">Chat Graph v1.0 总结能力升级</div>
          <div class="review-preview__metadata">
            <span><b>通用复盘</b></span><span>18 条消息</span><span>6 个节点</span><span>约 8.4k tokens</span><span>来源完整</span><span>2026-08-24 04:10</span>
          </div>
          <div class="review-preview__toolbar" aria-label="总结操作">
            <span class="review-preview__button review-preview__button--quiet">调整配置</span>
            <span class="review-preview__button">复制完整总结</span>
            <span class="review-preview__button">复制上下文包</span>
            <span class="review-preview__button review-preview__button--primary">保存到图</span>
          </div>

          <article class="review-preview__module">
            <header class="review-preview__module-head">
              <div class="review-preview__module-title"><span class="review-preview__module-index">01</span><span>我们讨论了什么</span></div>
              <span class="review-preview__tag review-preview__tag--edited">用户已编辑</span>
            </header>
            <div class="review-preview__module-body">
              <p class="review-preview__module-summary">讨论从问题图导航扩展到完整对话复盘，并确定了采集、结构化生成、本地版本和图 artifact 的实现边界。</p>
              <div class="review-preview__item">
                <div class="review-preview__tags"><span class="review-preview__status review-preview__status--consensus">双方共识</span><span class="review-preview__tag">2 条证据</span></div>
                <p>总结支持当前逻辑分支、整个当前对话，以及目标节点与直接父节点的上下文三种范围。</p>
              </div>
              <aside class="review-preview__evidence" aria-label="原始消息依据">
                <div class="review-preview__evidence-head"><span>原始消息依据 · 2</span><span class="review-preview__button">定位原文</span></div>
                <blockquote class="review-preview__quote">“当前分支”只表示 Chat Graph 逻辑祖先路径，不冒充 ChatGPT 原生替代分支。</blockquote>
                <div class="review-preview__locator">assistant · 第 8 条 · turn-8 · evidence excerpt ≤ 240 字</div>
              </aside>
            </div>
          </article>

          <article class="review-preview__module">
            <header class="review-preview__module-head">
              <div class="review-preview__module-title"><span class="review-preview__module-index">02</span><span>我最终做出了什么决定</span></div>
              <span class="review-preview__status review-preview__status--decision">用户决定</span>
            </header>
            <div class="review-preview__module-body">
              <div class="review-preview__item">
                <div class="review-preview__tags"><span class="review-preview__status review-preview__status--decision">用户决定</span></div>
                <p>完整 user / assistant 原文仅在生成任务内存中存在；本地只保存结构化总结、定位信息和最长 240 字证据摘录。</p>
              </div>
            </div>
          </article>

          <article class="review-preview__module">
            <header class="review-preview__module-head">
              <div class="review-preview__module-title"><span class="review-preview__module-index">03</span><span>下一步应该做什么</span></div>
              <span class="review-preview__status review-preview__status--suggestion">助手建议</span>
            </header>
            <div class="review-preview__module-body">
              <div class="review-preview__item">
                <div class="review-preview__tags"><span class="review-preview__status review-preview__status--suggestion">助手建议</span><span class="review-preview__tag">1 条证据</span></div>
                <p>在 Chrome 116+ 与 Firefox 115+ 完成短对话、长对话和证据跳转的发布验收。</p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <aside class="review-preview__panel" aria-label="保存到问题图">
        <header class="review-preview__panel-head">
          <div><h2>保存到图</h2><p>Review Document 是独立 artifact</p></div>
          <span class="review-preview__pill">图视角</span>
        </header>
        <div class="review-preview__graph-wrap">
          <div class="review-preview__graph-note"><span>当前路径高亮</span><span>紫色文档节点 · 虚线关系边</span></div>
          <div class="review-preview__graph" role="img" aria-label="总结 artifact 与问题节点关系图">
            <svg viewBox="0 0 370 390" preserveAspectRatio="none" aria-hidden="true">
              <path d="M 166 84 L 194 84" stroke="#94a3b8" stroke-width="2" fill="none" />
              <path d="M 267 117 C 280 158 278 190 267 208" stroke="#94a3b8" stroke-width="2" fill="none" />
              <path d="M 267 117 C 320 196 285 280 225 302" stroke="#8b5cf6" stroke-width="2.5" stroke-dasharray="7 6" fill="none" />
            </svg>
            <div class="review-preview__node review-preview__node--root"><strong>明确 v1.0 产品边界</strong><small>逻辑根节点 · 已确认</small></div>
            <div class="review-preview__node review-preview__node--current"><strong>实现对话总结升级</strong><small>Current · 6 个引用</small></div>
            <div class="review-preview__node review-preview__node--planned"><strong>完成双浏览器真实验收</strong><small>planned · 尚无原文定位</small></div>
            <div class="review-preview__node review-preview__node--review">
              <span class="review-preview__document-icon" aria-hidden="true"></span>
              <strong>Chat Graph v1.0 总结能力升级</strong><small>Review Document · v2</small>
            </div>
          </div>
          <div class="review-preview__legend">
            <div class="review-preview__legend-row"><span class="review-preview__legend-swatch"></span><span>总结关系不参与 Current、status 或父节点推荐</span></div>
            <div class="review-preview__legend-row"><span class="review-preview__pill">planned</span><span>实际发送相同问题后升级为 captured</span></div>
          </div>
          <div class="review-preview__privacy"><strong>本地优先</strong><br>原文仅临时发送给当前 Provider；总结、版本、定位与短证据保存在本地。</div>
        </div>
      </aside>
    </div>
  </div>
</main>
<script>
  (() => {
    const launcher = document.getElementById("review-v1-launcher");
    const preview = document.getElementById("review-v1-preview");
    const close = document.getElementById("review-v1-close");
    const sync = () => {
      const isOpen = location.hash === "#review-v1";
      preview.hidden = !isOpen;
      launcher.hidden = isOpen;
      document.documentElement.style.overflow = isOpen ? "hidden" : "";
    };
    launcher.addEventListener("click", () => { location.hash = "review-v1"; });
    close.addEventListener("click", () => {
      history.replaceState(null, "", location.pathname + location.search);
      sync();
    });
    addEventListener("hashchange", sync);
    sync();
  })();
</script>`;

const previewHtml = html
  .replace("</head>", `${browserMock}\n${reviewPreviewStyle}\n  </head>`)
  .replace("</body>", `${reviewPreviewMarkup}\n  </body>`);
await writeFile(previewPath, previewHtml, "utf8");
console.log(`${previewPath}#review-v1`);
