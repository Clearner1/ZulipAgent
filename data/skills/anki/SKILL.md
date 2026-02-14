---
name: anki
description: Anki 知识库查询 - 查看标签、卡片统计、复习进度（通过 AnkiConnect API）
---

# Anki 知识库查询

通过 AnkiConnect API 查询 Anki 知识库。用于了解卡片数量、复习状态、今日进度，辅助制定复习计划。

脚本位于 `{baseDir}/scripts/anki.ts`。

## 查看顶级标签概览

```bash
npx tsx {baseDir}/scripts/anki.ts tags
```

返回所有顶级标签及卡片数量（不含子标签层级），按卡片数降序。用于了解知识库全貌。

## 钻取子标签

```bash
npx tsx {baseDir}/scripts/anki.ts tags <parent>
```

列出某个标签下的**直接子标签**及各自的卡片数量。用于细分规划。

示例：
```bash
npx tsx {baseDir}/scripts/anki.ts tags Spring
# → Mybatis(25), SpringBoot(18), Bean(17), Spring注解(15), SpringMVC(12), ...

npx tsx {baseDir}/scripts/anki.ts tags Java
# → 并发(161), Asyncflow(81), 八股BootCamp(71), Java基础面试题(55), ...
```

如果子标签还有更深层级，可以继续钻取：
```bash
npx tsx {baseDir}/scripts/anki.ts tags Redis::数据类型
```

## 查看某个标签的详细统计

```bash
npx tsx {baseDir}/scripts/anki.ts stats <tag>
```

返回该标签下的卡片详细状态：
- `total` — 总卡片数
- `new` — 新卡（从未复习过）
- `learning` — 学习中
- `review` — 已进入复习阶段的卡片
- `due` — 今天到期需要复习的卡片

支持子标签：
```bash
npx tsx {baseDir}/scripts/anki.ts stats Spring::Bean
npx tsx {baseDir}/scripts/anki.ts stats Redis::Redis基础原理
```

## 查看今天已复习的卡片数量

```bash
npx tsx {baseDir}/scripts/anki.ts reviewed
```

返回今天已经复习完成的卡片数量。用于晚间日报追踪复习进度。

## 使用场景

### 早间计划（细分到子标签）
1. 调用 `tags` 了解顶级标签全貌
2. 调用 `tags Spring` 钻取到子标签，了解每个子主题的卡片数
3. 创建原子化任务：
   - "上午 Anki 复习：Spring::Mybatis（25张）"
   - "下午 Anki 复习：Spring::Bean（17张）+ Spring::Spring注解（15张）"
4. 建议用户在 Anki 中按对应标签筛选进行复习

### 晚间日报
1. 调用 `reviewed` 查看今天实际复习了多少张卡片
2. 在日报中记录复习进度

### 主题复习规划
当用户说"我要集中复习 XX 专题"时：
1. 调用 `tags <topic>` 看该专题有哪些子标签
2. 根据子标签卡片数制定分天、分时段复习计划
3. 每个复习任务精确到子标签级别

## 注意事项

- 需要 Anki 桌面端正在运行且安装了 AnkiConnect 插件（端口 8765）
- Anki 的标签使用 `::` 分隔层级，如 `Spring::IOC`、`Redis::数据类型`
- stats 命令中的标签名必须完整（如 `Spring::Bean`），不能只写 `Bean`
