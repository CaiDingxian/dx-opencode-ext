# Backend Advisor Agent 设计说明书 (Design Document)

## 第一章：设计前的深度思考与分析

在动手构建一个面向“Java + Spring Boot 前后端联调”的代码顾问 Agent 之前，我们必须对真实的业务痛点、系统边界以及大模型时代的架构范式进行深刻的剖析。本章记录了本系统在选型与设计过程中的核心权衡。

### 1. 痛点分析：为什么前端需要一个“后端顾问”？
在现代微服务和前后端分离架构下，联调往往是效率最低的环节：
- **契约滞后**：Apifox / Swagger 文档往往落后于实际代码（“文档上写着非必填，但我一传 null 就报 500”）。
- **黑盒报错**：前端拿到一个无语义的 `TraceId` 或 `500 Internal Server Error`，无法知道后端到底是因为“数据库唯一索引冲突”还是“Redis 宕机”或是“某个必填参数在拦截器被拦截了”。
- **跨栈壁垒**：前端看不懂也不想看后端深达几十层的 Java 异常堆栈和 Spring IOC 源码。

我们的 Agent 必须解决这些问题：它不仅要能“看懂文档”，更要能“去代码和日志里求证”，并把最终结论“翻译”成前端听得懂的话。

### 2. 架构模式的范式转移：摒弃传统 RAG，拥抱 Native Agent
如果是在一年以前，做这样一个系统必然会走向一套庞大的 RAG (Retrieval-Augmented Generation) 架构：引入 LlamaIndex，用 Tree-sitter 切割 Java AST，挂载 ChromaDB/Milvus，建立复杂的向量化流水线（Ingestion Pipeline）。
**但我们为什么决定在这个设计中彻底抛弃离线向量库（Zero-RAG）？**
1. **代码时效性要求极高**：后端刚刚 Commit 并重启服务，前端立刻就遇到了 Bug 发来问询。如果是离线 RAG，必须等待索引重建，这在敏捷开发中不可接受。
2. **LLM 的超长上下文革命**：现在的模型（如 Claude 3.5、GPT-4o、通义千问 Max）轻松具备 128K 甚至 200K 的无损上下文。
3. **原生工具的降维打击**：让 LLM 直接使用操作系统底层的 `ripgrep` (grep) 和 `glob` 在源码仓库里“现搜现看”，不仅 100% 准确（不会因为 Embedding 的语义误差而找错文件），而且零维护成本。这符合“能用算力和网络解决的问题，不要用复杂的中间件去兜底”的现代 Agent 理念。

### 3. 日志分析的难题与破局
Java 异常堆栈长达上百行且无状态，这是排查日志的最大噩梦。
我们做出了两个关键的架构推演：
- **妥协并规范化**：推动后端改造，将日志输出改为 **单行 JSON 格式**（包含完整的 stack_trace 字段）。这比写任何复杂的 Python 状态机脚本都要稳定和优雅。
- **主子 Agent 架构**：哪怕是 JSON，一段完整的 Spring Boot 堆栈也极其消耗 Token 且充满噪音（大量 `org.springframework.cglib` 代理类）。所以不能让回答问题的主 Agent 直接看原始日志，而是引入一个 **Log Summarizer Sub-Agent**，专门做“脏活累活”，它只负责把 10KB 的堆栈提炼成 500 字的核心摘要，再返还给主 Agent 决策。

### 4. 经验的自我沉淀机制
系统不能是个“无状态的傻瓜”，同样的坑（比如“创建订单因为历史遗留问题必须传某废弃字段”）被问第二次时，Agent 应该秒答。
我们摒弃了重型的图数据库或 ElasticSearch，采用**最扁平的本地 JSON 文件 (`knowledge_store.json`)** 作为团队知识库。Agent 通过内部工具不仅能精确检索它，还能在解决问题后主动执行写入，实现极低成本的跨会话记忆。

### 5. 技术选型理由 (The "Why")
- **uv + venv**: 现代 Python 包管理的最优解，速度极快，隔离干净。
- **Python 3.11+**: 原生支持优雅的 `async/await`，且拥有最完善的大模型 SDK（OpenAI / Anthropic 等）。
- **FastAPI + Pydantic**: 极致的性能，自动校验入参，天然适配 Agent 与前端交互时的 RESTful / WebSocket API，Pydantic 在做 LLM 结构化输出校验时无可替代。
- **SQLite + SQLAlchemy**: 会话 (Session) 和运行历史需要持久化，对于内部低并发工具，SQLite 足以支撑，且完全免部署（单文件存储）。
- **pi-mono (作为架构思想)**: 在单体后端中通过依赖注入和流程编排，实现复杂的 ReAct Agent 循环。

---

## 第二章：宏观架构设计与工作原理

### 1. 整体架构图 (高层视角)

系统分为四大层次，采用单体部署（Monolith），依赖极简的本地存储。

```text
[ 前端智能Coding Agent / IDE 插件 / 浏览器客户端 ]
                           |
                           v (HTTP / WebSocket)
+-------------------------------------------------------------+
|                     1. API 接入与路由层                     |
|           (FastAPI / Pydantic / SQLAlchemy 依赖注入)        |
+-------------------------------------------------------------+
                           | 
                           v (Session Context)
+-------------------------------------------------------------+
|                     2. Agent 核心大脑层                     |
|  +---------------------+        +------------------------+  |
|  |   Main Advisor      |        |   Log Summarizer       |  |
|  |   (ReAct Loop, LLM) | <----> |   (Sub-Agent 提取摘要) |  |
|  +---------------------+        +------------------------+  |
+-------------------------------------------------------------+
                           |
                           v (Tool Calling / MCP)
+-------------------------------------------------------------+
|                     3. 技能工具层 (Tools)                   |
|  [代码探索]   [日志排查]   [文档契约(MCP)]   [经验记忆] |
|   Zero-RAG    JSON grep    Apifox Client   JSON Store读写|
+-------------------------------------------------------------+
                           |
                           v (OS IO / Network)
+-------------------------------------------------------------+
|                     4. 物理数据与服务层                     |
|  /data/backend-repo     /data/logs      /data/knowledge     |
|   (本地源码)           (应用日志)       (JSON知识库)      |
|                                         [Apifox 云端]       |
+-------------------------------------------------------------+
```

### 2. 核心执行流程设计

#### 流程 A：多轮问答循环 (The Main ReAct Loop)
当用户发送 "这个 /api/order 接口报 500 是什么原因？" 后，后端的执行原理如下：
1. **API 层拦截**：FastAPI 接收请求，利用 SQLAlchemy 从 SQLite 中加载对应的 `SessionId` 历史对话记录。
2. **注入 System Prompt**：把角色设定（你是后端顾问）、工具列表和历史记录打包发给 LLM。
3. **推理与工具调度 (ReAct)**：LLM 思考后认为需要调用工具。返回一个 Function Calling 请求（例如：`call_tool: query_apifox, args: {"path": "/api/order"}`）。
4. **工具执行**：Agent 引擎在本地执行对 Apifox MCP 的查询，拿到接口定义。
5. **循环迭代**：将文档结果附加到上下文中再次请求 LLM，LLM 可能会决定继续调用 `CodeSearchTool` 去本地代码库里找 `OrderController` 的具体实现。
6. **终止与总结**：直到 LLM 收集了足够的信息，输出最终的人类语言回答，API 层将回答写入 SQLite 历史，并返回给客户端。

#### 流程 B：日志降噪子任务 (Sub-Agent Workflow)
当用户附带了 `TraceId: abc-123`：
1. 主 Agent 决定调用 `TraceLogAnalysisTool(trace_id="abc-123")`。
2. Tool 在底层执行 `grep '"traceId":"abc-123"' /logs/app.json.log`，瞬间拉出该请求的全部日志（包含超长的 Java Exception 堆栈 JSON）。
3. Tool **不将这段长日志直接返回主 Agent**。相反，Tool 会实例化一个新的 `pi-mono` Sub-Agent (即 `LogSummarizer`)，赋予它专属的 Prompt（“你是一个日志降噪专家，请剔除框架层堆栈，指出引发错误的最核心业务代码行”）。
4. Sub-Agent 处理完成返回 200 字左右的高密度摘要。
5. Tool 将这个 200 字摘要返回给主 Agent。主 Agent 的 Context 得到了保护，逻辑链得以清晰延续。

#### 流程 C：经验的自我学习与沉淀
当某次排查结束后（比如排查出了是遗留数据库字段问题）：
1. 客户端可以向 Agent 发送指令：“请把刚才踩的坑记录到知识库”。
2. 主 Agent 识别意图，主动调用 `WriteKnowledgeTool`。
3. Tool 利用 Pydantic 将 Agent 生成的散乱文本强制转化为预设的 JSON 结构（包含 tags, summary, solution）。
4. 将该 JSON 节点追加到本地的 `knowledge_store.json`。下次遇到相关 Controller 报错时，`ReadKnowledgeTool` 就能优先将其检索出来。

---

## 第三章：项目目录结构与文件说明

基于 `uv` 包管理和 `FastAPI + pi-mono` 风格的单体架构，项目结构遵循高度模块化、关注点分离的设计。

### 1. 目录结构树

```text
backend-advisor/
├── .venv/                         # uv 虚拟环境 (自动生成)
├── data/                          # 挂载或本地生成的数据目录
│   ├── sqlite/                    # 存放 SQLite 数据库文件 (sessions.db)
│   ├── knowledge/                 # 存放 JSON 共享知识库 (knowledge_store.json)
│   └── (repo/ & logs/)            # 源码和日志可通过软链接或配置路径映射到此
├── app/                           # 核心源码目录
│   ├── __init__.py
│   ├── main.py                    # FastAPI 核心入口，启动文件
│   ├── core/                      # 核心配置与基础架构
│   │   ├── config.py              # Pydantic BaseSettings (加载 .env 等配置)
│   │   ├── database.py            # SQLAlchemy 引擎、Session 管理初始化
│   │   ├── logger.py              # 本项目的日志输出配置 (非被分析的 Java 日志)
│   │   └── exceptions.py          # 全局异常定义
│   ├── models/                    # 数据库模型 (SQLAlchemy Models)
│   │   ├── session.py             # 对话 Session、历史消息记录的模型定义
│   ├── schemas/                   # Pydantic 校验模型 (API 进出参, LLM 结构化输出)
│   │   ├── api_schema.py          # REST/WebSocket API 请求与响应结构
│   │   └── llm_schema.py          # LLM 强制输出 JSON 时的约束模型
│   ├── api/                       # API 路由控制层 (Controllers)
│   │   ├── endpoints.py           # 定义 /chat, /history 等对外的端点
│   ├── agents/                    # Agent 大脑与执行引擎控制台
│   │   ├── engine.py              # 通用的 Agent 执行引擎 (ReAct Loop 控制, 管理 Token 窗口)
│   │   ├── prompts.py             # 存放主 Agent 和 Sub-Agent 的 System Prompts
│   │   ├── main_advisor.py        # 封装主 Agent 行为 (初始化、挂载 Tools、流转逻辑)
│   │   └── sub_summarizer.py      # 日志降噪 Sub-Agent 的专门实现
│   ├── tools/                     # 工具/技能的具体实现库 (Plugin Layer)
│   │   ├── base.py                # Tool 的抽象基类/装饰器定义
│   │   ├── search_code.py         # Zero-RAG 实现 (封装 grep, glob, read)
│   │   ├── trace_log.py           # 日志提取工具 (含 JSON 结构化日志的检索与调度 Sub-Agent 逻辑)
│   │   ├── apifox_mcp.py          # Apifox MCP Client 实现，负责与远端 MCP Server 握手和请求
│   │   └── knowledge_store.py     # 对 data/knowledge/*.json 的读写工具
│   └── utils/                     # 杂项工具函数
│       ├── file_io.py             # 安全的文件读写辅助函数
│       └── text_processor.py      # 文本截断、格式清理函数
├── pyproject.toml                 # uv 的项目依赖与元数据配置
├── .env.example                   # 环境变量示例文件 (API Keys, 路径配置等)
└── README.md                      # 项目启动与使用说明
```

### 2. 核心源代码文件作用描述

#### `app/main.py`
- **作用**：应用的生命周期管理。初始化 FastAPI 实例，挂载各种 Middleware（如 CORS）、配置路由挂载点（`app.include_router(api.endpoints)`），并在应用启动时初始化数据库连接和加载环境变量。

#### `app/core/database.py`
- **作用**：负责初始化 SQLite 数据库。定义 `engine` 和 `sessionmaker`。提供 `get_db()` 依赖注入函数，供 API 层调用以进行数据库操作（如持久化会话记录）。

#### `app/api/endpoints.py`
- **作用**：API 边界。接收前端的 HTTP/WebSocket 请求。提取参数并做 Pydantic 验证。从数据库拉取 Session 的上下文，将其传给 `app.agents.main_advisor` 执行。最后将大模型的回答存回数据库并返回给前端。

#### `app/agents/engine.py`
- **作用**：扮演类似 LangChain/pi-mono 底层的执行机。包含一个核心循环（While-Loop）：将历史消息发给大模型 -> 捕获大模型是否要求调用 Tool -> 根据 Tool Name 将执行路由到 `app/tools/` 对应的函数 -> 拿到工具结果后追加进 Context -> 再次请求大模型，直到模型给出最终文本（stop reasoning）。

#### `app/agents/prompts.py`
- **作用**：纯文本/模板管理文件。定义主 Agent（Backend Advisor）如何严格遵守不越界的原则，如何优先查找文档等策略；同时定义日志摘要 Sub-Agent 如何去芜存菁的规则。

#### `app/agents/sub_summarizer.py`
- **作用**：轻量级地实例化另一个无状态的 LLM 客户端配置。当它被调用时，它接收长堆栈文本，套用其专属 prompt，发出一次性大模型调用，并返回精简结果。

#### `app/tools/search_code.py`
- **作用**：封装底层的 OS 命令或 Python 标准库。对外暴露给 LLM 三个功能：`glob_files`（基于模式找文件）、`grep_code`（通过正则在项目中搜索类名/方法名，并带上行号返回）、`read_file_snippet`（根据文件路径和起止行号，精确返回一小段代码给 LLM 读）。

#### `app/tools/trace_log.py`
- **作用**：提供 `analyze_trace(trace_id)` 工具供 LLM 使用。内部逻辑为：通过文件 IO 去目标日志目录下执行类似于 `grep {trace_id} *.json.log` 的操作；将提取到的一堆 JSON 对象按时间序列合并；调用 `sub_summarizer.py` 对这段长文本执行降噪；最后返回摘要给引擎。

#### `app/tools/apifox_mcp.py`
- **作用**：标准的 MCP (Model Context Protocol) 客户端。建立与 Apifox 官方 MCP Server 的连接。暴露类似 `query_api_doc(path, method)` 的工具给大模型，底层将其转换为 MCP 标准的 `callTool` JSON-RPC 消息与远端通信。

#### `app/tools/knowledge_store.py`
- **作用**：轻量级的读写模块。`read_knowledge(keyword)` 会读取本地的 `knowledge_store.json` 文件并做简单的文本或 Tag 过滤；`write_knowledge(record_json)` 则能将 LLM 总结好的 Pydantic 结构直接序列化追加到文件中，保证跨会话的经验不丢失。