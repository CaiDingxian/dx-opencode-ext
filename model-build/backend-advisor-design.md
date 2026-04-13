# 轻量级后端代码顾问 Agent (Backend Advisor) 最终方案设计大纲

> **文档说明**：本文档为本项目最终定版的权威大纲。所有前期讨论的废案（如传统离线 LlamaIndex RAG、重型图数据库、复杂的 Python 多行日志正则提取状态机等）均已剔除。后续所有的编码与开发均应以此文档中描述的核心思想和技术栈为准。

---

## 1. 项目愿景与定位

构建一个面向 **Java + Spring Boot** 代码库的轻量级后端顾问 Agent。
其核心定位是一个**极速落地、低运维成本、专注于前端联调咨询的“知识外挂”**。

它不代替 IDE 写代码，不处理线上生产事故。它的唯一职责是：通过动态查阅后端最新的源码、提取 JSON 结构化日志、对接 Apifox 文档以及翻阅历史经验库，用人类自然语言准确地回答前端在联调时遇到的诸如“这个字段什么意思”、“为什么报 500”、“我这行前端代码哪里传错了”等问题。

### 1.1 核心约束与要求
- **不使用离线向量库 (No RAG)**：抛弃所有需要定时/触发式全量切块的重型向量引擎。
- **配置优于代码**：尽可能复用强大的底层系统工具和标准协议。
- **保护上下文窗口**：极其克制地使用 Token，避免由于 Java 异常堆栈过长导致主模型失忆。

---

## 2. 最终技术选型与架构 (The "How" & "Why")

我们采用基于 Python 的单体服务架构，结合 **"Zero-RAG 原生检索" + "MCP 标准协议" + "Sub-Agent 降噪"** 三大创新设计。

### 2.1 基础设施层
- **语言与依赖管理**：`Python 3.11+` + `uv` + `venv`（最现代、极速的 Python 包管理）。
- **API 框架**：`FastAPI` + `Pydantic`（提供类型安全的 RESTful/WebSocket 接口供前端调用）。
- **持久化层**：`SQLite` + `SQLAlchemy`（仅用于存储历史会话记录 Session，零部署负担）。
- **Agent 执行基座**：采用类似 `pi-mono` 的单体 Agent 架构思想，实现多轮 Tool Calling (ReAct Loop) 和上下文编排。

### 2.2 核心 Tool / 技能层

此层包含了赋予 Agent "眼和手" 的四大核心能力，每个工具的设计都力求最简与最高效。

#### 核心一：CodeSearchTool (Zero-RAG 动态代码检索)
- **是什么**：摒弃传统离线切块与 Chroma 向量库。直接向 LLM 暴露封装好的底层系统工具。
- **怎么做**：
  1. `glob`：快速按模式查找目标文件。
  2. `grep`：底层基于 `ripgrep`，执行极速全文正则匹配（如查找 `@RestController`）。
  3. `read`：带 `limit` 和 `offset` 的精确代码片段读取。
- **为什么**：保证大模型每次看到的都是当前硬盘上 100% 最新鲜、准确的源码，彻底消灭向量引擎可能出现的“幻觉”和“索引滞后”。

#### 核心二：ApifoxMCP (标准化接口文档查询)
- **是什么**：抛弃手写抓取 Apifox / Swagger 的 API 请求。
- **怎么做**：让我们的 Python 服务实现 **MCP (Model Context Protocol) Client** 协议，直接连接 Apifox 官方提供的 MCP Server。
- **为什么**：零维护成本。Apifox 怎么变，我们都不需要改代码，Agent 天然就能理解并调用对方暴露的接口文档检索工具。

#### 核心三：TraceLogAnalysisTool (JSON grep + Sub-Agent 日志降噪)
- **是什么**：排查 `TraceId`，从海量日志中找到具体的异常并转化为前端能看懂的话。
- **怎么做**：
  1. **前置架构规范**：推动 Java 侧修改 Logback 配置，输出单行 JSON 格式日志（天然解决 Java 多行堆栈提取难的问题）。
  2. **提取**：Tool 拿到前端传来的 TraceId，只需执行简单的 `grep 'traceId:xxx' app.json.log`，提取出包含 `stack_trace` 的大段 JSON 文本。
  3. **压缩 (Sub-Agent)**：如果直接把这段 JSON 喂给主 Agent，Token 会撑爆。Tool 会拉起一个专门的 **Log Summarizer Sub-Agent**，赋予它降噪 Prompt（“剔除 Spring 反射堆栈，找出业务报错行”），将上万字的日志压缩成 200 字摘要。
  4. **返回**：主 Agent 拿到这 200 字摘要，指导 `CodeSearchTool` 去看对应的报错代码。
- **为什么**：完美兼顾了提取的稳定性和模型推理的质量。

#### 核心四：KnowledgeStoreTool (基于 JSON 的共享经验沉淀)
- **是什么**：跨会话的记忆库，记录那些“文档和代码不一致”的历史巨坑。
- **怎么做**：本地维护一个 `knowledge_store.json` 文件。
  - `read_knowledge`：Agent 通过关键字检索该 JSON。
  - `write_knowledge`：当 Agent 成功解决疑难杂症，主动调用该方法，将标准的 Pydantic 结构化结论（如触发原因、前端应对方案）追加到 JSON 库中。
- **为什么**：结构化、简单、精准，不需要专门搭建图数据库或向量库，文件本身就是极佳的长期存储。

---

## 3. 系统核心数据流与执行过程

假设前端发来提问：*“/api/v1/order 接口一直报 500，这是我的 TraceId: abc-123”*

1. **API 层拦截**：FastAPI 接受请求，SQLAlchemy 获取该用户此前的 Session 对话上下文。
2. **ReAct 引擎启动**：将 System Prompt 和当前问题发给主 LLM（如 Claude 3.5 / 阿里通义千问）。
3. **查文档 (可选)**：LLM 可能先调用 `ApifoxMCP` 客户端工具，查询 `/api/v1/order` 的常规定义。
4. **查日志**：LLM 决定调用 `TraceLogAnalysisTool(trace_id="abc-123")`。
5. **子 Agent 压缩**：Tool 从 JSON 日志文件中把包含超长堆栈的一行扒出来，派发给内部初始化的 Sub-Agent 进行降噪。Sub-Agent 返回：“是在 OrderService.java 第 45 行发生了 NullPointerException，因为 addressId 为空”。
6. **看源码**：主 LLM 拿到摘要，决定调用 `CodeSearchTool` 的 `read` 方法，精准读取 `OrderService.java` 的第 40-50 行。
7. **出结论**：LLM 发现代码逻辑确实强制要求了 addressId。它可能会对比 Apifox 文档，并综合以上所有证据。
8. **返回用户**：生成最终回答：“根据 TraceId，报错原因是... 代码中强制要求了... 建议前端在提交前补充校验...”。同时，这个结论可能会被 LLM 用 `KnowledgeStoreTool` 写进本地知识库。
9. **持久化**：FastAPI 将这次问答录入 SQLite。

---

## 4. 第一阶段 (MVP) 实施边界

为了确保快速上线，MVP 阶段**必须完成**：
- uv + FastAPI 的基础脚手架及 SQLite 会话管理。
- CodeSearchTool 中基于原生 `grep/glob` 的 Zero-RAG 功能。
- 确立基于 JSON 日志的提取逻辑，及 Sub-Agent 降噪跑通。
- 扁平化的 JSON 经验知识库读写机制。

MVP 阶段**暂不考虑**：
- Bloop.ai 语义搜索引擎的部署（作为后期的搜索增强演进）。
- 实时日志流的长连接监控。
- 复杂的鉴权体系与多租户权限隔离（优先供内部团队单实例使用）。