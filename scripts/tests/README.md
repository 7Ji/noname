# 国战角色称呼本地验证

这些测试单独保留，供测试分支使用；不包含在功能提交内。

## 源码隔离验证

在仓库根目录运行：

```sh
node scripts/tests/guozhan-names.test.mjs
```

使用仓库已有的 TypeScript 解析器提取并执行生产方法。覆盖公开称呼、槽位替换、当前座次、换座与连续移位、通用联机快照、日志、新旧录像、资料入口权限、其他模式以及卡牌动画事件来源。录像换将按生产分发方式调用处理表，并断言角色刷新次数。

## Chromium 集成验证

需要 Chromium、Playwright 和两个本地服务。Playwright 可以安装在独立临时目录，不必修改项目依赖。

在仓库根目录启动文件服务：

```sh
node packages/fs/dist/entry.cjs --debug --dirname=apps/core
```

在 `apps/core` 启动开发服务器：

```sh
node_modules/.bin/vite --host 127.0.0.1 --port 8081 --strictPort
```

在仓库根目录执行浏览器脚本：

```sh
NONAME_PLAYWRIGHT_PATH=/tmp/noname-playwright/node_modules/playwright \
node scripts/tests/guozhan-browser.test.mjs
```

可通过 `CHROMIUM_PATH`、`NONAME_TEST_URL` 和 `NONAME_TEST_OUTPUT` 指定浏览器、服务地址和结果目录。默认结果目录为 `/tmp/noname-guozhan-browser`，其中保存 JSON 结果和截图。

脚本在隔离浏览器上下文中实际启动普通国战、九变和身份模式。每种国战执行 768 种组合：录像/实时、旁观/参与、他人/自己/受控、四种明暗状态、桌面/手机布局、简略/完整菜单及四种主副将存在状态。检查标题、资料入口、点击目标和头像，同时覆盖打开菜单后暗置、替换或移除武将、自定义介绍、链接角色、触屏事件、通用快照恢复、自然开局座次及轮次、实战与录像换座和真实录像换将函数。

最后通过正式弹窗路径和 Playwright 鼠标点击，在 1280px 与 390px 视口分别打开主副将资料，核对资料名称、按钮尺寸、可见范围与同行排列。身份模式检查原有“查看资料”入口。

联机部分验证的是序列化状态及恢复逻辑，没有建立多个客户端之间的网络连接；录像部分验证初始化数据和生产处理函数，没有播放一份完整历史录像。浏览器组合检查使用真实引擎和 DOM，并在暂停的游戏中构造角色状态；不代表每种状态均通过自然对局产生。
