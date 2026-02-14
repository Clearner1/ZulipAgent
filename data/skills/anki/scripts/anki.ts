#!/usr/bin/env npx tsx
/**
 * Anki 知识库查询脚本（通过 AnkiConnect API）
 * 用法：
 *   npx tsx anki.ts tags                    # 列出顶级标签及卡片数量
 *   npx tsx anki.ts tags <parent>           # 列出某个标签下的子标签及卡片数量
 *   npx tsx anki.ts stats <tag>             # 查看某个标签的详细统计
 *   npx tsx anki.ts reviewed                # 查看今天已复习的卡片数量
 */

const ANKI_URL = "http://127.0.0.1:8765";

// ══════════════════════════════════════════════════════════════
// AnkiConnect API 调用
// ══════════════════════════════════════════════════════════════

async function ankiInvoke(action: string, params: Record<string, any> = {}): Promise<any> {
    const body = { action, version: 6, params };
    const res = await fetch(ANKI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Error(`AnkiConnect HTTP error: ${res.status}`);
    }

    const data = await res.json();
    if (data.error) {
        throw new Error(`AnkiConnect error: ${data.error}`);
    }

    return data.result;
}

/** 批量查询多个标签的卡片数量（并行，每批 20 个） */
async function batchCardCounts(tags: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const batchSize = 20;

    for (let i = 0; i < tags.length; i += batchSize) {
        const batch = tags.slice(i, i + batchSize);
        const counts = await Promise.all(
            batch.map(async (tag) => {
                // 用引号包裹标签名以处理含空格/特殊字符的标签
                const cards: number[] = await ankiInvoke("findCards", {
                    query: `"tag:${tag}"`,
                });
                return { tag, count: cards.length };
            }),
        );
        for (const { tag, count } of counts) {
            result.set(tag, count);
        }
    }

    return result;
}

// ══════════════════════════════════════════════════════════════
// 标签列表（支持层级钻取）
// ══════════════════════════════════════════════════════════════

async function listTags(parent?: string) {
    const allTags: string[] = await ankiInvoke("getTags");

    let targetTags: string[];

    if (parent) {
        // 钻取模式：列出 parent 下的直接子标签
        // 例如 parent="Spring"，找 "Spring::XXX" 中的 XXX（不含更深层级）
        const prefix = `${parent}::`;
        const childTags = allTags.filter((t) => t.startsWith(prefix));

        // 提取直接子标签（只取第一级）
        const directChildren = new Set<string>();
        for (const tag of childTags) {
            const rest = tag.slice(prefix.length);
            const firstPart = rest.split("::")[0];
            directChildren.add(`${prefix}${firstPart}`);
        }

        targetTags = Array.from(directChildren);

        if (targetTags.length === 0) {
            // 没有子标签，说明这个标签就是叶子节点
            console.log(
                JSON.stringify({
                    success: true,
                    parent,
                    message: `标签「${parent}」没有子标签，它本身就是最细粒度的标签。`,
                    children: [],
                }),
            );
            return;
        }
    } else {
        // 概览模式：只列出顶级标签（不含 ::）
        targetTags = allTags.filter((t) => !t.includes("::"));
    }

    // 批量查询卡片数量
    const counts = await batchCardCounts(targetTags);

    // 组装结果，按卡片数量降序
    const tags = targetTags
        .map((tag) => ({
            tag,
            // 显示名：钻取模式下只显示子标签部分
            label: parent ? tag.slice(`${parent}::`.length) : tag,
            cardCount: counts.get(tag) || 0,
        }))
        .filter((t) => t.cardCount > 0)
        .sort((a, b) => b.cardCount - a.cardCount);

    // 计算总数
    const totalCards = tags.reduce((sum, t) => sum + t.cardCount, 0);

    console.log(
        JSON.stringify(
            {
                success: true,
                ...(parent ? { parent } : {}),
                totalCards,
                tagCount: tags.length,
                tags,
            },
            null,
            2,
        ),
    );
}

// ══════════════════════════════════════════════════════════════
// 标签详细统计
// ══════════════════════════════════════════════════════════════

async function tagStats(tag: string) {
    // 用引号包裹标签名以处理含空格/特殊字符的标签
    const quotedTag = `"tag:${tag}"`;

    // 并行查询各种状态的卡片数量
    const [totalCards, newCards, learningCards, reviewCards, dueCards] = await Promise.all([
        ankiInvoke("findCards", { query: quotedTag }),
        ankiInvoke("findCards", { query: `${quotedTag} is:new` }),
        ankiInvoke("findCards", { query: `${quotedTag} is:learn` }),
        ankiInvoke("findCards", { query: `${quotedTag} is:review` }),
        ankiInvoke("findCards", { query: `${quotedTag} is:due` }),
    ]);

    const total = (totalCards as number[]).length;
    const newCount = (newCards as number[]).length;
    const learningCount = (learningCards as number[]).length;
    const reviewCount = (reviewCards as number[]).length;
    const dueCount = (dueCards as number[]).length;

    console.log(
        JSON.stringify(
            {
                success: true,
                tag,
                total,
                new: newCount,
                learning: learningCount,
                review: reviewCount,
                due: dueCount,
                summary: `${tag}: 共 ${total} 张卡片，${dueCount} 张到期，${newCount} 张新卡，${learningCount} 张学习中，${reviewCount} 张待复习`,
            },
            null,
            2,
        ),
    );
}

// ══════════════════════════════════════════════════════════════
// 今日复习统计
// ══════════════════════════════════════════════════════════════

async function reviewedToday() {
    const count: number = await ankiInvoke("getNumCardsReviewedToday");

    // 获取今天的日期（北京时间）
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    console.log(
        JSON.stringify(
            {
                success: true,
                date: today,
                reviewedCount: count,
                summary: `今天（${today}）已复习 ${count} 张卡片`,
            },
            null,
            2,
        ),
    );
}

// ══════════════════════════════════════════════════════════════
// 主入口
// ══════════════════════════════════════════════════════════════

const [action, ...args] = process.argv.slice(2);

async function main() {
    switch (action) {
        case "tags":
            await listTags(args[0]);
            break;
        case "stats":
            if (!args[0]) {
                console.error("用法: anki.ts stats <tag>");
                console.error("示例: anki.ts stats Spring");
                console.error("示例: anki.ts stats Spring::IOC");
                process.exit(1);
            }
            await tagStats(args[0]);
            break;
        case "reviewed":
            await reviewedToday();
            break;
        default:
            console.error("用法: anki.ts <tags|stats|reviewed> [参数]");
            console.error("  tags              列出顶级标签及卡片数量");
            console.error("  tags <parent>     列出某个标签下的子标签及卡片数量");
            console.error("  stats <tag>       查看某个标签的详细统计（支持子标签）");
            console.error("  reviewed          查看今天已复习的卡片数量");
            process.exit(1);
    }
}

main().catch((e) => {
    if (e.message?.includes("ECONNREFUSED") || e.message?.includes("fetch failed")) {
        console.error(JSON.stringify({
            success: false,
            error: "无法连接到 AnkiConnect。请确认 Anki 桌面端正在运行且 AnkiConnect 插件已安装。",
        }));
    } else {
        console.error(JSON.stringify({
            success: false,
            error: e.message,
        }));
    }
    process.exit(1);
});
