# dx-opencode-ext

这个仓库用于存放自定义的 OpenCode 插件扩展，目前主要包含两个 TypeScript 插件文件。

## 目录结构

```text
.
├── LICENSE
├── README.md
└── plugins
    ├── context-zip.ts
    └── kimi-keep-thinking.ts
```

- `LICENSE`：仓库许可证文件。
- `README.md`：仓库说明文档。
- `plugins/`：插件目录，存放可直接集成的 OpenCode 插件实现。

## 插件说明

### `plugins/context-zip.ts`

`CompactionPlugin` 用于在会话压缩（compacting）阶段生成交接摘要：

- 在触发 `experimental.session.compacting` 时注入固定提示词；
- 引导模型输出当前进度、约束条件和后续步骤；
- 清空上下文并在后续系统提示转换时移除临时系统信息。

适合用于长会话续接、上下文压缩和任务交接场景。

### `plugins/kimi-keep-thinking.ts`

`KeepKimiThinkingPlugin` 用于兼容特定 Kimi 模型的“思考内容”保留问题：

- 记录会话所使用的目标模型；
- 在消息转换阶段提取 assistant 的 reasoning 内容；
- 将 reasoning 折叠为 `<commentary>...</commentary>` 文本并合并进正文；
- 避免不支持保留思考参数的供应商丢失思考过程。

适合在使用 `opencode-go-diy/kimi-k2.6` 和 `opencode-go/kimi-k2.6` 时保留历史思考信息。
