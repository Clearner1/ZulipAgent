---
name: notebooklm
description: 查询用户的 Google NotebookLM 笔记本。通过脚本自动打开 NotebookLM 页面、输入问题、获取回答并返回完整文本。
---

# NotebookLM 查询 Skill

## 核心用法

**运行一条命令即可查询 NotebookLM，答案会输出到 stdout：**

```bash
bash /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/query_notebooklm.sh "<notebook-url>" "<问题>"
```

## 查询步骤

1. 从笔记本库找到 URL
2. 运行脚本
3. 把 stdout 输出完整发送给用户

```bash
# 1. 查看笔记本库
cat /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/notebooklm-library.json

# 2. 执行查询（用库中对应的 URL）
bash /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/query_notebooklm.sh "https://notebooklm.google.com/notebook/xxxxx" "用户的问题"
```

## ⚠️ 回答处理规则（极其重要）

**脚本的 stdout 输出就是 NotebookLM 的完整回答。你必须把这个输出原封不动地作为你回复用户的主要内容。**

- ✅ 正确：运行脚本 → 把 stdout 完整复制到你的回复里
- ❌ 错误：只说"查询完成"而不附带内容
- ❌ 错误：对 stdout 进行缩写、总结、精简
- ❌ 错误：用自己的知识补充或修改 stdout 的内容
- **唯一允许**：调整 markdown 格式适配 Zulip

## 笔记本库管理

笔记本库文件：`/Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/notebooklm-library.json`

添加新笔记本：
```bash
# 直接编辑 JSON 文件，追加新条目
cat /Users/loumac/Downloads/ZulipAgent/data/skills/notebooklm/notebooklm-library.json
```

## ⛔ 安全规则

1. **必须使用 query_notebooklm.sh 脚本** — 禁止手动用 bb-browser 操作 NotebookLM
2. **查询失败最多重试 1 次** — 之后告诉用户"NotebookLM 暂时不可用"并停止
3. **不要换措辞反复问同一个问题** — 失败就报告
4. **如果脚本报"扩展未连接"** — 告诉用户"请在 Chrome 中点击 bb-browser 扩展图标激活"

## 触发条件

当用户在 `Book` stream 中提问，或提到 NotebookLM、笔记本、"查一下我的文档"时使用此 skill。
