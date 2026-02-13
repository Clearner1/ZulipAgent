# 滴答清单日记 API 参考

## 认证
- Header: `Authorization: Bearer {access_token}`
- Base URL: `https://api.dida365.com/open/v1`

## 相关 API

### GET /project
获取所有项目列表。日记项目名称为「日记」。

### GET /project/{projectId}/data
获取项目下所有任务/笔记。日记是 `kind: "NOTE"` 的条目。

响应结构：
```json
{
  "project": { "id": "...", "name": "日记", "kind": "NOTE" },
  "tasks": [
    {
      "id": "...",
      "title": "日记标题",
      "content": "日记内容",
      "kind": "NOTE",
      "startDate": "2026-02-13T10:30:00.000+0800",
      "status": 0
    }
  ]
}
```

### POST /task
创建笔记（日记）。

请求体：
```json
{
  "title": "标题",
  "content": "正文",
  "projectId": "日记项目ID",
  "kind": "NOTE",
  "startDate": "yyyy-MM-ddTHH:mm:ss.SSS+0800",
  "timeZone": "Asia/Shanghai"
}
```
