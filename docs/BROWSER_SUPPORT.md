# Chrome / Firefox 双版本说明

项目使用一套 React、领域模型和数据层，同时输出 Chrome 与 Firefox 两个 Manifest V3 构建，不维护重复页面。

## 兼容方式

| 能力 | Chrome | Firefox |
| --- | --- | --- |
| 侧边栏清单项 | `side_panel` | `sidebar_action` |
| 后台打开方式 | `chrome.sidePanel` | `browser.sidebarAction` |
| 工具栏图标行为 | 打开 Side Panel | 切换 Sidebar |
| 生产目录 | `.output/chrome-mv3/` | `.output/firefox-mv3/` |

WXT 根据构建目标从同一个 `entrypoints/sidepanel/` 入口生成对应清单项。浏览器差异集中在 `platform/sidebar.ts`，其余业务代码保持共享。

## 构建与打包

```bash
npm run build:chrome
npm run build:firefox
npm run build

npm run zip:chrome
npm run zip:firefox
npm run zip
```

Firefox Manifest 固定了附加组件 ID，供后续 Mozilla Add-ons 签名与升级使用。清单只声明 ChatGPT 页面内容访问、本地存储和可选百炼父节点推荐所需权限；项目不包含账号或云同步。

本地临时安装和发布包路径见项目根目录的 [README](../README.md)。
