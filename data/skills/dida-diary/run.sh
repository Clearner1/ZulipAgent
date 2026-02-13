
#!/bin/bash

# 滴答清单日记管理脚本
# 支持记录日记和查询日记

# 配置
API_BASE="https://api.dida365.com/open/v1"
ACCESS_TOKEN="$DIDA_ACCESS_TOKEN"

# 函数：获取日记项目ID
get_diary_project_id() {
    curl -s -X GET "$API_BASE/project" \
        -H "Authorization: Bearer $ACCESS_TOKEN" | jq -r '.[] | select(.name == "日记") | .id'
}

# 函数：生成简洁标题
generate_title() {
    local content="$1"
    # 去除换行符和多余空格
    local clean_content=$(echo "$content" | tr -d '\n' | tr -s ' ')
    # 截取前10个字符作为标题
    local title=$(echo "$clean_content" | head -c 10)
    # 如果内容少于3个字符，使用默认标题
    if [ ${#title} -lt 3 ]; then
        title="日记"
    fi
    echo "$title"
}

# 函数：记录日记
record_diary() {
    local content="$1"
    local project_id=$(get_diary_project_id)
    
    if [ -z "$project_id" ]; then
        echo "错误：未找到「日记」项目。请先在滴答清单中创建该项目。"
        return 1
    fi
    
    local title=$(generate_title "$content")
    local now=$(date +"%Y-%m-%dT%H:%M:%S.000+0800")
    
    local payload=$(jq -n \
        --arg title "$title" \
        --arg content "$content" \
        --arg projectId "$project_id" \
        --arg kind "NOTE" \
        --arg startDate "$now" \
        --arg timeZone "Asia/Shanghai" \
        '{
            title: $title,
            content: $content,
            projectId: $projectId,
            kind: $kind,
            startDate: $startDate,
            timeZone: $timeZone
        }')
    
    local response=$(curl -s -X POST "$API_BASE/task" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$payload")
    
    if [ $? -eq 0 ]; then
        echo "日记已成功记录！"
    else
        echo "错误：记录日记失败。"
        return 1
    fi
}

# 函数：查询日记
query_diary() {
    local project_id=$(get_diary_project_id)
    
    if [ -z "$project_id" ]; then
        echo "错误：未找到「日记」项目。请先在滴答清单中创建该项目。"
        return 1
    fi
    
    local date_filter="$1"
    local query_url="$API_BASE/project/$project_id/data"
    
    local response=$(curl -s -X GET "$query_url" \
        -H "Authorization: Bearer $ACCESS_TOKEN")
    
    if [ -z "$date_filter" ]; then
        # 查询所有日记
        echo "$response" | jq -r '.tasks[] | select(.kind == "NOTE") | [.startDate, .title, .content]'
    else
        # 按日期过滤查询
        echo "$response" | jq -r --arg date "$date_filter" '.tasks[] | select(.kind == "NOTE" and (.startDate | startswith($date))) | [.startDate, .title, .content]'
    fi
}

# 主程序
main() {
    local command="$1"
    shift
    
    case "$command" in
        --content)
            if [ $# -eq 0 ]; then
                echo "错误：请提供日记内容"
                return 1
            fi
            record_diary "$@"
            ;;
        --query)
            if [ $# -eq 1 ]; then
                query_diary "$1"
            else
                query_diary
            fi
            ;;
        *)
            echo "用法：$0 --content <日记内容> | --query [日期]"
            return 1
            ;;
    esac
}

# 执行主程序
main "$@"
