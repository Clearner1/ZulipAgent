---

# 滴答清单 (Dida365) 开放 API 文档

## 引言

欢迎使用滴答清单开放API文档。滴答清单是一款强大的任务管理应用，帮助用户轻松管理和组织日常任务、截止日期和项目。通过滴答清单开放API，开发者可以将滴答清单强大的任务管理功能集成到他们自己的应用程序中，创造无缝的用户体验。

## 开始使用

要开始使用滴答清单开放API，您需要注册您的应用程序并获取客户端ID (Client ID) 和客户端密钥 (Client Secret)。您可以访问 [滴答清单开发者中心](https://developer.dida365.com/manage) 来注册您的应用。注册后，您将收到用于验证请求的客户端ID和客户端密钥。

## 授权

### 获取访问令牌 (Access Token)

为了调用滴答清单的开放API，必须获取对应用户的访问令牌。滴答清单使用 OAuth2 协议来获取访问令牌。

#### 第一步：重定向用户授权

将用户重定向到滴答清单授权页面：`https://dida365.com/oauth/authorize`。
必需的参数如下：

| 名称 | 描述 |
| :------------- | :-------------------------------------------------- |
| `client_id` | 应用程序的唯一ID。 |
| `scope` | 以空格分隔的权限范围。当前可用范围：`tasks:write` `tasks:read` |
| `state` | 一个随机字符串，会原样传递到重定向URL，用于防止CSRF攻击。 |
| `redirect_uri` | 用户在开发者中心配置的回调URL。 |
| `response_type`| 固定为 `code`。 |

**示例：**
```
https://dida365.com/oauth/authorize?scope=tasks:read%20tasks:write&client_id=YOUR_CLIENT_ID&state=YOUR_STATE&redirect_uri=YOUR_REDIRECT_URI&response_type=code
```

#### 第二步：接收授权码

用户授权后，滴答清单会将用户重定向回您应用程序的 `redirect_uri`，并在查询参数中附带授权码 (Authorization Code)。

| 名称 | 描述 |
| :----- | :--------------------------- |
| `code` | 用于后续获取访问令牌的授权码。 |
| `state`| 第一步中传递的 `state` 参数。 |

#### 第三步：用授权码交换访问令牌

向 `https://dida365.com/oauth/token` 发起 `POST` 请求，以授权码换取访问令牌。
请求头 `Content-Type` 需设置为 `application/x-www-form-urlencoded`。
请求体参数如下：

| 名称 | 描述 |
| :-------------- | :---------------------------------------------------------------- |
| `client_id` | 应用程序的唯一ID，使用 Basic Auth 认证方式置于请求头 (HEADER) 中作为用户名。 |
| `client_secret` | 应用程序的密钥，使用 Basic Auth 认证方式置于请求头 (HEADER) 中作为密码。 |
| `code` | 第二步中获取到的授权码。 |
| `grant_type` | 授权类型，目前固定为 `authorization_code`。 |
| `scope` | 以空格分隔的权限范围 (与第一步请求时一致)。当前可用范围：`tasks:write` `tasks:read` |
| `redirect_uri` | 用户在开发者中心配置的回调URL (与第一步请求时一致)。 |

请求成功后，响应体中会包含 `access_token`：
```json
{
...
"access_token": "YOUR_ACCESS_TOKEN_VALUE",
...
}
```

### 调用 OpenAPI

在请求 OpenAPI 时，需要在请求头 (Header) 中设置 `Authorization` 字段，其值为 `Bearer YOUR_ACCESS_TOKEN_VALUE`。

**示例：**
```
Authorization: Bearer e*****b
```

## API 参考

滴答清单开放API提供了一个 RESTful 接口，用于访问和管理用户的任务、清单和其他相关资源。该API基于标准的 HTTP 协议，并支持 JSON 数据格式。
API Base URL: `https://api.dida365.com`

### 任务 (Task)

#### 根据项目ID和任务ID获取任务
`GET /open/v1/project/{projectId}/task/{taskId}`

**路径参数 (Path Parameters):**

| 类型 | 名称 | 描述 | Schema |
| :----- | :---------- | :------- | :----- |
| `Path` | `projectId` | 项目ID (必需) | string |
| `Path` | `taskId` | 任务ID (必需) | string |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :----- |
| `200` | OK | Task |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
GET /open/v1/project/{{projectId}}/task/{{taskId}} HTTP/1.1
Host: api.dida365.com
Authorization: Bearer {{token}}
```

**响应:**
```json
{
"id": "63b7bebb91c0a5474805fcd4",
"isAllDay": true,
"projectId": "6226ff9877acee87727f6bca",
"title": "任务标题",
"content": "任务内容",
"desc": "任务描述",
"timeZone": "America/Los_Angeles",
"repeatFlag": "RRULE:FREQ=DAILY;INTERVAL=1",
"startDate": "2019-11-13T03:00:00+0000",
"dueDate": "2019-11-14T03:00:00+0000",
"reminders": ["TRIGGER:P0DT9H0M0S", "TRIGGER:PT0S"],
"priority": 1,
"status": 0,
"completedTime": "2019-11-13T03:00:00+0000",
"sortOrder": 12345,
"items": [{
"id": "6435074647fd2e6387145f20",
"status": 0,
"title": "子任务标题",
"sortOrder": 12345,
"startDate": "2019-11-13T03:00:00+0000",
"isAllDay": false,
"timeZone": "America/Los_Angeles",
"completedTime": "2019-11-13T03:00:00+0000"
}]
}
```

#### 创建任务
`POST /open/v1/task`

**请求体参数 (Body Parameters):**

| 名称 | 描述 | Schema | 是否必需 |
| :---------------- | :----------------------------------------------- | :------ | :----- |
| `title` | 任务标题 | string | 是 |
| `projectId` | 任务所属项目ID (在创建时通常需要指定) | string | 是 |
| `content` | 任务内容 | string | 否 |
| `desc` | 清单描述 | string | 否 |
| `isAllDay` | 是否全天任务 | boolean | 否 |
| `startDate` | 开始日期和时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | date | 否 |
| `dueDate` | 截止日期和时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | date | 否 |
| `timeZone` | 指定时间的时区 | string | 否 |
| `reminders` | 任务特定的提醒列表 | list | 否 |
| `repeatFlag` | 任务的重复规则 | string | 否 |
| `priority` | 任务优先级，默认为 "0" (普通) | integer | 否 |
| `sortOrder` | 任务的排序值 | integer | 否 |
| `items` | 子任务列表 | list | 否 |
| `items.title` | 子任务标题 | string | (若有items) 是 |
| `items.startDate` | 子任务开始日期和时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" | date | 否 |
| `items.isAllDay` | 子任务是否全天 | boolean | 否 |
| `items.sortOrder` | 子任务的排序值 | integer | 否 |
| `items.timeZone` | 子任务开始时间的时区 | string | 否 |
| `items.status` | 子任务的完成状态 | integer | 否 |
| `items.completedTime` | 子任务完成时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | date | 否 |

reminders字段使用ISO 8601持续时间格式，具体格式为：TRIGGER:P{天数}DT{小时数}H{分钟数}M{秒数}S

  具体含义

  1. "TRIGGER:P0DT9H0M0S" - 任务开始前9小时提醒
    - P0D - 0天
    - T9H - 9小时
    - 0M - 0分钟
    - 0S - 0秒
  2. "TRIGGER:PT0S" - 任务开始时提醒（立即提醒）
    - 没有天数（P后直接跟T）
    - 0S - 0秒（即任务开始时立即提醒）
  3. "TRIGGER:P0DT1H0M0S" - 任务开始前1小时提醒

  常用组合示例

  - ["TRIGGER:P0DT1H0M0S"] - 开始前1小时提醒
  - ["TRIGGER:P1DT0H0M0S"] - 开始前1天提醒
  - ["TRIGGER:P0DT2H30M0S"] - 开始前2小时30分钟提醒
  - ["TRIGGER:P0DT15M0S"] - 开始前15分钟提醒

  多提醒机制

  文档中的["TRIGGER:P0DT9H0M0S", "TRIGGER:PT0S"]表示：
  - 第一次提醒：任务开始前9小时
  - 第二次提醒：任务开始时（立即提醒）

滴答清单重复规则完整总结

  1. 标准RFC 5545格式 (RRULE)

  基本格式

  RRULE:FREQ={频率};INTERVAL={间隔};[其他参数]

  频率类型 (FREQ)

  - DAILY - 每日
  - WEEKLY - 每周
  - MONTHLY - 每月
  - YEARLY - 每年

  间隔参数 (INTERVAL)

  - INTERVAL=1 - 每1个周期（可省略）
  - INTERVAL=2 - 每2个周期
  - INTERVAL=3 - 每3个周期

  指定日期参数

  BYDAY (星期)

  - MO - 周一, TU - 周二, WE - 周三
  - TH - 周四, FR - 周五, SA - 周六, SU - 周日
  - 多个用逗号分隔：BYDAY=MO,WE,FR

  BYMONTHDAY (月份日期)

  - 1-31 - 具体日期
  - BYMONTHDAY=15 - 每月15号
  - BYMONTHDAY=1,15 - 每月1号和15号

  BYMONTH (月份)

  - 1-12 - 具体月份
  - BYMONTH=1,4,7,10 - 每季度第一个月

  结束条件

  - COUNT={数字} - 重复次数
  - UNTIL={日期时间} - 结束时间

  2. 滴答清单扩展格式

  遗忘曲线格式 (ERULE)

  ERULE:NAME=FORGETTINGCURVE;CYCLE={周期}
  - 基于艾宾浩斯遗忘曲线算法
  - 用于学习复习类任务
  - CYCLE=0 可能表示初始循环

  跳过规则 (TT_SKIP)

  TT_SKIP=HOLIDAY,WEEKEND
  - HOLIDAY - 跳过法定节假日
  - WEEKEND - 跳过周末
  - 可组合使用

  3. 实用示例

  工作日任务

  # 方法1：指定工作日
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"

  # 方法2：跳过周末（更准确，包含节假日）
  "RRULE:FREQ=DAILY;TT_SKIP=HOLIDAY,WEEKEND"

  学习复习

  # 遗忘曲线复习
  "ERULE:NAME=FORGETTINGCURVE;CYCLE=0"

  常见重复模式

  # 每天重复
  "RRULE:FREQ=DAILY"

  # 每两天重复
  "RRULE:FREQ=DAILY;INTERVAL=2"

  # 每周一三五重复
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"

  # 每月15号重复
  "RRULE:FREQ=MONTHLY;BYMONTHDAY=15"

  # 每月第一个周一重复
  "RRULE:FREQ=MONTHLY;BYDAY=1MO"

  # 每年1月1日重复
  "RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1"

  # 重复30次结束
  "RRULE:FREQ=DAILY;COUNT=30"

  # 到指定日期结束
  "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20251231T235959Z"

  4. 注意事项

  1. 时区影响: 重复规则基于任务设定的时区
  2. 格式灵活性: 可省略INTERVAL=1参数
  3. 扩展功能: 遗忘曲线和跳过规则是滴答清单特色
  4. API兼容性: 标准RRULE格式与其他日历应用兼容
  5. 参数顺序: 不影响功能，但建议按规范顺序排列

  这个重复规则系统既支持国际标准，又提供了适合中文用户习惯的扩展功能，非常灵活强大。

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :----- |
| `200` | OK (通常创建成功返回 201) | Task |
| `201` | Created | Task (或无内容) |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
POST /open/v1/task HTTP/1.1
Host: api.dida365.com
Content-Type: application/json
Authorization: Bearer {{token}}

{
"title": "新的任务标题",
"projectId": "6226ff9877acee87727f6bca"
}
```

**响应 (示例):**
```json
{
"id": "63b7bebb91c0a5474805fcd4",
"projectId": "6226ff9877acee87727f6bca",
"title": "新的任务标题",
"content": null,
"desc": null,
"isAllDay": false,
"startDate": null,
"dueDate": null,
"timeZone": "Asia/Shanghai",
"reminders": [],
"repeatFlag": null,
"priority": 0,
"status": 0,
"completedTime": null,
"sortOrder": 12345,
"items": []
}
```

#### 更新任务
`POST /open/v1/task/{taskId}`

**路径参数 (Path Parameters):**

| 类型 | 名称 | 描述 | Schema |
| :----- | :------- | :------- | :----- |
| `Path` | `taskId` | 任务ID (必需) | string |

**请求体参数 (Body Parameters):**
(与创建任务类似，但`id` 和 `projectId` 必填，其他为可选更新字段)

| 名称 | 描述 | Schema | 是否必需 |
| :---------------- | :----------------------------------------------- | :------ | :----- |
| `id` | 任务ID | string | 是 |
| `projectId` | 项目ID | string | 是 |
| `title` | 任务标题 | string | 否 |
| `content` | 任务内容 | string | 否 |
| `desc` | 清单描述 | string | 否 |
| `isAllDay` | 是否全天任务 | boolean | 否 |
| `startDate` | 开始日期和时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" | date | 否 |
| `dueDate` | 截止日期和时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" | date | 否 |
| `timeZone` | 指定时间的时区 | string | 否 |
| `reminders` | 任务特定的提醒列表 | list | 否 |
| `repeatFlag` | 任务的重复规则 | string | 否 |
| `priority` | 任务优先级，默认为 "0" (普通) | integer | 否 |
| `sortOrder` | 任务的排序值 | integer | 否 |
| `items` | 子任务列表 (更新时通常是替换整个列表或按ID更新) | list | 否 |
| ... (items 内字段同创建任务) ... | | | |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :----- |
| `200` | OK | Task |
| `201` | Created (不适用，通常是200) | 无内容 |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
POST /open/v1/task/{{taskId}} HTTP/1.1
Host: api.dida365.com
Content-Type: application/json
Authorization: Bearer {{token}}

{
"id": "{{taskId}}",
"projectId": "{{projectId}}",
"title": "更新后的任务标题",
"priority": 1
}
```

**响应 (示例):**
```json
{
"id": "{{taskId}}",
"projectId": "{{projectId}}",
"title": "更新后的任务标题",
"content": "任务内容",
"desc": "任务描述",
"isAllDay": true,
"startDate": "2019-11-13T03:00:00+0000",
"dueDate": "2019-11-14T03:00:00+0000",
"timeZone": "America/Los_Angeles",
"reminders": ["TRIGGER:P0DT9H0M0S", "TRIGGER:PT0S"],
"repeatFlag": "RRULE:FREQ=DAILY;INTERVAL=1",
"priority": 1,
"status": 0,
"completedTime": "2019-11-13T03:00:00+0000",
"sortOrder": 12345,
"items": [{
"id": "6435074647fd2e6387145f20",
"status": 1,
"title": "子任务标题",
"sortOrder": 12345,
"startDate": "2019-11-13T03:00:00+0000",
"isAllDay": false,
"timeZone": "America/Los_Angeles",
"completedTime": "2019-11-13T03:00:00+0000"
}]
}
```

#### 完成任务
`POST /open/v1/project/{projectId}/task/{taskId}/complete`

**路径参数 (Path Parameters):**

| 类型 | 名称 | 描述 | Schema |
| :----- | :---------- | :------- | :----- |
| `Path` | `projectId` | 项目ID (必需) | string |
| `Path` | `taskId` | 任务ID (必需) | string |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :----- |
| `200` | OK | 无内容 |
| `201` | Created (不适用) | 无内容 |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
POST /open/v1/project/{{projectId}}/task/{{taskId}}/complete HTTP/1.1
Host: api.dida365.com
Authorization: Bearer {{token}}
```

#### 删除任务
`DELETE /open/v1/project/{projectId}/task/{taskId}`

**路径参数 (Path Parameters):**

| 类型 | 名称 | 描述 | Schema |
| :----- | :---------- | :------- | :----- |
| `Path` | `projectId` | 项目ID (必需) | string |
| `Path` | `taskId` | 任务ID (必需) | string |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :----- |
| `200` | OK | 无内容 |
| `204` | No Content (更符合语义的成功删除) | 无内容 |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
DELETE /open/v1/project/{{projectId}}/task/{{taskId}} HTTP/1.1
Host: api.dida365.com
Authorization: Bearer {{token}}
```

### 项目 (Project)

#### 获取用户项目列表
`GET /open/v1/project`

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :------------- |
| `200` | OK | ` 数组` |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
GET /open/v1/project HTTP/1.1
Host: api.dida365.com
Authorization: Bearer {{token}}
```

**响应:**
```json
[
{
"id": "6226ff9877acee87727f6bca",
"name": "项目名称",
"color": "#F18181",
"closed": false,
"groupId": "6436176a47fd2e05f26ef56e",
"viewMode": "list",
"permission": "write",
"kind": "TASK"
}
]
```

#### 根据ID获取项目
`GET /open/v1/project/{projectId}`

**路径参数 (Path Parameters):**
* 原文档中参数名称为 `project`，通常应为 `projectId` 以保持一致性。此处按原文。

| 类型 | 名称 | 描述 | Schema |
| :----- | :-------- | :------- | :----- |
| `Path` | `project` (应为`projectId`) | 项目ID (必需) | string |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :------ |
| `200` | OK | Project |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
GET /open/v1/project/{{projectId}} HTTP/1.1
Host: api.dida365.com
Authorization: Bearer {{token}}
```

**响应:**
```json
{
"id": "6226ff9877acee87727f6bca",
"name": "项目名称",
"color": "#F18181",
"closed": false,
"groupId": "6436176a47fd2e05f26ef56e",
"viewMode": "list",
"kind": "TASK"
}
```

#### 获取项目及其数据 (任务和栏目)
`GET /open/v1/project/{projectId}/data`

**路径参数 (Path Parameters):**

| 类型 | 名称 | 描述 | Schema |
| :----- | :---------- | :------- | :----- |
| `Path` | `projectId` | 项目ID (必需) | string |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :---------- |
| `200` | OK | ProjectData |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
GET /open/v1/project/{{projectId}}/data HTTP/1.1
Host: api.dida365.com
Authorization: Bearer {{token}}
```

**响应:**
```json
{
"project": {
"id": "6226ff9877acee87727f6bca",
"name": "项目名称",
"color": "#F18181",
"closed": false,
"groupId": "6436176a47fd2e05f26ef56e",
"viewMode": "list",
"kind": "TASK"
},
"tasks": [{
"id": "6247ee29630c800f064fd145",
"isAllDay": true,
"projectId": "6226ff9877acee87727f6bca",
"title": "任务标题",
"content": "任务内容",
"desc": "任务描述",
"timeZone": "America/Los_Angeles",
"repeatFlag": "RRULE:FREQ=DAILY;INTERVAL=1",
"startDate": "2019-11-13T03:00:00+0000",
"dueDate": "2019-11-14T03:00:00+0000",
"reminders": [
"TRIGGER:P0DT9H0M0S",
"TRIGGER:PT0S"
],
"priority": 1,
"status": 0,
"completedTime": "2019-11-13T03:00:00+0000",
"sortOrder": 12345,
"items": [{
"id": "6435074647fd2e6387145f20",
"status": 0,
"title": "子任务标题",
"sortOrder": 12345,
"startDate": "2019-11-13T03:00:00+0000",
"isAllDay": false,
"timeZone": "America/Los_Angeles",
"completedTime": "2019-11-13T03:00:00+0000"
}]
}],
"columns": [{
"id": "6226ff9e76e5fc39f2862d1b",
"projectId": "6226ff9877acee87727f6bca",
"name": "栏目名称",
"sortOrder": 0
}]
}
```

#### 创建项目
`POST /open/v1/project`

**请求体参数 (Body Parameters):**

| 名称 | 描述 | Schema | 是否必需 |
| :---------- | :-------------------------------------------- | :------------- | :----- |
| `name` | 项目名称 | string | 是 |
| `color` | 项目颜色，例如：`"#F18181"` | string | 否 |
| `sortOrder` | 项目的排序值 | integer(int64) | 否 |
| `viewMode` | 视图模式，可选值：`"list"`, `"kanban"`, `"timeline"` | string | 否 |
| `kind` | 项目类型，可选值：`"TASK"`, `"NOTE"` | string | 否 |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :------ |
| `200` | OK (通常创建成功返回 201) | Project |
| `201` | Created | Project (或无内容) |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
POST /open/v1/project HTTP/1.1
Host: api.dida365.com
Content-Type: application/json
Authorization: Bearer {{token}}

{
"name": "新项目名称",
"color": "#F18181",
"viewMode": "list",
"kind": "TASK"
}
```

**响应:**
```json
{
"id": "6226ff9877acee87727f6bca",
"name": "新项目名称",
"color": "#F18181",
"sortOrder": 0,
"viewMode": "list",
"kind": "TASK"
}
```

#### 更新项目
`POST /open/v1/project/{projectId}`

**路径参数 (Path Parameters):**

| 类型 | 名称 | 描述 | Schema |
| :----- | :---------- | :------- | :----- |
| `Path` | `projectId` | 项目ID (必需) | string |

**请求体参数 (Body Parameters):**

| 名称 | 描述 | Schema | 是否必需 |
| :---------- | :-------------------------------------------- | :------------- | :----- |
| `name` | 项目名称 | string | 否 |
| `color` | 项目颜色 | string | 否 |
| `sortOrder` | 排序值，默认为 0 | integer(int64) | 否 |
| `viewMode` | 视图模式，可选值：`"list"`, `"kanban"`, `"timeline"` | string | 否 |
| `kind` | 项目类型，可选值：`"TASK"`, `"NOTE"` | string | 否 |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :------ |
| `200` | OK | Project |
| `201` | Created (不适用) | 无内容 |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
POST /open/v1/project/{{projectId}} HTTP/1.1
Host: api.dida365.com
Content-Type: application/json
Authorization: Bearer {{token}}

{
"name": "更新后的项目名称",
"color": "#F18181",
"viewMode": "list",
"kind": "TASK"
}
```

**响应:**
```json
{
"id": "{{projectId}}",
"name": "更新后的项目名称",
"color": "#F18181",
"sortOrder": 0,
"viewMode": "list",
"kind": "TASK"
}
```

#### 删除项目
`DELETE /open/v1/project/{projectId}`

**路径参数 (Path Parameters):**

| 类型 | 名称 | 描述 | Schema |
| :----- | :---------- | :------- | :----- |
| `Path` | `projectId` | 项目ID (必需) | string |

**响应 (Responses):**

| HTTP 状态码 | 描述 | Schema |
| :---------- | :--------- | :----- |
| `200` | OK | 无内容 |
| `204` | No Content (更符合语义的成功删除) | 无内容 |
| `401` | Unauthorized | 无内容 |
| `403` | Forbidden | 无内容 |
| `404` | Not Found | 无内容 |

**示例:**

**请求:**
```http
DELETE /open/v1/project/{{projectId}} HTTP/1.1
Host: api.dida365.com
Authorization: Bearer {{token}}
```

## 数据结构定义 (Definitions)

#### ChecklistItem (子任务项)

| 名称 | 描述 | 数据类型 (Schema) |
| :-------------- | :--------------------------------------------------------- | :---------------- |
| `id` | 子任务ID | string |
| `title` | 子任务标题 | string |
| `status` | 子任务的完成状态。值：`0` (普通/未完成), `1` (已完成) | integer (int32) |
| `completedTime` | 子任务完成时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | string (date-time)|
| `isAllDay` | 是否全天 | boolean |
| `sortOrder` | 子任务排序值 (例如：`234444`) | integer (int64) |
| `startDate` | 子任务开始日期时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | string (date-time)|
| `timeZone` | 子任务时区 (例如："America/Los_Angeles") | string |

#### Task (任务)

| 名称 | 描述 | 数据类型 (Schema) |
| :-------------- | :--------------------------------------------------------- | :----------------------- |
| `id` | 任务ID | string |
| `projectId` | 任务所属项目ID | string |
| `title` | 任务标题 | string |
| `isAllDay` | 是否全天 | boolean |
| `completedTime` | 任务完成时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | string (date-time) |
| `content` | 任务内容 | string |
| `desc` | 任务的清单描述 | string |
| `dueDate` | 任务截止日期时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | string (date-time) |
| `items` | 任务的子任务列表 | ` 数组` |
| `priority` | 任务优先级。值：`0` (无), `1` (低), `3` (中), `5` (高) | integer (int32) |
| `reminders` | 提醒触发器列表 (例如：`["TRIGGER:P0DT9H0M0S", "TRIGGER:PT0S"]`) | ` 数组` |
| `repeatFlag` | 任务的重复规则 (例如："RRULE:FREQ=DAILY;INTERVAL=1") | string |
| `sortOrder` | 任务排序值 (例如：`12345`) | integer (int64) |
| `startDate` | 开始日期时间，格式："yyyy-MM-dd'T'HH:mm:ssZ" (例如："2019-11-13T03:00:00+0000") | string (date-time) |
| `status` | 任务完成状态。值：`0` (普通/未完成), `2` (已完成) | integer (int32) |
| `timeZone` | 任务时区 (例如："America/Los_Angeles") | string |

#### Project (项目)

| 名称 | 描述 | 数据类型 (Schema) |
| :----------- | :-------------------------------------------------- | :---------------- |
| `id` | 项目ID | string |
| `name` | 项目名称 | string |
| `color` | 项目颜色 | string |
| `sortOrder` | 排序值 | integer (int64) |
| `closed` | 项目是否已关闭 | boolean |
| `groupId` | 项目组ID | string |
| `viewMode` | 视图模式，可选值：`"list"`, `"kanban"`, `"timeline"` | string |
| `permission` | 权限，可选值：`"read"`, `"write"`, `"comment"` | string |
| `kind` | 类型，可选值：`"TASK"` (任务清单), `"NOTE"` (笔记清单) | string |

#### Column (看板栏目)

| 名称 | 描述 | 数据类型 (Schema) |
| :---------- | :------- | :---------------- |
| `id` | 栏目ID | string |
| `projectId` | 项目ID | string |
| `name` | 栏目名称 | string |
| `sortOrder` | 排序值 | integer (int64) |

#### ProjectData (项目数据)

| 名称 | 描述 | 数据类型 (Schema) |
| :-------- | :------------- | :---------------- |
| `project` | 项目信息 | Project |
| `tasks` | 项目下的未完成任务 | ` 数组` |
| `columns` | 项目下的看板栏目 | ` 数组` |

## 反馈与支持

如果您对滴答清单开放API文档有任何疑问或反馈，请通过 `support@dida365.com` 联系我们。我们感谢您的意见，并将尽快解决任何疑虑或问题。感谢您选择滴答清单！

---