---
name: dida-task
description: 滴答清单任务管理 - 查询、创建、完成任务（通过 Dida365 API）
---

# 滴答清单任务管理

管理滴答清单中的任务。脚本位于 `{baseDir}/scripts/task.ts`。

## ⚠️ 重要：中文编码

创建任务时，**必须先用 `write` 工具写 JSON 文件**，再用 `bash` 工具运行脚本。
**严禁**在 bash 的 `-d` 或 heredoc 中写中文！

## 查询项目列表

```bash
npx tsx {baseDir}/scripts/task.ts projects
```

## 查询任务

```bash
# 查询今天的任务（默认，只返回未完成的）
npx tsx {baseDir}/scripts/task.ts list today

# 查询所有未完成任务
npx tsx {baseDir}/scripts/task.ts list all

# 查询某项目的任务
npx tsx {baseDir}/scripts/task.ts list {projectId}
```

注意：脚本会自动处理 UTC→北京时间转换，返回的时间都是 UTC+8。

## 创建任务

**第1步**：用 `write` 工具创建 `/tmp/dida_body.json`：
```json
{
  "title": "任务标题",
  "projectId": "inbox",
  "content": "任务详情（可选）",
  "startDate": "2026-02-13T15:00:00+0800",
  "dueDate": "2026-02-13T16:00:00+0800",
  "isAllDay": false,
  "priority": 0,
  "timeZone": "Asia/Shanghai"
}
```

**第2步**：用 `bash` 工具运行：
```bash
npx tsx {baseDir}/scripts/task.ts create /tmp/dida_body.json
```

**优先级**：`0`=无, `1`=低, `3`=中, `5`=高

**提醒规则**（reminders 字段）：`["TRIGGER:PT0S"]`(准时), `["TRIGGER:P0DT1H0M0S"]`(提前1小时)

**重复规则**（repeatFlag 字段）：`"RRULE:FREQ=DAILY"`, `"RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"`

## 完成任务

```bash
npx tsx {baseDir}/scripts/task.ts complete {projectId} {taskId}
```

## 注意事项

- 创建任务前先用 `date "+%Y-%m-%dT%H:%M:%S%z"` 获取当前时间
- 收集箱用 `inbox` 作为 projectId
- 如果用户没指定项目，可先列出项目让用户选择，或放入收集箱
