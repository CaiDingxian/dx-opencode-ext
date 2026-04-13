# 轻量级后端代码顾问 Agent 设计大纲

## 1. 项目目标

构建一个面向 **Java + Spring Boot** 代码库的轻量级后端顾问 Agent。

第一原则不是“做全”，而是 **短期内快速上线并在团队内部可用**。

它的主要职责：

- 扫描并阅读代码库、技术文档、Apifox 接口文档、运行日志
- 理解后端 API 的业务语义、调用链路、异常处理和配置约束
- 通过一个可编程的咨询 API 向前端 Agent 提供“后端知识咨询能力”
- 支持有状态对话，前端 Agent 可通过 `sessionId` 持续追问

核心价值：帮助前端 Agent 更准确理解后端接口逻辑、异常场景、鉴权方式、字段约束与联调风险，从而更可靠地编写前端对接代码。

当前约束：

- 只面向团队内部使用
- 不部署公网
- 不追求高并发
- 优先快速落地，其次再考虑平台化演进

---

## 2. 目标用户与典型场景

### 2.1 目标用户

- 前端智能Coding Agent（主要）
- 前端开发者
- 帮助前端开发者进行联调的后端开发者

### 2.2 典型咨询场景

- “这个接口真实的请求参数和返回结构是什么？”
- “这几个字段是什么含义，应该怎么填？我在代码中这样调用[附前端代码片段]，为什么返回空值”
- “这个接口报错 `403/409/500` 是什么原因触发的？”
- “前端提交订单后，后端后续会调用哪些服务或写入哪些表？”
- “我按接口文档调用这个接口，为什么报找不到数据？要怎么对接？”
- “如果我想完成这个需求[附需求文档内容]，流程如何？要调用哪些接口来完成？”

---

## 3. 非目标

现阶段 **不做**：

- 直接修改 Java 代码
- 代替 IDE 做完整代码补全
- 自动修复线上问题
- 深度 APM/链路追踪平台替代品
- 大而全的企业知识平台

补充说明：这个项目的核心是“咨询与解释”，**修改代码不是必要能力**。

这样可以保证方案轻量、聚焦、可快速落地。

---

## 4. 核心能力范围

### 4.1 输入范围

- Java / Spring Boot 源码
- `application.yml` / `application-*.yml` / `bootstrap.yml`
- Apifox 平台中的接口文档 / 导出文档
- README、设计文档、接口文档
- 运行日志、异常堆栈、告警片段

### 4.2 输出能力

- API 行为解释
- 字段来源与约束分析
- 错误码 / 异常来源排查
- 调用链与业务流程概述
- 配置项影响说明
- “证据化回答”：回答中引用具体文件、类、方法、日志片段、文档位置

### 4.3 回答要求

- 尽量给出证据引用
- 区分“确定信息”与“推测信息”
- 优先回答“前端如何正确对接”
- 在信息不足时指出还需要哪些代码/日志/配置
- 默认短回答，减少前端理解负担并提高响应速度
- 证据引用粒度应可由请求参数控制

---

## 5. 建议的总体架构

建议采用 **“成熟 Agent 基座 (pi-mono) + 领域专属 Tools + MCP 协议”** 的插件化架构。将复杂的对话管理与多轮编排交给成熟框架，我们仅需专注于后端领域知识的检索工具开发和协议对接。

### 5.1 模块划分

1. **Agent 基座 (pi-mono)**
   - 提供开箱即用的能力：多轮 Tool Calling 机制、多 LLM 路由适配、会话管理 (Session)、HTTP API 暴露。
   - 挂载 `BackendAdvisorAgent` 角色设定与系统提示词。
   - 天然支持高并发的文件读写与原生检索能力。
   - **支持编程式的子 Agent (Sub-Agent) 任务分发与聚合调度**。

2. **核心业务 Tools (Plugin/Skill Layer)**
   - Agent 的“手和眼”，由基座按需自主规划调用：
   - `CodeSearchTool`: 基于基座原生 glob/grep 的动态代码检索工具（MVP 阶段）或调用 Bloop API（演进阶段）。
   - `TraceLogAnalysisTool`: 基于 JSON 结构化日志的追溯与提取工具。
   - `KnowledgeStoreTool`: 面向 JSON 结构化纯文本共享经验库的精确读写工具。

3. **MCP Client (标准化模型上下文协议)**
   - **Apifox MCP 接入**：基座 `pi-mono` 实现 MCP 客户端，直接连接 Apifox 官方提供的 MCP Server，零代码实现接口文档的查询与阅读。

4. **Knowledge Store (轻量化知识库)**
   - 抛弃复杂的离线向量构建管道。
   - 共享知识以**纯文本 JSON 文件**的形态存在，直接由 Agent 读写。
   - 代码本身即为最实时的知识库实体。

---

## 6. 推荐技术方案

### 6.1 核心选型

- **Agent 框架 / 基座**：**`pi-mono`**。提供多轮工具调用、会话管理和基于 OS 层面的原生检索能力。
- **共享知识存储**：采用扁平结构的 JSON 文件 (`knowledge_store.json`)，支持按结构化标签/路由匹配。
- **外部文档源**：**Apifox 官方 MCP Server**。通过标准化协议对接，极大降低开发维护成本。

### 6.2 渐进式的代码检索方案（关键设计）

为了兼顾“极速上线”与“强大的语义理解”，我们对代码检索采用**两阶段演进路线**：

#### 阶段一（MVP）：Zero-RAG 纯动态检索流
- 彻底抛弃传统的切块、向量化和 LlamaIndex。
- **技术实现**：直接复用 `pi-mono` 框架内置的 `glob` (文件模式查找)、`grep` (底层 ripgrep 正则搜索) 和 `read` (带行号控制的文件读取) 工具。
- **业务流程**：Agent 接收问题后，根据提示词自己编写 grep 正则（例如搜 `@RestController` 或特定报错类），直接去本地代码目录进行秒级查找并阅读上下文。
- **优势**：0 成本，0 离线管道维护，保证 100% 代码时效性。

#### 阶段二（演进期）：引入 Bloop 语义级代码搜索引擎
- 如果单靠原生正则搜索无法满足复杂的业务语义提问（如“用户注销流程在哪”）。
- **技术实现**：在局域网内部署开源的 **Bloop (bloop.ai)** 容器服务。
- **Bloop 优势**：无需 GPU，纯 CPU (ONNX) 运行；自带专为代码微调的 Embedding 模型；自带 AST 语法树解析。
- **结合方式**：编写一个 `BloopSearchTool` 注册到基座中，Agent 可通过 REST API 调用 Bloop 进行带有深刻上下文的混合检索。

---

## 7. 数据流设计

### 7.1 在线咨询阶段 (基座接管)

1. 前端 Agent 发起问题，调用基座 API，携带 `sessionId`
2. `pi-mono` 基座接收请求，加载对话上下文并交给 LLM
3. LLM 根据角色设定决定调用哪个 Tool / MCP：
   - 找代码：调用 `grep/glob` (阶段一) 或 `Bloop API` (阶段二)
   - 查文档：调用 **Apifox MCP Server** 暴露的工具
   - 查经验：调用 `KnowledgeStoreTool` 读取 JSON 历史避坑记录
   - 查日志：调用 `TraceLogAnalysisTool` 提取错误信息
4. Tools / MCP Server 执行检索并返回代码片段或纯文本给 LLM
5. LLM 综合证据生成最终回答
6. 沉淀经验：如果 Agent 成功解答了一个复杂联调问题，可调用 `KnowledgeStoreTool.write` 追加到 JSON 文件中。

---

## 8. 共享知识库 (Shared Knowledge Store) 设计

### 8.1 为什么采用 JSON 结构
- 能够通过精确匹配 `keywords` 或 API `path` 避免上下文污染。
- 不需要复杂的向量数据库，直接用代码逻辑实现超轻量检索。
- 方便 Agent 通过 Function Calling 直接返回 JSON 结构完成自我学习与追加。

### 8.2 JSON 数据结构建议
系统在本地维护一个或多个 JSON 文件（如 `knowledge_store.json`）：
```json
{
  "troubleshooting": [
    {
      "id": "ERR_001",
      "keywords": ["OrderService", "NullPointerException", "订单创建"],
      "summary": "创建订单时如果未传 addressId 会报空指针...",
      "solution": "前端提交订单前先拦截校验 addressId...",
      "createdAt": "2023-10-27"
    }
  ],
  "api_contracts": [
    {
      "path": "/api/v1/user/info",
      "note": "这个接口的 status 字段实际返回的是位掩码 (bitmask)..."
    }
  ]
}
```

### 8.3 工具侧能力 (KnowledgeStoreTool)
- **`ReadKnowledgeTool`**：接收 `category` (如 api/error) 和 `keywords`，在后端执行简单的 JSON 对象过滤，只将匹配的记录返回给大模型。
- **`WriteKnowledgeTool`**：允许 Agent 主动写入新的经验条目，实现跨会话的持续学习。

---

## 9. 检索与理解策略 (MVP 阶段)

在没有外部向量库的情况下，依赖大模型的极强推理能力执行拟人化的定向查阅：

1. **入口定位**：通过 `grep` 搜索 URL 路径、注解或日志关键字。
2. **结构阅读**：通过 `read` 查看该 Controller 的导入依赖。
3. **深入追溯**：再次 `grep` 或 `read` 具体的 Service 和 Repository 层。
4. **对比验证**：配合 Apifox MCP 数据进行出入参的一致性核对。

---

## 10. Spring Boot 场景下建议重点关注的特征

Agent 在编写 `grep` 正则或搜索条件时，应被系统提示词重点指导关注以下对象：
- `@RestController` / `@Controller` / `@RequestMapping`
- `@Service` / `@Repository` / `@FeignClient`
- 全局异常处理 `@ControllerAdvice`
- 配置文件映射 `@ConfigurationProperties` / `@Value`
- 参数校验注解：`@Valid`、`@NotNull` 等

---

## 11. 日志理解能力设计：结构化与 Sub-Agent 降噪

这是本项目在日志处理上的核心创新架构，完美解决多行堆栈断层与主 Agent Token 溢出的痛点。

### 11.1 前置要求：后端日志输出 JSON 化 (最佳实践)
- **改造前提**：不再使用易断层的普通文本日志，而是修改 Spring Boot (`logback-spring.xml` / Log4j2) 配置，引入如 `logstash-logback-encoder` 等依赖。
- **输出形态**：每条日志（包含异常堆栈）打印为**完整单行 JSON**：
  ```json
  {"@timestamp":"2023-10-27T10:00:00", "level":"ERROR", "traceId":"abc-123", "stack_trace":"java.lang.NullPointerException\n\tat com.xyz.OrderController..."}
  ```
- **架构红利**：将极其复杂的“多行状态机匹配算法”降维打击成了最简单的单行 `grep`！

### 11.2 日志提取策略 (TraceLogAnalysisTool)
1. 接受前端提供的 `TraceId`。
2. Tool 内部直接利用底层 `grep` (如 `grep '"traceId":"abc-123"' /logs/app.json.log`) 秒级抽取出该请求的全部关联日志。
3. 对抽出来的 JSON 行执行 `json.loads` 解析，提取出异常堆栈文本。

### 11.3 主子 Agent 压缩策略 (Log Compression)
在 `pi-mono` 基座中通过编程式方式派生 **Sub-Agent**：
1. **分发**：Tool 内部实例化一个专门负责清洗日志的 **LogAnalyzer Sub-Agent**。
2. **降噪执行**：将从 JSON 中提取出的超长 `stack_trace` 文本 + 当前业务包名交由子 Agent 分析。由子 Agent 剔除无关的 Tomcat/Spring 底层代理反射链，提炼出核心报错类型、报错文件、行号以及直接相关的代码调用链。
3. **聚合**：子 Agent 将降噪后的微型摘要返回给 Tool，最终供主 Agent 吸收，主 Agent 借此去阅读对应源码文件并得出结论。

---

## 12. 回答质量控制

通过调整 Agent 的 System Prompt 强制约束输出格式，建议每次回答都附带：
1. 结论（短、直接、面向前端可执行）
2. 后端证据依据 (引用具体文件路径和行号)
3. 前端接入建议
4. 明确指出是否存在接口文档与实际代码不一致的情况

---

## 13. 安全与边界

- 工具默认只读，不允许修改仓库业务代码（仅允许修改 JSON 共享知识库文件）。
- 对敏感配置做脱敏（密钥、密码、token）。

---

## 14. 第一阶段最小可行版本（MVP）

### 14.1 MVP 核心能力清单

1. **基座打通**：使用 `pi-mono` 跑通基础对话与 Session 流。
2. **Zero-RAG 检索**：直接挂载框架原生的 `grep`、`glob`、`read` 工具。
3. **经验沉淀**：确立本地 JSON 文件作为高频避坑指南的读写机制，开发配套 Tool。
4. **Apifox MCP 接入**：让 `pi-mono` 支持 MCP 客户端，对接 Apifox 官方 MCP，替代手写 API 工具。
5. **日志提取与压缩**：推动后端改造 JSON 日志输出，利用 `pi-mono` 编程式初始化 Sub-Agent 完成报错日志的降噪。

### 14.2 暂缓功能（演进期再做）

- Bloop 本地代码搜索引擎的部署与接入
- 复杂的日志聚合与告警分析
- 图数据库存储

---

## 15. 索引 / 文档 / 代码一致性设计

### 15.1 一致性原则
- **代码是最终真相来源**
- **Apifox 是外部接口说明来源**
- **共享知识记忆是二级结论层，不可覆盖源码事实**

### 15.2 回答时的冲突处理（System Prompt 级约束）
当代码、Apifox、知识笔记发生冲突时，Agent 必须：
1. 优先以代码行为为准。
2. 明确指出 Apifox 是否存在滞后。
3. 提示“代码与文档不一致”，并提供依据供开发人员确认。