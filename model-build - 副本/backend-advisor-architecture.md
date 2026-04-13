# 轻量级后端代码顾问 Agent - 架构与技术清单

## 1. 总体架构图 (Mermaid)

```mermaid
graph TD
    %% 用户与接入层
    Client[前端智能 Coding Agent / 开发者]
    
    %% 会话与网关层 (pi-mono 提供)
    subgraph "Agent 基座 (基于 pi-mono)"
        Gateway[HTTP API / 路由网关]
        SessionStore[(会话存储 SQLite/File)]
        MainAgent(("🤖 主 Agent<br/>(Backend Advisor)"))
        
        Gateway <--> SessionStore
        Gateway <--> MainAgent
    end
    
    Client <-->|提问 / 发送 TraceId| Gateway
    
    %% 工具与技能层
    subgraph "Skill / Tools Layer"
        ApifoxMCP[Apifox MCP Client]
        CodeSearch[CodeSearchTool<br/>(Zero-RAG)]
        LogAnalyzer[TraceLogAnalysisTool<br/>(JSON grep)]
        SubAgent(("🧠 Sub-Agent<br/>(Log Summarizer)"))
        KnowledgeTool[KnowledgeStoreTool]
    end
    
    MainAgent <-->|调用工具| ApifoxMCP
    MainAgent <-->|调用工具| CodeSearch
    MainAgent <-->|调用工具| LogAnalyzer
    MainAgent <-->|调用工具| KnowledgeTool
    
    LogAnalyzer <-->|拉起/获取摘要| SubAgent
    
    %% 数据源与基础设施层
    subgraph "Data Sources / Infrastructure"
        ApifoxServer((Apifox 官方 MCP Server))
        LocalCodeRepo[(本地 Java 源码库)]
        LocalJSONLogs[(应用 JSON 日志文件)]
        JSONKnowledge[(本地知识库 JSON)]
    end
    
    ApifoxMCP <-->|Model Context Protocol| ApifoxServer
    CodeSearch <-->|glob/grep/read| LocalCodeRepo
    LogAnalyzer <-->|单行 grep| LocalJSONLogs
    KnowledgeTool <-->|读写| JSONKnowledge
```

---

## 2. 核心技术选型清单

为了实现“快速落地且易于演进”，本项目的技术栈遵循“极简主义”和“配置优于代码”的原则。

### 2.1 Agent 基础设施
- **Agent 框架**: `pi-mono` (或支持 MCP 与 Tool Calling 的同类单体框架)
  - *理由*: 开箱即用的并发管理、Session 持久化、底层系统工具封装。
- **大语言模型 (LLM)**: 阿里云通义千问 Max / GPT-4o / Claude 3.5 Sonnet
  - *理由*: 需要极强的代码逻辑推理能力和 Function Calling 稳定性。
- **通信协议**: HTTP / WebSocket (由 `pi-mono` 暴露供前端 Agent 调用)
- **子 Agent 调度 (Sub-Agent)**: 基于 `pi-mono` 编程式实例化全新的 Agent Context。

### 2.2 领域知识挂载 (Tools / Skills)
- **接口文档查询**: `Apifox 官方 MCP Server` + 标准 MCP Client
  - *理由*: 零代码集成，直接复用 Apifox 已有的结构化知识和请求示例。
- **代码探索检索**: Zero-RAG (基于底层 `ripgrep` 和 `glob` 工具)
  - *理由*: 抛弃复杂的离线向量化流程，100% 保证查阅到的是实时最新代码。
  - *未来演进*: 本地部署 `Bloop (bloop.ai)` 支持基于 AST 的语义检索。
- **日志排查与提取**: `grep` JSON 结构化日志 + Sub-Agent 降噪
  - *前提*: 后端 Spring Boot 配合引入 `logstash-logback-encoder` 输出 JSON 单行日志。
  - *理由*: 完美规避 Java 多行堆栈提取难题，用子 Agent 清洗大量无用 Spring/Tomcat 反射堆栈，保护主 Agent 显存。
- **经验沉淀与知识库**: 本地扁平 JSON 文件 (`knowledge_store.json`)
  - *理由*: Agent 可通过 `KnowledgeStoreTool` 精准匹配接口/报错的 Keyword 避免上下文污染，且极易实现主动写入学习。

### 2.3 开发环境要求
- **运行时**: Node.js 18+ 或 Python 3.11+ (取决于具体的 pi-mono 实现版本)
- **挂载依赖**:
  - `ripgrep` (用于提供极速文件搜索支持)
  - 对目标后端的本地代码仓库具有**只读权限**
  - 对目标后端的本地日志存放目录具有**只读权限**
  - 对本地经验 JSON 库具有**读写权限**