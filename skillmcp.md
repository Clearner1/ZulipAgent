MCP = 模型上下文协议前言：MCP 协议的被忽视的能力当我们谈论 MCP (Model Context Protocol) 时，大多数人的第一反应是 Tools —— 让 Agent 能够调用外部工具执行操作。但 MCP 协议的设计远不止于此。完整的 MCP 协议定义了三类核心接口：interface MCPCapabilities {
  tools: Tool[];        // 工具调用 - 被广泛使用
  resources: Resource[]; // 资源访问 - 被忽视
  prompts: Prompt[];     // 提示模板 - 被忽视
}
Resources 允许 Agent 读取各种资源内容（文件、数据、配置等），Prompts 允许暴露可复用的提示模板。这两个能力在当前的 MCP 生态中几乎没有被充分利用，但它们恰恰是连接 MCP 与 Skill 的关键桥梁。一、Skill 与 MCP：本质差异Skill 是什么？Skill 是 Anthropic 在 Claude Code 中引入的概念，本质上是一个知识包：skill-name/
├── SKILL.md          # 核心：指导 Agent 如何完成任务的知识
├── scripts/          # 可选：可执行脚本
├── references/       # 可选：参考文档
└── assets/           # 可选：模板、图片等资源
Skill 的核心价值在于传递上下文 —— 告诉 Agent "在面对这类任务时，应该如何思考、如何行动、有哪些最佳实践"。MCP 是什么？MCP 是一个连接协议，让 Agent 能够与外部服务交互：MCP Server
├── Tools      # 可调用的操作（如 create_file, query_database）
├── Resources  # 可读取的资源（如 file://、db://）
└── Prompts    # 可复用的提示模板
MCP 的核心价值在于扩展能力边界 —— 让 Agent 能够"做"原本做不了的事。一句话区分SkillMCP教 Agent "怎么做"让 Agent "能做什么"知识传递能力扩展静态文档动态服务二、为什么 Skill 和 MCP 的边界在模糊？观察 1：很多 Skill 本质上是在教 Agent 使用特定工具以官方的 pdf skill 为例：# PDF Processing Guide

## Python Libraries
### pypdf - Basic Operations
### pdfplumber - Text and Table Extraction
### reportlab - Create PDFs

## Common Tasks
- Extract Text from Scanned PDFs (OCR)
- Add Watermark
- Password Protection
这个 Skill 在教什么？如何正确使用 PDF 处理工具。如果存在一个 pdf-mcp Server，它提供 extract_text、merge_pdfs、add_watermark 等 Tools，那么这个 Skill 本质上就是这个 MCP Server 的使用指南。观察 2：工具提供商最适合编写对应的 Skill谁最懂 Notion API？Notion 团队。
谁最懂 GitHub API？GitHub 团队。
谁最懂某个 MCP Server 的最佳用法？这个 MCP Server 的作者。Tool + Skill 同源分发变得非常合理：notion-mcp/
├── server.ts         # MCP Server: 提供 Tools
├── SKILL.md          # Skill: 教 Agent 如何用好这些 Tools
└── references/       # 进阶用法文档
观察 3：Skill 的附加资源需要执行环境一些 Skill 包含可执行脚本：xlsx-skill/
├── SKILL.md
└── scripts/
    └── recalc.py     # 需要 Python 环境执行
这些脚本本质上就是 Tools，只是以文件形式分发而非服务形式。如果将它们封装进 MCP Server，就能获得：•统一的调用接口•环境依赖的封装•版本管理和更新三、两种分发范式的对比范式 A：文件分发（当前 Skill 模式）创作者                    消费者
   │                        │
   ▼                        ▼
写 SKILL.md    ───────►   下载到本地
发 GitHub/压缩包          放入 .claude/skills/
                          Agent 读取使用
优势：•零门槛创作：任何人写个 Markdown 就能分享经验•去中心化：不依赖任何平台•离线可用：本地文件，无网络依赖劣势：•分发碎片化，难以发现•无自动更新机制•资源文件需要手动管理范式 B：服务分发（MCP 模式）创作者                              消费者
   │                                  │
   ▼                                  ▼
写 MCP Server  ──►  发布 npm   ──►   npm install
                                     配置 MCP 连接
                                     Agent 远程调用
优势：•中心化管理：npm 生态成熟•自动更新：npm update 一键升级•动态能力：Server 端可以持续进化•可计量：调用次数、用户量可追踪劣势：•高门槛：需要开发能力•运维成本：服务需要部署维护（如果是远程MCP Server）•网络依赖：离线不可用四、融合的可能性：Skill as MCP ResourceMCP 的 Resources 接口提供了一种优雅的融合方式：// 一个 MCP Server 可以同时提供 Tools 和 Skills
const server = new MCPServer();

// 暴露工具
server.registerTool({
  name: "extract_pdf_text",
  description: "Extract text from PDF",
  handler: async (params) => { /* ... */ }
});

// 暴露 Skill 作为 Resource
server.registerResource({
  uri: "skill://pdf-guide",
  name: "PDF Processing Guide",
  mimeType: "text/markdown",
  handler: async () => ({
    text: fs.readFileSync("SKILL.md", "utf-8")
  })
});
Agent 可以：1调用 extract_pdf_text Tool 执行操作2读取 skill://pdf-guide Resource 获取使用指南Tools + Skills 在同一个 MCP Server 中共存，由工具提供商统一维护。五、深层思考：Skill 的本质是什么？回到最根本的问题：Skill 在传递什么？Skill = 上下文 (Context)

具体包括：
├── 领域知识（这个领域的概念、术语、最佳实践）
├── 工作流程（完成任务的步骤和顺序）
├── 工具用法（如何正确使用相关工具）
├── 质量标准（什么是好的输出）
└── 边界条件（什么情况下不应该这样做）
这些上下文可以通过多种方式传递给 Agent：传递方式特点SKILL.md 文件静态、一次性加载MCP Resource动态、按需加载MCP Prompt结构化、可参数化System Prompt全局、始终生效形式不重要，内容才重要。Skill 文件格式的价值在于降低创作门槛，让非开发者也能贡献知识。MCP 的价值在于提供标准化的分发和调用机制。两者并不矛盾 —— Skill 内容可以通过 MCP 协议分发。六、未来可能的演进短期当前格局：
├── Skill：独立的文件格式，通过 GitHub/市场分发
├── MCP：独立的协议标准，通过 npm/服务分发
└── 交集：部分 MCP Server 附带使用指南
中期可能演进：
├── MCP Server 标准化 Skill 暴露方式（resources/prompts）
├── Skill 可以声明依赖的 MCP Server
├── 工具提供商开始 Tools + Skills 联合分发
└── 出现 Skill → MCP 的自动封装工具
终极形态：
├── Skill 成为 MCP Server 的标准组成部分
├── 每个 MCP Server = Tools + Resources + Skills
├── Agent 通过统一的 MCP 协议获取能力和知识
└── 保留独立 Skill 格式作为轻量级创作入口
七、对创作者的建议对 Skill 创作者1继续使用 SKILL.md 格式：低门槛、易分享，这是独特优势2考虑附带 MCP 封装：如果你的 Skill 依赖特定工具，可以一起打包3明确 Tools 依赖：在 Skill 中说明需要哪些 MCP Server对 MCP 开发者1为你的 Tools 编写配套 Skill：告诉 Agent 如何用好你的工具2利用 Resources/Prompts 接口：不只是暴露 Tools3提供最佳实践文档：这就是 Skill 的本质结语MCP 和 Skill 不是竞争关系，而是互补关系：•Skill 解决"知识传递" —— 教 Agent 怎么做•MCP 解决"能力扩展" —— 让 Agent 能做随着生态成熟，我们很可能看到两者的深度融合：Skill 内容通过 MCP 协议分发，MCP Server 自带配套 Skills。但无论技术形态如何演进，有一点不会改变：高质量的上下文（Skill 内容）永远是 Agent 执行复杂任务的关键。写好一个 SKILL.md，依然是任何人都能为 AI 生态做出贡献的最简单方式。MCP = Model Context Protocol
而Agent Skill，正是Context的一部分！