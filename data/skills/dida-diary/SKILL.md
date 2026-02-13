---
name: dida-diary
description: 滴答清单日记管理 - 记录和查询日记（通过 Dida365 API）
---

# 滴答清单日记管理

管理滴答清单中的「日记」项目。脚本位于 `{baseDir}/scripts/diary.ts`。

## 记录日记

**两步操作**（必须严格按顺序执行）：

**第1步**：用 `write` 工具创建 `/tmp/dida_body.json`，内容如下：
```json
{
  "title": "日记标题（5-15字，概括主题）",
  "content": "用户原话的日记内容"
}
```

**第2步**：用 `bash` 工具运行脚本：
```bash
npx tsx {baseDir}/scripts/diary.ts record /tmp/dida_body.json
```

### 标题生成规范
- 标题应概括日记核心主题，5-15个字
- **不要截取内容开头**，要提炼主题
- 示例：
  - 内容"今天学了 MCP 和 Skill 的融合" → 标题"学习MCP与Skill的融合"
  - 内容"和朋友去吃了火锅" → 标题"与朋友聚餐吃火锅"

## 查询日记

用 `bash` 工具直接运行（无需创建文件）：
```bash
# 查询今天的日记
npx tsx {baseDir}/scripts/diary.ts query today

# 查询最近一周
npx tsx {baseDir}/scripts/diary.ts query week

# 查询所有
npx tsx {baseDir}/scripts/diary.ts query all
```
