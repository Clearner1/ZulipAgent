#!/usr/bin/env npx tsx
/**
 * 滴答清单任务管理脚本
 * 用法：
 *   npx tsx task.ts list [today|all|projectId]       # 列出任务（默认 today）
 *   npx tsx task.ts projects                          # 列出所有项目
 *   npx tsx task.ts create /tmp/dida_body.json        # 创建任务（从JSON文件读取）
 *   npx tsx task.ts update /tmp/dida_body.json        # 更新任务（从JSON文件读取）
 *   npx tsx task.ts complete <projectId> <taskId>     # 完成任务
 *   npx tsx task.ts delete <projectId> <taskId>       # 删除任务
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

// ══════════════════════════════════════════════════════════════
// 日期工具函数（北京时间 UTC+8）
// ══════════════════════════════════════════════════════════════

/** 获取当前北京时间的 Date 对象（基于系统时间） */
function getNowBeijing(): Date {
    return new Date(); // 系统已在 UTC+8
}

/** 获取今天北京时间 00:00:00 的 Date */
function getTodayStart(): Date {
    const now = getNowBeijing();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/** 获取明天北京时间 00:00:00 的 Date */
function getTomorrowStart(): Date {
    const today = getTodayStart();
    return new Date(today.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * 解析 API 返回的时间字符串为 Date 对象
 * 支持：+0800、+0000、Z 后缀
 * 统一输出为北京时间
 */
function parseApiDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null;
    try {
        // 本地格式：YYYY-MM-DD HH:MM:SS（已转换为北京时间，直接解析）
        if (dateStr.includes(" ") && !dateStr.includes("T")) {
            const [datePart, timePart] = dateStr.split(" ");
            const [year, month, day] = datePart.split("-").map(Number);
            const [hours, minutes, seconds] = timePart.split(":").map(Number);
            return new Date(year, month - 1, day, hours, minutes, seconds || 0);
        }

        // API 格式：带 T 和时区后缀
        const isUTC = dateStr.includes("+0000") || dateStr.endsWith("Z");

        let cleanStr = dateStr;
        if (cleanStr.includes(".")) cleanStr = cleanStr.split(".")[0];
        cleanStr = cleanStr.replace("+0800", "").replace("+0000", "").replace("Z", "");

        const datePart = cleanStr.split("T")[0];
        const timePart = cleanStr.split("T")[1] || "00:00:00";
        const [year, month, day] = datePart.split("-").map(Number);
        const [hours, minutes, seconds] = timePart.split(":").map(Number);

        let date = new Date(year, month - 1, day, hours, minutes, seconds || 0);

        // UTC 时间需要加 8 小时转北京时间
        if (isUTC) {
            date = new Date(date.getTime() + 8 * 60 * 60 * 1000);
        }

        return date;
    } catch {
        return null;
    }
}

/**
 * 将 API 时间转换为北京时间字符串
 * 输出格式：YYYY-MM-DD HH:MM:SS
 */
function fromApiDateTime(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    const date = parseApiDate(dateStr);
    if (!date) return dateStr;

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 格式化截止日期
 * 如果截止时间是 0 点，自动加 1 天（滴答清单的全天任务 dueDate 是前一天的 0 点）
 */
function formatDueDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    const date = parseApiDate(dateStr);
    if (!date) return dateStr;

    if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
        date.setDate(date.getDate() + 1);
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 检查日期是否为今天（北京时间） */
function isToday(dateStr: string | null | undefined): boolean {
    if (!dateStr) return false;
    const date = parseApiDate(dateStr);
    if (!date) return false;

    const todayStart = getTodayStart();
    const tomorrowStart = getTomorrowStart();
    return date >= todayStart && date < tomorrowStart;
}

/**
 * 将本地时间字符串转为 API 格式
 * 输入：YYYY-MM-DD HH:MM:SS 或 YYYY-MM-DD
 * 输出：YYYY-MM-DDThh:mm:ss.000+0800
 */
function toApiDateTime(dateStr: string): string {
    let year: number, month: number, day: number;
    let hours = 0, minutes = 0, seconds = 0;

    if (dateStr.includes(" ") && dateStr.length > 10) {
        const parts = dateStr.split(" ");
        const dateParts = parts[0].split("-");
        const timeParts = parts[1].split(":");
        year = parseInt(dateParts[0]);
        month = parseInt(dateParts[1]);
        day = parseInt(dateParts[2]);
        hours = parseInt(timeParts[0]);
        minutes = parseInt(timeParts[1]);
        seconds = parseInt(timeParts[2]) || 0;
    } else {
        const parts = dateStr.split("-");
        year = parseInt(parts[0]);
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}.000+0800`;
}

// ══════════════════════════════════════════════════════════════
// API 调用
// ══════════════════════════════════════════════════════════════

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


// ══════════════════════════════════════════════════════════════
// 任务处理
// ══════════════════════════════════════════════════════════════

interface SimpleTask {
    id: string;
    title: string;
    content?: string;
    priority: number;
    status: number;
    isCompleted: boolean;
    projectId: string;
    projectName: string;
    startDate?: string;
    dueDate?: string;
    kind?: string;
    isAllDay?: boolean;
}

/** 获取所有任务（遍历所有项目 + 收集箱），转换为北京时间 */
async function getAllTasks(): Promise<{ tasks: SimpleTask[]; projects: any[] }> {
    const allProjects: any[] = await apiGet("/project");
    const projects = allProjects.filter((p: any) => !p.closed);
    const tasks: SimpleTask[] = [];

    const projectNameMap = new Map<string, string>();
    for (const p of projects) {
        if (p.id) projectNameMap.set(p.id, p.name);
    }

    // 收集箱
    try {
        const inboxData: any = await apiGet("/project/inbox/data");
        for (const t of inboxData.tasks || []) {
            if (t.kind === "NOTE") continue;
            tasks.push(normalizeTask(t, "inbox", "收集箱"));
        }
    } catch (e) {
        // 收集箱可能为空
    }

    // 遍历项目
    for (const project of projects) {
        if (!project.id) continue;
        try {
            const data: any = await apiGet(`/project/${project.id}/data`);
            for (const t of data.tasks || []) {
                if (t.kind === "NOTE") continue;
                tasks.push(normalizeTask(t, project.id, project.name));
            }
        } catch (e) {
            // 跳过失败的项目
        }
    }

    return { tasks, projects };
}

/** 标准化任务：转换时间、确定完成状态 */
function normalizeTask(raw: any, projectId: string, projectName: string): SimpleTask {
    const rawStatus = (raw.status ?? 0) as number;
    const isCompleted = raw.isCompleted || rawStatus === 2 || rawStatus === 1;

    return {
        id: raw.id,
        title: raw.title,
        content: raw.content || undefined,
        priority: raw.priority ?? 0,
        status: isCompleted ? 2 : 0,
        isCompleted,
        projectId,
        projectName,
        startDate: fromApiDateTime(raw.startDate) || undefined,
        dueDate: formatDueDate(raw.dueDate) || undefined,
        kind: raw.kind,
        isAllDay: raw.isAllDay,
    };
}

/** 过滤今天的任务（未完成 + 今天有关联的） */
function filterTodayTasks(tasks: SimpleTask[]): SimpleTask[] {
    return tasks.filter((t) => {
        // 排除已完成
        if (t.isCompleted) return false;

        // startDate 或 dueDate 是今天
        if (isToday(t.startDate) || isToday(t.dueDate)) return true;

        // 检查跨越今天的任务：startDate < 今天 且 dueDate >= 今天
        const startDate = t.startDate ? new Date(t.startDate) : null;
        const dueDate = t.dueDate ? new Date(t.dueDate) : null;
        const todayStart = getTodayStart();

        if (startDate && startDate < todayStart) {
            if (!dueDate || dueDate >= todayStart) {
                return true;
            }
        }

        return false;
    });
}

const priorityLabels: Record<number, string> = { 0: "无", 1: "低", 3: "中", 5: "高" };

// ══════════════════════════════════════════════════════════════
// 命令实现
// ══════════════════════════════════════════════════════════════

async function listProjects() {
    const projects: any[] = await apiGet("/project");
    const result = projects
        .filter((p: any) => !p.closed)
        .map((p: any) => ({ id: p.id, name: p.name, kind: p.kind }));
    console.log(JSON.stringify({ success: true, projects: result }, null, 2));
}

async function listTasks(modeOrProjectId: string) {
    const { tasks, projects } = await getAllTasks();

    let filtered: SimpleTask[];
    let mode: string;

    if (modeOrProjectId === "today") {
        filtered = filterTodayTasks(tasks);
        mode = "today";
    } else if (modeOrProjectId === "all") {
        filtered = tasks.filter((t) => !t.isCompleted);
        mode = "all (未完成)";
    } else {
        // 按项目 ID 筛选
        filtered = tasks.filter((t) => t.projectId === modeOrProjectId && !t.isCompleted);
        mode = `project:${modeOrProjectId}`;
    }

    // 展示友好的优先级
    const display = filtered.map((t) => ({
        ...t,
        priorityLabel: priorityLabels[t.priority] || "无",
    }));

    console.log(
        JSON.stringify(
            {
                success: true,
                mode,
                count: display.length,
                currentTime: fromApiDateTime(new Date().toISOString()) || new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
                tasks: display,
            },
            null,
            2,
        ),
    );
}

async function createTask(inputFile: string) {
    const fs = await import("fs");
    const raw = fs.readFileSync(inputFile, "utf-8");
    const body = JSON.parse(raw);

    if (!body.title) {
        console.error("错误：JSON 文件必须包含 title 字段");
        process.exit(1);
    }

    if (!body.projectId) body.projectId = "inbox";

    // 转换日期为 API 格式
    if (body.startDate && !body.startDate.includes("T")) {
        body.startDate = toApiDateTime(body.startDate);
    }
    if (body.dueDate && !body.dueDate.includes("T")) {
        body.dueDate = toApiDateTime(body.dueDate);
    }
    if (!body.timeZone) body.timeZone = "Asia/Shanghai";

    const result = await apiPost("/task", body);

    console.log(
        JSON.stringify({
            success: true,
            taskId: result.id,
            title: result.title,
            startDate: fromApiDateTime(result.startDate),
            dueDate: formatDueDate(result.dueDate),
            message: "任务已创建",
        }),
    );
}

async function completeTask(projectId: string, taskId: string) {
    await apiPost(`/project/${projectId}/task/${taskId}/complete`, {});
    console.log(JSON.stringify({ success: true, message: "任务已完成" }));
}

// ══════════════════════════════════════════════════════════════
// 主入口
// ══════════════════════════════════════════════════════════════

const [action, ...args] = process.argv.slice(2);

async function main() {
    switch (action) {
        case "projects":
            await listProjects();
            break;
        case "list":
            await listTasks(args[0] || "today");
            break;
        case "create":
            if (!args[0]) {
                console.error("用法: task.ts create <json文件路径>");
                process.exit(1);
            }
            await createTask(args[0]);
            break;
        case "complete":
            if (!args[0] || !args[1]) {
                console.error("用法: task.ts complete <projectId> <taskId>");
                process.exit(1);
            }
            await completeTask(args[0], args[1]);
            break;
        default:
            console.error("用法: task.ts <projects|list|create|complete> [参数]");
            process.exit(1);
    }
}

main().catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
});
