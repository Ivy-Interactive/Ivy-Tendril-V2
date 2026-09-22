---
title: verification
description: 管理保存在 config.yaml 中的全局验证定义。这些定义可被项目和计划引用。
icon: ClipboardCheck
searchHints:
  - verification
  - verify
  - check
  - prompt
  - definition
  - gates
---

# verification

管理保存在 `config.yaml` 中的全局验证定义。验证门禁定义了自动化代码质量、构建和测试检查，编程智能体必须通过这些检查后，[计划](01_Plan.md) 才能流转至 `Completed` 状态。这些检查通过 [`tendril project add-verification`](02_Project.md#verifications) 分配给对应项目。

## Commands

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — 显示所有已注册的全局验证。传入 `--json` 可输出为结构化 JSON。
- **get** — 将验证的名称和完整的评估提示词文本打印到标准输出。
- **add** — 注册新的验证检查，可附带可选的提示词说明。
- **set** — 更新验证定义的提示词或对其重命名。重命名验证会自动更新所有项目引用、计划 YAML 记录和数据库行。
- **remove** — 删除验证定义。若任何活跃项目正在引用该检查，除非提供 `--force`（或 `-f`），否则 Tendril 会拒绝删除；若提供了 `--force`，则会一并清理跨所有项目的引用。

## Examples

```terminal
># 添加带有提示词指令的新验证门禁
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># 检查完整的提示词详情
>tendril verification get CargoTest

># 更新评估提示词
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># 跨项目和计划重命名验证定义
>tendril verification set CargoTest --new-name RustWorkspaceTests

># 以 JSON 格式列出所有定义
>tendril verification list --json

># 删除验证，清理项目引用
>tendril verification remove RustWorkspaceTests --force
```

## Related

- [项目验证](02_Project.md#verifications) — 配置项目所需的检查项
- [计划验证](01_Plan.md#verifications) — 检查或覆盖计划上的验证门禁状态
- [配置参考](../../03_Configuration/01_Setup.md) — 管理 `config.yaml` 中的全局配置
