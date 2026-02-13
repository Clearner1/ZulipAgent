# 滴答清单任务 API 参考

## 认证
- Header: `Authorization: Bearer {access_token}`
- Base URL: `https://api.dida365.com/open/v1`

## 项目 API

### GET /project
获取所有项目。注意：收集箱不在列表中，需用 `inbox` 作为 projectId。

### GET /project/{projectId}/data
获取项目详情及所有任务。

### POST /project
创建项目。必填：`name`。可选：`color`, `viewMode`(list/kanban/timeline), `kind`(TASK/NOTE)。

### DELETE /project/{projectId}
删除项目。

## 任务 API

### GET /project/{projectId}/task/{taskId}
获取单个任务详情。

### POST /task
创建任务。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 任务标题 |
| projectId | string | 是 | 所属项目 ID |
| content | string | 否 | 任务内容 |
| isAllDay | boolean | 否 | 是否全天 |
| startDate | date | 否 | 格式: yyyy-MM-ddTHH:mm:ss+0800 |
| dueDate | date | 否 | 截止日期 |
| priority | int | 否 | 0=无, 1=低, 3=中, 5=高 |
| timeZone | string | 否 | 如 Asia/Shanghai |
| reminders | list | 否 | 如 ["TRIGGER:PT0S"] |
| repeatFlag | string | 否 | RRULE 格式 |
| items | list | 否 | 子任务列表 |
| columnId | string | 否 | 看板栏目 ID |

### POST /task/{taskId}
更新任务。必须包含 `id` 和 `projectId`。

### POST /project/{projectId}/task/{taskId}/complete
完成任务。

### DELETE /project/{projectId}/task/{taskId}
删除任务。

## 提醒格式 (reminders)

ISO 8601 持续时间格式：`TRIGGER:P{天}DT{时}H{分}M{秒}S`

| 提醒 | 值 |
|------|-----|
| 准时 | TRIGGER:PT0S |
| 提前5分钟 | TRIGGER:P0DT0H5M0S |
| 提前1小时 | TRIGGER:P0DT1H0M0S |
| 提前1天 | TRIGGER:P1DT0H0M0S |

## 重复规则 (repeatFlag)

RRULE 格式：`RRULE:FREQ={频率};INTERVAL={间隔};[参数]`

| 规则 | 示例 |
|------|------|
| 每天 | RRULE:FREQ=DAILY |
| 每2天 | RRULE:FREQ=DAILY;INTERVAL=2 |
| 工作日 | RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR |
| 每月15号 | RRULE:FREQ=MONTHLY;BYMONTHDAY=15 |
| 每年1月1日 | RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1 |

## Task 对象结构

```json
{
  "id": "string",
  "projectId": "string",
  "title": "string",
  "content": "string",
  "isAllDay": false,
  "startDate": "2026-02-13T15:00:00+0800",
  "dueDate": "2026-02-13T16:00:00+0800",
  "timeZone": "Asia/Shanghai",
  "priority": 0,
  "status": 0,
  "kind": "TASK",
  "items": [],
  "reminders": [],
  "repeatFlag": null
}
```
