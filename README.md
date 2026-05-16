# dx-opencode-ext

`dx-opencode-ext` 目前包含两个opencode插件：

- `kimi-keep-thinking`：由于kimi k2.6虽然默认开启深度思考，但默认关闭了思维链保留机制，导致k2.6模型的能力没有完全发挥。尤其非官方版的 Kimi K2.6（例如 opencode go，或国内各类 coding plan 中的 Kimi 开源版）难以还原keep能力，此插件补回官方版的 thinking keep / 思维链保留机制，尽可能释放 K2.6 的完整能力。
- `context-zip`：在 OpenCode 中复刻 Codex 内置的上下文压缩能力，替换opencode默认压缩机制。建议在 OpenCode 中把 compression agent 配置为 GPT-5.x 系列模型，以获得最佳效果。

## 目录结构

```text
.
├── LICENSE
├── README.md
└── plugins
    ├── context-zip.ts
    └── kimi-keep-thinking.ts
```

## 插件说明

### `plugins/kimi-keep-thinking.ts`

这个插件面向不支持官方 reasoning / thinking keep 参数透传的 Kimi K2.6 接入方式。

它会在目标模型会话中尽量保留原本会在官方链路里保存下来的思维过程，减少能力损失。


### `plugins/context-zip.ts`

这个插件接管 OpenCode 的实验性会话压缩流程，在触发 compacting 时清空默认上下文，并注入一段更偏向任务交接摘要的压缩提示词。

它的目标是把上下文压缩结果变成类似 Codex 的 handoff summary，帮助后续模型更顺畅地续写任务；如果将 OpenCode 的 compression agent 配置为 GPT-5.x 系列模型，通常可以获得更好的压缩质量。
