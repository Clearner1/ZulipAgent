---
name: notebooklm
description: 查询用户的 Google NotebookLM 笔记本。脚本会自动查询并将完整回答直接发送到 Zulip，无需你转述。
---

# NotebookLM 查询 Skill

## 核心用法

**运行脚本查询 NotebookLM。答案会自动发送到 Zulip，你只需确认：**

```bash
bash /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/query_notebooklm.sh "<notebook-url>" "<问题>" "<stream名>" "<topic名>"
```

**⏱️ 脚本执行需要约 60-90 秒，请设置 bash timeout ≥ 180 秒。**

## 查询步骤

1. 从笔记本库找到 URL
2. 运行脚本，传入 4 个参数：URL、问题、当前 stream 名、当前 topic 名
3. 脚本会自动将完整回答发送到 Zulip，你**不需要转述任何内容**

```bash
# 1. 查看笔记本库
cat /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/notebooklm-library.json

# 2. 执行查询（timeout ≥ 180）
bash /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/query_notebooklm.sh \
    "https://notebooklm.google.com/notebook/xxxxx" \
    "用户的问题" \
    "Book" \
    "2"
```

## ⚠️ 回答处理规则（极其重要）

**脚本会直接将 NotebookLM 的完整回答发送到 Zulip。你收到的 stdout 只是确认信息。**

- ✅ 正确：运行脚本 → 看到 stdout 说 "✅ 已发送" → 你回复用户确认即可
- ✅ 正确：运行脚本 → stdout 返回了答案文本（说明直发失败了）→ 你把文本完整转发给用户
- ❌ 错误：自己去 NotebookLM 查询、或用 bb-browser 手动操作
- ❌ 错误：用自己的知识回答 NotebookLM 相关的问题

## stream 和 topic 参数

- **stream**：使用 Zulip 的 **原始 stream 名**（如 `Book`，不是 sanitized 后的 `book`）
- **topic**：使用 Zulip 的 **原始 topic 名**（如 `2`）
- 你可以从用户消息的上下文中获取当前的 stream 和 topic

## 笔记本库管理

笔记本库文件：`/Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/notebooklm-library.json`

添加新笔记本：
```bash
cat /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/notebooklm-library.json
```

## ⛔ 安全规则

1. **必须使用 query_notebooklm.sh 脚本** — 禁止手动用 bb-browser 操作 NotebookLM
2. **脚本内置文件锁** — 即使被多次调用也会自动串行执行
3. **查询失败最多重试 1 次** — 之后告诉用户"NotebookLM 暂时不可用"并停止
4. **不要换措辞反复问同一个问题** — 失败就报告
5. **如果脚本报"扩展未连接"** — 告诉用户"请在 Chrome 中点击 bb-browser 扩展图标激活"

## 触发条件

当用户在 `Book` stream 中提问，或提到 NotebookLM、笔记本、"查一下我的文档"时使用此 skill。
