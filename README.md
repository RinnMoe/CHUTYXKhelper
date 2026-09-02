# TYXKhelper

这是一个 Tampermonkey/Violentmonkey 用户脚本，用于 `https://stuh5.chd.edu.cn/*`体育选课辅助。

## 脚本行为

- 在页面加载早期安装网络请求补丁。
- 将目标域名的 XHR 和 `uni.request` 超时时间扩大到 24 小时。
- 阻止目标域名的 XHR `abort()`，并替换页面传入的 `fetch` `AbortSignal`。
- 对目标域名的 GET/HEAD 请求最多发起两次：第一次立即发送，第二次默认延迟 1500ms；以第一个成功结果为准。
- POST、PUT、PATCH、DELETE 等写请求始终只发送一次。
- 非目标域名请求保持原有行为。

脚本会修改页面的网络 API 和站点内部请求模块，站点更新后可能失效，也可能影响请求取消语义。遇到异常时，在 Tampermonkey 中停用本脚本即可恢复。

## 安装

1. 安装 Tampermonkey 或 Violentmonkey。
2. 直接点击[安装脚本](https://raw.githubusercontent.com/RinnMoe/CHUTYXKhelper/master/TYXKhelper-request-keepalive-hedge.user.js)。
3. 扩展会识别 `.user.js` 文件并打开安装确认页，点击“安装”即可。

不需要复制代码，也不需要手动新建脚本。

项目地址：[RinnMoe/CHUTYXKhelper](https://github.com/RinnMoe/CHUTYXKhelper)。可以使用下面的 Raw 文件地址安装：

```text
https://raw.githubusercontent.com/RinnMoe/CHUTYXKhelper/master/TYXKhelper-request-keepalive-hedge.user.js
```

当前未在脚本元数据中添加 `@updateURL`/`@downloadURL`；如需明确配置自动更新地址，后续可以继续补充。

## 本地检查

本仓库不需要构建步骤。提交前可以运行 Node.js 语法检查：

```powershell
node --check .\TYXKhelper-request-keepalive-hedge.user.js
```

脚本依赖目标站点当前的 Webpack JSONP 运行时以及 `ba0d` 模块名；语法检查通过不等于目标站点运行时一定兼容。
