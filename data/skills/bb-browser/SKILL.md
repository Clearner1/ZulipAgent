---
name: bb-browser
description: 强大的信息获取工具。通过浏览器 + 用户登录态，获取公域和私域信息。可访问任意网页、内部系统、登录后页面，执行表单填写、信息提取、页面操作。
---

# bb-browser - 信息获取与浏览器自动化

## 核心价值

**bb-browser 是一个强大的信息获取工具。**

通过浏览器 + 用户登录态，可以获取：
- **公域信息**：任意公开网页、搜索结果、新闻资讯
- **私域信息**：内部系统、企业应用、登录后页面、个人账户数据

在此基础上，还可以代替用户执行浏览器操作：
- 表单填写、按钮点击
- 数据提取、截图保存
- 批量操作、重复任务

**为什么能做到？**
- 运行在用户真实浏览器中，复用已登录的账号
- 不触发反爬检测，访问受保护的页面
- 无需提供密码或 Cookie，直接使用现有登录态

## 前置条件：自动启动 Daemon

**每次使用 bb-browser 前，必须先确保 Daemon 在运行。** 按以下流程操作：

```bash
# 1. 检查 Daemon 状态
bb-browser status
```

- 如果输出 "Daemon 运行中" → 直接开始操作
- 如果输出 "Daemon 未运行" → 执行下面的命令启动：

```bash
# 2. 后台启动 Daemon（必须用此命令，不能用 bb-browser daemon）
nohup node /Users/loumac/Downloads/bb-browser/packages/daemon/dist/index.js > /dev/null 2>&1 &
```

启动后等待 2 秒再执行后续操作。

**注意**：
- 如果 bb-browser 命令返回"扩展未连接"，提醒用户检查 Chrome 是否已安装并启用 bb-browser 扩展
- 使用完毕后记得 `bb-browser close` 关闭打开的 tab

## 快速开始

```bash
bb-browser open <url>        # 打开页面（新 tab）
bb-browser snapshot -i       # 获取可交互元素
bb-browser click @5          # 点击元素
bb-browser fill @3 "text"    # 填写输入框
bb-browser close             # 完成后关闭 tab
```

## Tab 管理规范

**重要：操作完成后必须关闭自己打开的 tab**

```bash
# 单 tab 场景
bb-browser open https://example.com    # 打开新 tab
bb-browser snapshot -i
bb-browser click @5
bb-browser close                        # 完成后关闭

# 多 tab 场景
bb-browser open https://site-a.com     # tabId: 123
bb-browser open https://site-b.com     # tabId: 456
# ... 操作 ...
bb-browser tab close                    # 关闭当前 tab
bb-browser tab close                    # 关闭剩余 tab

# 指定 tab 操作
bb-browser open https://example.com --tab current  # 在当前 tab 打开（不新建）
bb-browser open https://example.com --tab 123      # 在指定 tabId 打开
```

## 核心工作流

1. `open` 打开页面
2. `snapshot -i` 查看可操作元素（返回 @ref）
3. 用 `@ref` 执行操作（click, fill, etc.）
4. 页面变化后重新 `snapshot -i`
5. 任务完成后 `close` 关闭 tab

## 命令速查

### 导航

```bash
bb-browser open <url>           # 打开 URL（新 tab）
bb-browser open <url> --tab current  # 在当前 tab 打开
bb-browser back                 # 后退
bb-browser forward              # 前进
bb-browser refresh              # 刷新
bb-browser close                # 关闭当前 tab
```

### 快照

```bash
bb-browser snapshot             # 完整页面结构
bb-browser snapshot -i          # 只显示可交互元素（推荐）
bb-browser snapshot --json      # JSON 格式输出
```

### 元素交互

```bash
bb-browser click @5             # 点击
bb-browser hover @5             # 悬停
bb-browser fill @3 "text"       # 清空并填写
bb-browser type @3 "text"       # 追加输入（不清空）
bb-browser check @7             # 勾选复选框
bb-browser uncheck @7           # 取消勾选
bb-browser select @4 "option"   # 下拉选择
bb-browser press Enter          # 按键
bb-browser press Control+a      # 组合键
bb-browser scroll down          # 向下滚动
bb-browser scroll up 500        # 向上滚动 500px
```

### 获取信息

```bash
bb-browser get text @5          # 获取元素文本
bb-browser get url              # 获取当前 URL
bb-browser get title            # 获取页面标题
```

### Tab 管理

```bash
bb-browser tab                  # 列出所有 tab
bb-browser tab new [url]        # 新建 tab
bb-browser tab 2                # 切换到第 2 个 tab
bb-browser tab close            # 关闭当前 tab
bb-browser tab close 3          # 关闭第 3 个 tab
```

### 截图

```bash
bb-browser screenshot           # 截图（自动保存）
bb-browser screenshot path.png  # 截图到指定路径
```

### 等待

```bash
bb-browser wait 2000            # 等待 2 秒
bb-browser wait @5              # 等待元素出现
```

### JavaScript

```bash
bb-browser eval "document.title"              # 执行 JS
bb-browser eval "window.scrollTo(0, 1000)"    # 滚动到指定位置
```

### Frame 切换

```bash
bb-browser frame "#iframe-id"   # 切换到 iframe
bb-browser frame main           # 返回主 frame
```

### 对话框处理

```bash
bb-browser dialog accept        # 确认对话框
bb-browser dialog dismiss       # 取消对话框
bb-browser dialog accept "text" # 确认并输入（prompt）
```

### 调试

```bash
bb-browser network requests     # 查看网络请求
bb-browser console              # 查看控制台消息
bb-browser errors               # 查看 JS 错误
bb-browser trace start          # 开始录制用户操作
bb-browser trace stop           # 停止录制
```

## Ref 使用说明

snapshot 返回的 `@ref` 是元素的临时标识：

```
@1 [button] "提交"
@2 [input type="text"] placeholder="请输入姓名"
@3 [a] "查看详情"
```

**注意**：
- 页面导航后 ref 失效，需重新 snapshot
- 动态内容加载后需重新 snapshot
- ref 格式：`@1`, `@2`, `@3`...

## 并发操作

```bash
# 并发打开多个页面（各自独立 tab）
bb-browser open https://site-a.com &
bb-browser open https://site-b.com &
bb-browser open https://site-c.com &
wait

# 每个返回独立的 tabId，互不干扰
```

## JSON 输出

添加 `--json` 获取结构化输出：

```bash
bb-browser snapshot -i --json
bb-browser get text @5 --json
bb-browser open https://example.com --json
```

## 信息提取 vs 页面操作

**根据目的选择不同的方法：**

### 提取页面内容（用 eval）

当需要提取文章、正文等长文本时，用 `eval` 直接获取：

```bash
# 微信公众号文章
bb-browser eval "document.querySelector('#js_content').innerText"

# 知乎回答
bb-browser eval "document.querySelector('.RichContent-inner').innerText"

# 通用：获取页面主体文本
bb-browser eval "document.body.innerText.substring(0, 5000)"

# 获取所有链接
bb-browser eval "[...document.querySelectorAll('a')].map(a => a.href).join('\n')"
```

**为什么不用 snapshot？**
有些网站（如微信公众号）DOM 结构嵌套很深，snapshot 输出会非常冗长。`eval` 直接提取文本更高效。

### 操作页面元素（用 snapshot -i）

当需要点击、填写、选择时，用 `snapshot -i` 获取可交互元素：

```bash
bb-browser snapshot -i
# @1 [button] "登录"
# @2 [input] placeholder="用户名"
# @3 [input type="password"]

bb-browser fill @2 "username"
bb-browser fill @3 "password"
bb-browser click @1
```

**`-i` 很重要**：只显示可交互元素，过滤掉大量无关内容。

## 常见任务示例

### 表单填写

```bash
bb-browser open https://example.com/form
bb-browser snapshot -i
# @1 [input] placeholder="姓名"
# @2 [input] placeholder="邮箱"
# @3 [button] "提交"

bb-browser fill @1 "张三"
bb-browser fill @2 "zhangsan@example.com"
bb-browser click @3
bb-browser wait 2000
bb-browser close
```

### 信息提取

```bash
bb-browser open https://example.com/dashboard
bb-browser snapshot -i
bb-browser get text @5              # 获取特定元素文本
bb-browser screenshot report.png    # 截图保存
bb-browser close
```

### 批量操作

```bash
# 打开多个页面提取信息
for url in "url1" "url2" "url3"; do
  bb-browser open "$url"
  bb-browser snapshot -i --json
  bb-browser close
done
```

## 深入文档

| 文档 | 说明 |
|------|------|
| [{baseDir}/references/snapshot-refs.md]({baseDir}/references/snapshot-refs.md) | Ref 生命周期、最佳实践、常见问题 |

## X Feed 工作流（x-feed-check 事件）

### ⚠️ X 平台注意事项

X 的推文输入框是富文本编辑器（contenteditable），操作时注意：

- **禁止用 `fill`** — `fill` 会报告成功但实际上没有输入任何文字
- **必须用 `type`** — `type` 命令可以正常输入中英文
- **输入后 ref 会变化** — 输入文字后 DOM 改变，必须重新 `snapshot -i` 获取新的回复按钮 ref

### 回复推文的完整流程

```bash
# 1. 打开推文页面
bb-browser open "<tweet_url>"
bb-browser wait 3000

# 2. 获取元素
bb-browser snapshot -i
# 找到 textbox "帖子文本" 的 ref

# 3. 点击输入框 → 用 type 输入（不能用 fill！）
bb-browser click @<textbox_ref>
bb-browser type @<textbox_ref> "回复内容"

# 4. 验证是否真的输入了
bb-browser eval "document.querySelector('[data-testid=\"tweetTextarea_0\"]')?.textContent"

# 5. ⚠️ 重新 snapshot！输入文字后 DOM 变化，回复按钮的 ref 会改变
bb-browser snapshot -i
# 找到新的 button "回复" ref（注意不是原来的 ref！）

# 6. 点击新的回复按钮
bb-browser click @<new_reply_button_ref>

# 7. 验证发送成功（输入框应该被清空）
bb-browser wait 2000
bb-browser eval "document.querySelector('[data-testid=\"tweetTextarea_0\"]')?.textContent || 'SENT'"
# 如果返回 "SENT" 说明发送成功

# 8. 确认发送成功后才能关闭 tab
bb-browser close
```

**⚠️ 关键规则：**
- **必须在确认发送成功后才能 `close`** — 如果在输入了文字但还没发送时就 `close`，Chrome 会弹出"离开此网站？"确认框，导致后续所有命令卡住超时
- 如果遇到"离开此网站"弹窗，用 `bb-browser dialog accept` 关闭它

### Topic 结构

- **`x-feed` / `2026-02-14`** — 按日期的推文摘要（自动创建）
- **`x-feed` / `收藏`** — 用户喜欢的推文收藏

当收到 `x-feed-check` 事件时，按以下流程执行：

### 1. 浏览关注时间线

```bash
# 确保 Daemon 运行（参照"前置条件"章节）
bb-browser status

# 打开 X 关注页面
bb-browser open "https://x.com/home"
```

打开后，先切换到"正在关注" tab（避免推荐内容），然后用 `eval` 提取推文：

```bash
# 切换到"正在关注"tab
bb-browser snapshot -i
# 找到 tab "正在关注" 的 ref，点击它
bb-browser click @<正在关注的ref>
bb-browser wait 2000

# 提取推文内容
bb-browser eval "Array.from(document.querySelectorAll('[data-testid=\"tweet\"]')).slice(0, 10).map((t, i) => { const name = t.querySelector('[data-testid=\"User-Name\"]')?.innerText || ''; const text = t.querySelector('[data-testid=\"tweetText\"]')?.innerText || ''; const time = t.querySelector('time')?.getAttribute('datetime') || ''; const link = t.querySelector('time')?.closest('a')?.href || ''; return '【' + (i+1) + '】' + name.split('\n')[0] + ' (' + time + ')\n' + text + '\n🔗 ' + link; }).join('\n\n')"
```

如果需要更多推文，滚动后再提取：

```bash
bb-browser scroll down
bb-browser wait 1000
# 再次提取新出现的推文...
```

### 2. 整理并发送摘要

将提取的推文整理成精炼摘要。摘要会自动发送到当天日期的 topic（如 `2026-02-14`）。

推文摘要中每条推文都要**编号**，方便用户引用收藏。格式参考：

```
📱 **X 关注动态** (14:00)

**1.** @username (30分钟前)
推文摘要内容...
🔗 链接

**2.** @another (2小时前)
推文摘要内容...
🔗 链接

---
共浏览 N 条推文，以上为近期精选。
回复"收藏 1"或"收藏 2"即可保存到收藏夹 ⭐
```

**筛选标准**：
- 优先推送技术、AI、开发工具相关内容
- 过滤掉广告和纯转帖
- 保留有价值的观点、工具推荐、行业动态

### 3. 完成后清理

```bash
bb-browser close
```

### 4. 收藏推文

当用户回复表示喜欢某条推文（如"收藏 1"、"这条不错"、"保存第3条"），执行两个操作：

**操作 A：转发到 `收藏` topic**

将推文完整内容发送到 `x-feed` stream 的 **`收藏`** topic，格式：

```
⭐ **收藏** | 2026-02-14

**@username**
> 推文原文内容...

🔗 https://x.com/username/status/xxx
📌 用户评价
```

**操作 B：追加写入收藏文件**

**收藏文件绝对路径**：`/Users/loumac/Downloads/ZulipAgent/data/skills/bb-browser/x-favorites.md`

⚠️ **必须用 bash `cat >>` 追加，不能用 write 工具（会覆盖已有内容）！**

```bash
cat >> /Users/loumac/Downloads/ZulipAgent/data/skills/bb-browser/x-favorites.md << 'EOF'
## 2026-02-14

### @username - 推文关键词摘要
> 推文原文内容...

🔗 https://x.com/username/status/xxx
📌 收藏原因：用户的评价

---
EOF
```
