#!/usr/bin/env npx tsx
/**
 * 滴答清单日记管理脚本
 * 用法：
 *   npx tsx diary.ts record /tmp/dida_body.json   # 记录日记（从JSON文件读取title和content）
 *   npx tsx diary.ts query [today|week|all]        # 查询日记
 */

const DIDA_BASE = "https://api.dida365.com/open/v1";
const TOKEN = process.env.DIDA_ACCESS_TOKEN;

if (!TOKEN) {
    console.error("错误：DIDA_ACCESS_TOKEN 环境变量未设置");
    process.exit(1);
}

const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json; charset=utf-8",
};

async function apiGet(path: string) {
    const res = await fetch(`${DIDA_BASE}${path}`, { headers });
    if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function apiPost(path: string, body: any) {
    const res = await fetch(`${DIDA_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function findDiaryProject(): Promise<{ id: string; name: string } | null> {
    const projects: any[] = await apiGet("/project");
    return projects.find((p) => p.name === "日记") || null;
}

// ── 记录日记 ──
async function recordDiary(inputFile: string) {
    const fs = await import("fs");
    const raw = fs.readFileSync(inputFile, "utf-8");
    const { title, content } = JSON.parse(raw);

    if (!title || !content) {
        console.error("错误：JSON 文件必须包含 title 和 content 字段");
        process.exit(1);
    }

    const project = await findDiaryProject();
    if (!project) {
        console.error('错误：未找到名为"日记"的项目，请先在滴答清单中创建');
        process.exit(1);
    }

    const now = new Date();
    const tz = "Asia/Shanghai";
    const pad = (n: number) => String(n).padStart(2, "0");
    const startDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.000+0800`;

    const result = await apiPost("/task", {
        title,
        content,
        projectId: project.id,
        kind: "NOTE",
        startDate,
        timeZone: tz,
    });

    console.log(JSON.stringify({ success: true, noteId: result.id, projectId: project.id, title, message: "日记已成功记录" }));
}

// ── 查询日记 ──
async function queryDiaries(range: string) {
    const project = await findDiaryProject();
    if (!project) {
        console.error('错误：未找到名为"日记"的项目');
        process.exit(1);
    }

    const data: any = await apiGet(`/project/${project.id}/data`);
    const notes = (data.tasks || []).filter((t: any) => t.kind === "NOTE");

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    let filtered = notes;
    if (range === "today") {
        filtered = notes.filter((n: any) => n.startDate && n.startDate.startsWith(todayStr));
    } else if (range === "week") {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filtered = notes.filter((n: any) => n.startDate && new Date(n.startDate) >= weekAgo);
    }

    const result = filtered.map((n: any) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        date: n.startDate,
    }));

    console.log(JSON.stringify({ success: true, count: result.length, range, diaries: result }, null, 2));
}

// ── 主入口 ──
const [action, arg] = process.argv.slice(2);

if (action === "record") {
    if (!arg) {
        console.error("用法: diary.ts record <json文件路径>");
        process.exit(1);
    }
    recordDiary(arg).catch((e) => {
        console.error("错误:", e.message);
        process.exit(1);
    });
} else if (action === "query") {
    queryDiaries(arg || "all").catch((e) => {
        console.error("错误:", e.message);
        process.exit(1);
    });
} else {
    console.error("用法: diary.ts <record|query> [参数]");
    process.exit(1);
}
