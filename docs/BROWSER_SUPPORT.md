# Chrome / Firefox 双版本说明

项目使用一套 React、领域模型和数据层，同时输出 Chrome 与 Firefox 两个 Manifest V3 构建，不维护重复页面。

## 兼容方式

| 能力 | Chrome | Firefox |
| --- | --- | --- |
| 侧边栏清单项 | `side_panel` | `sidebar_action` |
| 浮窗入口 | 后台调用 `chrome.sidePanel.open()` | 提示工具栏图标或 `Alt+Shift+G` 快捷键 |
| 工具栏图标行为 | 打开 Side Panel | 切换 Sidebar |
| 生产目录 | `.output/chrome-mv3/` | `.output/firefox-mv3/` |

WXT 根据构建目标从同一个 `entrypoints/sidepanel/` 入口生成对应清单项。Firefox 不会把 ChatGPT 页面内的浮窗点击当作允许 `sidebarAction.open()` 的扩展用户操作，因此浮窗只显示打开方法；工具栏图标和 `Alt+Shift+G` 快捷键由 Firefox 原生事件直接打开 Sidebar，不会降级为新标签页。浏览器差异集中在 `platform/sidebar.ts`。

Firefox Sidebar 的左/右位置是浏览器级用户设置，扩展无法指定。Firefox 136 及以上可在侧栏底部点击齿轮，将侧栏位置改为右侧。

## 构建与打包

```bash
npm run build:chrome
npm run build:firefox
npm run build

npm run zip:chrome
npm run zip:firefox
npm run zip
```

Firefox Manifest 固定了附加组件 ID，供后续 Mozilla Add-ons 签名与升级使用。清单声明 ChatGPT 页面内容访问、本地存储和百炼父节点推荐权限；其他 AI 厂商通过可选权限在用户操作时只申请对应 HTTPS 域名。项目不包含账号或云同步。

本地临时安装和发布包路径见项目根目录的 [README](../README.md)。
