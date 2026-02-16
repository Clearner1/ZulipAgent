#!/bin/bash
# query_notebooklm.sh - 查询 NotebookLM 并直接发送答案到 Zulip
# 用法: bash query_notebooklm.sh "<notebook-url>" "<问题>" "<stream>" "<topic>"
# 
# 答案会直接通过 Zulip API 发送，不经过 Agent（避免 LLM 压缩/改写内容）
# stdout 只返回简短确认信息给 Agent
# 日志输出到 stderr

set -e

URL="$1"
QUESTION="$2"
ZULIP_STREAM="$3"
ZULIP_TOPIC="$4"

if [ -z "$URL" ] || [ -z "$QUESTION" ] || [ -z "$ZULIP_STREAM" ] || [ -z "$ZULIP_TOPIC" ]; then
    echo "用法: bash query_notebooklm.sh \"<notebook-url>\" \"<问题>\" \"<stream>\" \"<topic>\"" >&2
    exit 1
fi

# ============================================================================
# Zulip 凭证 — 从 .env 文件读取
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../../.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ 找不到 .env 文件: $ENV_FILE" >&2
    exit 1
fi

# 读取 .env（简单解析，不处理 export）
ZULIP_URL=$(grep '^ZULIP_URL=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')
ZULIP_BOT_EMAIL=$(grep '^ZULIP_BOT_EMAIL=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')
ZULIP_BOT_API_KEY=$(grep '^ZULIP_BOT_API_KEY=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')

if [ -z "$ZULIP_URL" ] || [ -z "$ZULIP_BOT_EMAIL" ] || [ -z "$ZULIP_BOT_API_KEY" ]; then
    echo "❌ .env 文件中缺少 ZULIP_URL / ZULIP_BOT_EMAIL / ZULIP_BOT_API_KEY" >&2
    exit 1
fi

# ============================================================================
# 文件锁 — mkdir 原子锁，同一时间只允许一个实例运行
# ============================================================================
LOCK_DIR="/tmp/notebooklm_query.lock"
LOCK_TIMEOUT=300

acquire_lock() {
    local waited=0
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo $$ > "$LOCK_DIR/pid"
        return 0
    fi

    echo "⏳ 另一个 NotebookLM 查询正在进行，等待中..." >&2

    if [ -f "$LOCK_DIR/pid" ]; then
        local lock_pid
        lock_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)
        if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
            echo "  ⚠️ 持锁进程 $lock_pid 已退出，清理残留锁" >&2
            rm -rf "$LOCK_DIR"
            mkdir "$LOCK_DIR" 2>/dev/null && echo $$ > "$LOCK_DIR/pid" && return 0
        fi
    fi

    while [ $waited -lt $LOCK_TIMEOUT ]; do
        sleep 5
        waited=$((waited + 5))
        if mkdir "$LOCK_DIR" 2>/dev/null; then
            echo $$ > "$LOCK_DIR/pid"
            return 0
        fi
    done

    echo "❌ 等待超时（${LOCK_TIMEOUT}s），另一个查询可能卡住了" >&2
    exit 1
}

release_lock() {
    rm -rf "$LOCK_DIR" 2>/dev/null || true
}

cleanup() {
    bb-browser close > /dev/null 2>&1 || true
    release_lock
}
trap cleanup EXIT

acquire_lock

# ============================================================================
# 配置
# ============================================================================
MIN_WAIT=45
MAX_WAIT=120
STABLE_CHECKS=2
CHECK_INTERVAL=5

extract_ref() {
    echo "$1" | sed -n 's/.*ref=\([0-9]*\).*/\1/p' | tail -1
}

get_page_text_length() {
    bb-browser eval "document.body.innerText.length" 2>&1 | tr -d '[:space:]'
}

# ============================================================================
# Zulip 直发函数
# ============================================================================
send_to_zulip() {
    local content="$1"
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -u "$ZULIP_BOT_EMAIL:$ZULIP_BOT_API_KEY" \
        -X POST "$ZULIP_URL/api/v1/messages" \
        -d "type=stream" \
        --data-urlencode "to=$ZULIP_STREAM" \
        --data-urlencode "topic=$ZULIP_TOPIC" \
        --data-urlencode "content=$content" 2>&1)
    
    local http_code
    http_code=$(echo "$response" | tail -1)
    
    if [ "$http_code" = "200" ]; then
        echo "  ✅ Zulip 消息发送成功" >&2
        return 0
    else
        echo "  ❌ Zulip 消息发送失败 (HTTP $http_code)" >&2
        echo "$response" | head -5 >&2
        return 1
    fi
}

# ============================================================================
# 1. 确保 Daemon 运行
# ============================================================================
STATUS=$(bb-browser status 2>&1)
if echo "$STATUS" | grep -q "未运行"; then
    echo "🔧 启动 Daemon..." >&2
    nohup node /Users/loumac/Downloads/bb-browser/packages/daemon/dist/index.js > /dev/null 2>&1 &
    sleep 3
fi

# ============================================================================
# 2. 检查扩展连接
# ============================================================================
bb-browser tab > /dev/null 2>&1 || {
    echo "❌ bb-browser 扩展未连接，请在 Chrome 中点击 bb-browser 扩展图标激活连接" >&2
    exit 1
}

# ============================================================================
# 3. 打开 NotebookLM 页面
# ============================================================================
echo "🌐 正在打开 NotebookLM..." >&2
bb-browser open "$URL" > /dev/null 2>&1
sleep 8

# ============================================================================
# 4. 获取交互元素快照
# ============================================================================
echo "🔍 正在查找输入框..." >&2
SNAPSHOT=$(bb-browser snapshot -i 2>&1)

INPUT_LINE=$(echo "$SNAPSHOT" | grep -i 'textbox.*查询' | tail -1)
if [ -z "$INPUT_LINE" ]; then
    INPUT_LINE=$(echo "$SNAPSHOT" | grep -i 'textbox' | tail -1)
fi
INPUT_REF=$(extract_ref "$INPUT_LINE")

SUBMIT_LINE=$(echo "$SNAPSHOT" | grep -i 'button.*提交' | tail -1)
SUBMIT_REF=$(extract_ref "$SUBMIT_LINE")

if [ -z "$INPUT_REF" ] || [ -z "$SUBMIT_REF" ]; then
    echo "❌ 找不到查询输入框或提交按钮" >&2
    echo "  快照内容:" >&2
    echo "$SNAPSHOT" | head -30 >&2
    exit 1
fi

# ============================================================================
# 5. 输入问题并提交
# ============================================================================
echo "✏️ 输入问题并提交..." >&2
bb-browser type @"$INPUT_REF" "$QUESTION" > /dev/null 2>&1
sleep 1
bb-browser click @"$SUBMIT_REF" > /dev/null 2>&1

# ============================================================================
# 6. 等待回答生成 — 稳定性检测
# ============================================================================
echo "⏳ 等待 NotebookLM 回答..." >&2
WAITED=0
STABLE_COUNT=0
LAST_LENGTH=0

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep $CHECK_INTERVAL
    WAITED=$((WAITED + CHECK_INTERVAL))

    CURRENT_LENGTH=$(get_page_text_length)

    if [ $WAITED -lt $MIN_WAIT ]; then
        echo "  ⏳ 已等待 ${WAITED}s (最少 ${MIN_WAIT}s)..." >&2
        LAST_LENGTH="$CURRENT_LENGTH"
        continue
    fi

    if [ "$CURRENT_LENGTH" = "$LAST_LENGTH" ] && [ -n "$CURRENT_LENGTH" ] && [ "$CURRENT_LENGTH" != "0" ]; then
        STABLE_COUNT=$((STABLE_COUNT + 1))
        echo "  ✓ 文本稳定 (${STABLE_COUNT}/${STABLE_CHECKS}) — ${WAITED}s" >&2
        if [ $STABLE_COUNT -ge $STABLE_CHECKS ]; then
            echo "✅ 回答已稳定 (${WAITED}s)" >&2
            break
        fi
    else
        STABLE_COUNT=0
        echo "  ⏳ 文本仍在变化 (len=${CURRENT_LENGTH}) — ${WAITED}s..." >&2
    fi

    LAST_LENGTH="$CURRENT_LENGTH"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo "⚠️ 等待超时 (${MAX_WAIT}s)，尝试提取当前内容..." >&2
fi

# ============================================================================
# 7. 提取回答
# ============================================================================
QUESTION_JS=$(printf '%s' "$QUESTION" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

ANSWER=$(bb-browser eval "(function(){
    var text = document.body.innerText;
    var q = $QUESTION_JS;

    var parts = text.split(q);
    var answer = '';
    if (parts.length >= 2) {
        answer = parts[parts.length - 1];
    }

    if (!answer) return '';

    var ends = ['个来源', '查询框', '输入问题'];
    for (var i = 0; i < ends.length; i++) {
        var idx = answer.lastIndexOf(ends[i]);
        if (idx > -1) { answer = answer.substring(0, idx); break; }
    }

    answer = answer.replace(/keep_pin\n?保存到笔记\n?copy_all\n?thumb_up\n?thumb_down\n?/g, '');
    answer = answer.replace(/\n保存到笔记\n/g, '\n');
    answer = answer.replace(/copy_all\s*/g, '');
    answer = answer.replace(/thumb_up\s*/g, '');
    answer = answer.replace(/thumb_down\s*/g, '');
    answer = answer.replace(/keep_pin\s*/g, '');

    return answer.trim();
})()" 2>&1)

# ============================================================================
# 8. 关闭页面
# ============================================================================
bb-browser close > /dev/null 2>&1 || true
echo "🔒 页面已关闭" >&2

# ============================================================================
# 9. 验证并发送答案
# ============================================================================
if [ -z "$ANSWER" ] || [ "$ANSWER" = "undefined" ]; then
    echo "❌ 无法提取回答内容" >&2
    exit 1
fi

# 直接发送到 Zulip（绕过 Agent）
echo "📤 正在发送答案到 Zulip..." >&2
FORMATTED="**📖 NotebookLM 回答：${QUESTION}**

${ANSWER}"

if send_to_zulip "$FORMATTED"; then
    # 返回给 Agent 的只是简短确认（Agent 不需要复制粘贴大段文本）
    echo "✅ NotebookLM 的回答已直接发送到 Zulip 对话中，无需你再转述。"
else
    # 发送失败时，将答案返回给 Agent 作为 fallback
    echo "⚠️ Zulip 直发失败，以下是 NotebookLM 的回答，请你转发给用户："
    echo ""
    echo "$ANSWER"
fi
