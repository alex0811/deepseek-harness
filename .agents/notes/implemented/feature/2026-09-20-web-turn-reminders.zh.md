# Agent Note: Web 轮次提醒

Status: implemented

[English](2026-09-20-web-turn-reminders.md) | 中文

## 问题

一个运行数分钟的 Web 会话结束时，用户没有任何信号。工作区浏览器的绿点已经标记了「不是主视图时停止」的会话，并且一直保留到用户打开该会话——这是一个静止的标记，用户守在页面前时有用，不在时无用。用户拿来对比的每一个桌面方案（例如 Otty）都以不同方式回答同一个缺口：由页面本身发出声音并弹出系统通知。

Web 客户端中没有任何东西拥有这一行为。`ui-session` 发布了提醒所需的事实——按会话的 `running` 标志与生效中的待处理交互，二者都源自 `api-session/status` 事件与目录基线——但它刻意不拥有任何呈现与浏览器能力。`ui-workspace` 把绿点渲染为侧边栏状态。两者都不能长出通知路径：`ui-session` 是其他所有 UI 包读取的数据适配层，`ui-workspace` 是浏览器树。

## 决策

`@deepseek-ai/dsh-client-ui-notification` 是一个 Web 客户端插件，其唯一输入是 `ctx.uiSession.sessionStatus`——[客户端会话引用](../architecture/2026-09-15-client-session-references.zh.md)中描述的统一状态源。它的 `AttentionDetector` 把每次发布的快照与每个会话上一次的观测做折叠，报告两种跃迁：观测到运行中的会话停止时的 `completed`，以及会话发布待处理交互（包括替换先前请求的新请求）时的 `awaiting-input`。会话的首次观测是基线，因此重新加载与重连时重新发布已空闲会话的快照不会提醒任何人；同一步既让会话停止又发布请求时只报告等待。

投递在构造上就是页面本地的。宿主只把偏好存放在 `ui-notification` 用户设置区块中，别的什么都不存；页面通过自身浏览器能力拥有提示音与横幅，因此桌面端外壳、本机浏览器与远程浏览器各自用自己具备的能力投递。投递前有两道过滤：`reminderSubject` 丢弃目录之外的会话以及 `origin` 为 `subagent` 的会话，因为子会话运行在用户已经在跟踪的任务之下；`ReminderPolicy` 读取实时偏好，并在页面可见且聚焦时拦下投递，除非用户打开了该覆盖项。提醒默认两个触发条件与两条渠道全开，聚焦时安静。

提示音在单个按需创建的 `AudioContext` 上合成——一段上行的双音正弦——而不是以音频资源发布，这让发布包保持为两个 bundle 产物。横幅是一个 `Notification`，标题为会话显示名称，正文为结果，并带 `dsh-session-<id>` 标签，使同一会话的重复提醒互相替换。页面可能缺失的每一种能力都退化为带一行 console 的静默空操作：没有 `Notification` API、权限未授予或被拒绝、横幅被拒绝、没有 `AudioContext`，或构造抛错。权限按次读取，并在窗口获得焦点时重读，因此在浏览器自身设置中完成的授权无需重新加载即可显现。

该功能拥有自己的常规设置行（`settings.general.item`，id 为 `notification`）：五个开关经 `ctx.settingsScope` 写入，而该行只在权限尚未确定时渲染 **允许浏览器通知** 控件，在被拒绝时渲染一行说明。

## 考虑过的替代方案

**经桌面端外壳做宿主侧通知。** 否决：桌面主进程可以发出操作系统通知，但同一个 Web bundle 也会运行在普通浏览器中，那里不存在宿主路径。只在一种外壳里生效的能力需要为另一种再写一份分叉实现，而浏览器 Notification API 已经能从两者抵达操作系统。

**用页内 toast 或横幅替代系统通知。** 否决：这些提醒正是为「用户没有在看的那个窗口」而存在，页内 toast 在那里不可见。对于用户正在看的窗口，它也只是重复了工作区的完成圆点。

**从 `completionUnread` 而不是折叠跃迁来提醒。** 否决：该标志的定义是「缺少主视图所有权时停止」，并在会话成为主视图时被清除，因此它无法表达「这个会话完成了」——无论对用户正注视的会话，还是对页面加载前就已完成的会话。检测器直接读取 `running` 与 `pendingInteraction`，并自持一步记忆。

**为每个会话提醒，包括 subagent。** 否决：被委派的子会话完成并不是用户在等的答案，而一队 subagent 会为一个任务的进展制造一串横幅。

**不论是否聚焦，跃迁发生就投递。** 否决：为用户正在看着的工作提醒只会打断而不增加信息。聚焦覆盖项让这种抑制由用户控制，而不是硬编码。

**放进 `ui-session` 或 `ui-workspace`。** 否决：这两个包拥有被其他功能读取的数据或导航状态，都不应获得浏览器能力、音频上下文与设置行。把提醒放在自己的插件里，也让部署可以整行移除该行为。

## 影响

判定「停止是否值得提醒」的规则现在存在于两处：工作区圆点用的 `completionUnread`，以及提醒用的检测器逐会话折叠。它们在「运行到空闲」这一步以及忽略初始基线上一致，并在主视图所有权上有意不同——用户正在看的会话在窗口失去焦点后仍会提醒。未来若要改变「完成」的定义，必须同时改动两处，而两个包都不能导入对方的折叠。

提醒是尽力而为的页面状态：什么都不持久化，重新加载会忘记所有观测，页面关闭期间发生的停止永远不会被报告。失败的会话与成功的会话正文相同，因为状态不携带失败事实；transcript 仍是失败可读之处。subagent 或后台任务在父会话保持空闲或持续运行时完成不会提醒任何人；选中横幅不会聚焦任何东西，因为会话导航属于 `ui-workspace`。

提示音对两个触发条件是同一段合成音，因此听感上无法区分，也不读取用户提供的音频。首次 `AudioContext` 构造失败的页面在整个会话中保持静默，而不是逐次重试。

## 测试

- `packages/client/ui-notification/tests/attention.client.spec.ts` 固定跃迁规则：基线、重复快照、替换请求、同一步的停止与请求、离开目录的会话，以及逐会话顺序。
- `packages/client/ui-notification/tests/reminder.client.spec.ts` 固定偏好矩阵与主题解析，包括对 subagent 与缺失目录的拒绝。
- `packages/client/ui-notification/tests/channels.client.spec.ts` 驱动每一种浏览器能力替身：权限状态、被拒绝的请求、被拒绝的横幅、双音排定、挂起的上下文、被拒绝的 resume，以及没有音频的页面。
- `packages/client/ui-notification/tests/assembly.client.spec.ts` 启动真实 web profile 名单并经生产 Connection 驱动 `api-session/status` 帧：设置行注册进组装后的常规区块、两个触发条件都会投递、subagent 保持静默、聚焦覆盖项生效、偏好写入抵达 `settings/mutate`，权限控件在授权与窗口聚焦时重新发布。
- `packages/client/ui-notification/tests/host.client.spec.ts` 在真实设置提供方之上挂载宿主半边，固定命名空间默认值与 schema 拒绝。
