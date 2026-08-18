# dsh-reasoning-levels — 第三方模型推理等级插件

为 DeepSeek Harness 提供**第三方模型**的推理等级（reasoning effort）。

- 纯服务端插件，无自定义 UI：推理等级完全由**官方模型选择器**呈现。
- 官方模型（`deepseek-official`）保持官方三档（Off / High / Max），插件不介入。
- 第三方模型（pi-ai 供应商，如 Soullens）在官方模型选择器中显示五档：**low / medium / high / xhigh / max**。
- **支持五档的模型默认档位为 MAX**（选中即高亮 Max，未手动选择时请求按 Max 发送）。
- **不支持的模型默认供应商档位**（如 grok：不发送任何档位参数，等同供应商默认行为，也不显示推理等级）。

## 工作原理

Harness 核心只在模型适配器声明了 `reasoning.efforts` 时才提供推理等级 UI，并拒绝为未声明的模型应用任意档位（`UNSUPPORTED_REASONING_EFFORT`）。本插件在启动时自动补上声明：

1. **启动自动声明**（`ensureAllDeclared`，幂等）：遍历 `llm-pi-ai.providers`，为所有未声明 `reasoningEfforts` 的模型写入五档声明（`low…max` 同名字符串映射）；`reasoningEfforts: false` 的模型（用户主动退出，如 grok）与已有自定义声明的模型原样保留；`openai-completions` 路由缺 `compat.supportsReasoningEffort` 时补上。全部模型都退出的路由（如纯 grok 路由）整条跳过。
2. **默认档位**：`reasoning: max` 写在五档模型所在路由上，官方选择器即默认选中 Max（且不再显示 "Default" 行）。
3. **不支持的模型**：可以放在**独立路由**（如 `soullens-grok`）且不带 `reasoning` 默认——这样它既不显示档位，请求也保持供应商默认；也可以与五档模型**同路由**（插件已保证路由级默认档不会强加给 `reasoningEfforts: false` 的模型）。

## 安装

```bash
dsh plugin --profile web add file:./packages/dsh-reasoning-levels
```

重启 web 服务（`dsh web`）后刷新页面即可。

## 配置示例

```yaml
llm-pi-ai:
  providers:
    soullens:
      displayName: Soullens
      apiKeyEnv: SOULLENS_API_KEY
      api: openai-completions
      baseURL: https://soullens.org/v1
      reasoning: max            # 五档模型的默认档位
      models:
        - id: deepseek-v4-flash-0731
          reasoningEfforts:     # 启动时自动写入（也可手写并自定义映射）
            low: low
            medium: medium
            high: high
            xhigh: xhigh
            max: max
        - id: grok-4.6
          reasoningEfforts: false   # 退出：不显示推理等级、保持供应商默认
```

## 档位与 wire 值

| 档位 | 发送的参数 |
| --- | --- |
| low | `reasoning_effort: "low"` |
| medium | `reasoning_effort: "medium"` |
| high | `reasoning_effort: "high"` |
| xhigh | `reasoning_effort: "xhigh"` |
| max | `reasoning_effort: "max"` |

> 部分供应商不接受全部档位值（如 DeepSeek 兼容接口只认 `high` / `max`）。可在该模型的 `reasoningEfforts` 中调整 wire 映射，例如把 `xhigh` 也映射成 `"high"`。

## 自定义

- 已有的 `reasoningEfforts` 自定义映射不会被覆盖（残留的 `off` 条目会被清理）。
- 想要某个模型不参与推理等级：在该模型上写 `reasoningEfforts: false`。
- 官方路由永不触碰。

## 卸载

```bash
dsh plugin --profile web remove dsh-reasoning-levels
```

然后按需清理 `~/.dsh/settings.yaml` 中 `llm-pi-ai` 下插件写入的 `reasoningEfforts`、`reasoning`、`compat.supportsReasoningEffort` 字段。
