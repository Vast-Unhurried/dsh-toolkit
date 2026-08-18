# Changelog

## [0.2.3] - 2026-08-18

- 安全加固：API 路由同源检查要求 Host 头为回环地址且 Origin 与 Host 精确一致（防 DNS rebinding 与任意本地端口页面）。
- 兼容：路由级默认档位（`reasoning: max`）不再强加给 `reasoningEfforts: false` 的模型（grok 等可与五档模型同路由，请求不带档位参数）。

## [0.2.2] - 2026-08-16

- 修复：`ensureAllDeclared` 对模型级 `reasoningEfforts` 缺失时的写入路径（modelOverrides 分支）。
- 修复：`setReasoning` 在自动声明后重新读取模型信息再校验。

## [0.2.0] - 2026-08-15

- 首版：五档推理等级声明 + 官方选择器呈现 + 诊断 API（getSessionModel / setReasoning / setModel）。
