#!/bin/bash
# query_notebooklm.sh - 一条命令查询 NotebookLM，返回纯文本答案
# 用法: bash query_notebooklm.sh "<notebook-url>" "<question>"
# 日志输出到 stderr，答案输出到 stdout

set -e

URL="$1"
QUESTION="$2"

if [ -z "$URL" ] || [ -z "$QUESTION" ]; then
    echo "用法: bash query_notebooklm.sh \"<notebook-url>\" \"<question>\""
    exit 1
fi

# 辅助函数：从 snapshot 行中提取 ref 数字
extract_ref() {
    echo "$1" | sed -n 's/.*ref=\([0-9]*\).*/\1/p' | tail -1
}

# 1. 确保 Daemon 运行
STATUS=$(bb-browser status 2>&1)
if echo "$STATUS" | grep -q "未运行"; then
    echo "🔧 启动 Daemon..." >&2
    nohup node /Users/loumac/Downloads/bb-browser/packages/daemon/dist/index.js > /dev/null 2>&1 &
    sleep 3
fi

# 2. 检查扩展连接
bb-browser tab > /dev/null 2>&1 || {
    echo "❌ bb-browser 扩展未连接，请在 Chrome 中点击 bb-browser 扩展图标激活连接" >&2
    exit 1
}

# 3. 打开 NotebookLM 页面
echo "🌐 正在打开 NotebookLM..." >&2
bb-browser open "$URL" > /dev/null 2>&1
sleep 8

# 4. 获取交互元素快照
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
    bb-browser close > /dev/null 2>&1
    exit 1
fi

# 5. 输入问题并提交
echo "✏️ 输入问题并提交..." >&2
bb-browser type @"$INPUT_REF" "$QUESTION" > /dev/null 2>&1
sleep 1
bb-browser click @"$SUBMIT_REF" > /dev/null 2>&1

# 6. 等待回答生成
echo "⏳ 等待 NotebookLM 回答..." >&2
MAX_WAIT=90
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep 5
    WAITED=$((WAITED + 5))
    PAGE_TAIL=$(bb-browser eval "document.body.innerText.substring(document.body.innerText.length - 300)" 2>&1)
    if echo "$PAGE_TAIL" | grep -q "回复已就绪"; then
        echo "✅ 回答已生成 (${WAITED}s)" >&2
        break
    fi
    echo "  ⏳ 已等待 ${WAITED}s..." >&2
done

# 7. 提取回答 — 用问题文本作为分割点，取最后一段
QUESTION_JS=$(printf '%s' "$QUESTION" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

ANSWER=$(bb-browser eval "(function(){
    var text = document.body.innerText;
    var q = $QUESTION_JS;
    var parts = text.split(q);
    if (parts.length < 2) return '';
    var answer = parts[parts.length - 1];
    var ends = ['56 个来源', '个来源', '查询框'];
    for (var i = 0; i < ends.length; i++) {
        var idx = answer.indexOf(ends[i]);
        if (idx > -1) { answer = answer.substring(0, idx); break; }
    }
    // 清理末尾的按钮文本
    answer = answer.replace(/keep_pin\n?保存到笔记\n?copy_all\n?thumb_up\n?thumb_down\n?/g, '');
    answer = answer.replace(/\n保存到笔记\n/g, '\n');
    return answer.trim();
})()" 2>&1)

# 8. 关闭页面
bb-browser close > /dev/null 2>&1
echo "🔒 完成" >&2

# 9. 输出答案
if [ -z "$ANSWER" ] || [ "$ANSWER" = "undefined" ]; then
    echo "❌ 无法提取回答内容" >&2
    exit 1
fi

echo "$ANSWER"
