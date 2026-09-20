---
description: "计划卫生顾问守卫：在模型持续干活时提醒它更新任务清单，供选择、配置或调试该插件的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-stale-plan-reminder

[English](README.md) | 中文

## 概述

本包让 agent 的任务清单跟得上它已经完成的工作。清单是整值快照，因此模型写完一次计划后长时间执行时，已完成的工作会一直显示为未完成。在配置次数的工具调用没有写清单之后，本守卫会点出未完成项并要求发出完整的更新后清单。它从不阻塞调用，每个会话独立计数，重写清单或进入新的轮次都会重新计数。基础 bundle 已启用本包，在 10、25、60 次工具调用时提醒。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 agent 会围绕一份计划长时间执行、且这份计划应当跟得上工作时，挂载本插件。无需额外接线：`dsh` 基础 bundle 已经启用，默认值适用于多数会话——部署希望提醒更早、更晚或更短时，调整下面的节奏与摘录条数即可。

### 何时选用

当会话中的计划对用户可见、且应当跟随工作进展时选用：没有本守卫时，清单只在模型碰巧重写它时才前进，而已录制的会话中两次重写之间可能相隔数百次工具调用。当计划本身就是一段固定的开场陈述、或模型已有自己的清单维护节奏、或长时间执行中额外的提醒 token 比一份过期清单更昂贵时，不要选用。

### 设置节奏与摘录

```yaml
- name: '@deepseek-ai/dsh-stale-plan-reminder'
  config:
    thresholds: [10, 25, 60]   # completed tool calls since the last plan write
    previewItems: 5            # open items quoted in one reminder
```

| 字段 | 必填 | 含义 |
|---|---|---|
| `thresholds` | 是 | 清单上次变化后累计完成的工具调用数达到这些值时提醒；升序、不重复、整数且 >= 1 |
| `previewItems` | 是 | 一条提醒中摘录的未完成项数量；其余项合并为末尾计数 |

两个字段都是必填——提醒节奏与摘录长度都是没有普适正确值的部署选择。配置非法会在启动时以明确错误失败——空列表、小于 1 的计数、重复值、非正的摘录条数——绝不静默改变行为。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-stale-plan-reminder)记录了每个可接受取值。

### 你会得到什么

使用随包发布的配置时，模型连续十次工具调用没有动清单就会收到一条点名未完成项的提醒；若清单仍未变化，第 25 次和第 60 次会再次提醒，而重写清单会重新计数。会retire计划的 `turn/start` 同样会重新计数，因此新轮次不会继承过期计数。没有计划的会话、以及计划已全部完成的会话不会收到任何提醒。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明守卫如何计算过期程度并送达提醒，并指向实现它的代码；可观察行为已由[使用本包](#use-this-package)完整覆盖。

### 设计理念

守卫建立在四项承诺之上：

- **顾问，而非否决。** 守卫只向 post-execute 决策附加模型上下文；它从不阻塞或改写调用，因此 `PostToolDecision` 的阻塞仍由后续监听者负责。
- **唯一权威的清单。** 清单读自 `todos` 会话投影——也就是面板渲染的同一个值——因此守卫不持有第二份副本，也不会与界面不一致。
- **在 post-execute 计数。** 检测运行在 `tools/post-execute` 上，它覆盖每一次尝试（含被拒绝的调用）且无需跨事件记账；`exec.agent` 指出拥有该计划的会话。
- **加载即失败。** `thresholds` 与 `previewItems` 在 `apply` 中校验并抛错，绝不回退到默认值。

### 检测：距上次写清单的工具调用数

每个会话的进度保存在 `WeakMap<Session, Progress>` 中，记录它计数所依据的清单值以及此后完成的工具调用数。清单值按引用比较：投影在每次 `todo/write` 时发布新数组、在 `turn/start` 时发布 `null`，因此引用变化恰好等于“模型发布了新清单”，计数随之归零。

- **缺失 `todos` 单元即能力缺失。** 未挂载 `tool-todo` 的 preset 不会注册该投影；`stateOf` 返回 `undefined`，守卫保持静默——没有清单需要维护。
- **已全部完成的清单保持静默。** 提醒的目的是收敛未完成项；没有未完成项的计划无论执行多久都不会触发。
- **没有 agent 的调用被忽略。** 直接调用 `ctx.tools.execute()` 的调用方没有需要提醒的模型，也没有可挂靠的会话。
- **按会话、仅内存。** 一个会话的计数不会影响另一个，恢复的会话从零开始——守卫是启发式提示，不是被记录的不变量。

### 提醒送达

提醒搭载在 post-execute 决策的 `additionalContexts` 上（来源为 `{kind: 'plugin', plugin: 'stale-plan-reminder', form: 'notice', summary: '<未完成数> unfinished × <调用数> tool calls'}`），而绝不替换 `content`：`tool/result` 事件始终保留工具自身的输出以便审计。循环缓冲该上下文，并在该步的工具结果之后以注入的 `user/message` 追加——对模型可见、带来源标注、可由会话日志重建，且不需要新的会话事件。守卫始终通过 `next()` 委派，并把自身提醒前置到下游决策的上下文数组，因此两种决策分支（包括被阻塞的调用）都能拿到提醒，而每个条目都保留各自的来源与元数据。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` 模式、失败即抛的校验、按会话的进度表及其 post-execute 监听器 |
| — | 不发布运行时 invariant 伴随包；进度表是一个 post-execute 监听器的私有状态，不暴露任何可供独立伴随包观察的包所有权事件或快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不足时阅读这些页面。它们从工具瀑布依次通向守卫读取的投影与守卫分组地图。

- [工具子系统参考](../../../docs/subsystems/tools.zh.md) —— 守卫消费的 `tools/post-execute` 瀑布、`additionalContexts` 与决策形态。
- [会话投影参考](../../../docs/subsystems/session-projection.zh.md) —— `todos` 背后的整值折叠与读取面。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-stale-plan-reminder) —— 每个可接受的配置字段及其来源声明。
- [guard 分组地图](../README.zh.md) —— 同族守卫包与循环卫生家族。

-----

<a id="model-experience"></a>
## 模型体验

### 计划过期上下文消息

#### 模型看到什么

在每个配置的阈值上，所属 agent 收到下面的提醒。它只在计划存在未完成项时出现；不新增任何工具 schema 或普通调用文本。提醒中 `(in progress) ` 标记已报告为进行中的项，`- …and <omitted> more` 仅在超出 `previewItems` 时出现，每个条目行在 80 个字符处截断。

##### 计划过期提醒

```markdown
Your to-do list has not been updated for <toolCalls> tool calls and still shows <unfinished> unfinished item(s):
- (in progress) <item>
- <item>
- …and <omitted> more
If any of them is finished, send the COMPLETE updated list with todo_write now: mark finished items completed as they finish (do not batch completions), and keep the items you are actively working on marked in_progress.
```

#### Token 影响

首个阈值之前为零 token。每条提醒都会成为该会话的保留历史，其规模由 `previewItems` 与条目行上限约束；各 agent 的计数相互独立。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使既有 KV cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了守卫不适用的场景。它们是当前的包约束，不是任务待办。

- **超过最大阈值后不再提醒** —— 寿命超过 `thresholds` 的执行在模型重写清单或配置新增计数之前不会再有提示。
- **它只能检查记账，不能检查工作** —— 守卫从不自行把项标记为完成；它只是请求模型，模型仍可能拒绝或合并处理。
- **内容相同但重写过的计划同样会重新计数** —— 守卫检测的是“发布”（新的投影引用），而不是内容是否变化。
- **压缩不会重置计数** —— 跨越压缩检查点的计数会继续累加。
- **仅顾问性质** —— 尚未实现高阈值时升级为阻塞形态，尽管 `PostToolDecision` 已支持阻塞。
- **子 agent 的计划各自提醒自己的 agent** —— 计划按会话隔离，父会话的过期清单不会提醒子会话。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：尚未决定的问题与方向。它明确非权威——已发布行为、限制与已接受的取舍以上文各节和包代码为准。

待决问题：超过最大阈值后持续提醒，带来的收益是否值得它在保留上下文中付出的代价；以及提醒是否应同时给出经过的墙钟时间。

</details>
