import type { TaskState, Role } from './types';

// 「下一步」动作表 —— 界面只呈现"人的意图", 不呈现状态机的三元组。
//
// 为什么这样做: 原来的「换手」把 谁×角色×状态 的记账甩给使用者, 还把 6 个状态全列出来,
// 其中一半是状态机根本不允许的去向(点了必报错)。而状态机对每个状态本就只允许 1-2 条路,
// 所以这里把每条合法去向翻译成一句大白话动作 —— 点一下就走, 不可能拼出非法组合。
//
// 注: 这是合法流转的**子集** —— 只收"人会主动做"的。executing→awaiting_decision 是
// agent 卡住时自己发起待确认(raise), 不是人在这里换手, 故不列。
// 约束: 每条 toState 必须是 src/core/stateMachine.ts 的 TRANSITIONS 允许的(有测试守着)。
export type TaskAction = {
  key: string;
  label: string;        // 大白话动作名(动词开头, 说清"我要干嘛")
  hint: string;         // 后果: 点下去会发生什么
  done: string;         // 做完后的回执语(独立成句 —— 拿 label 拼"已"字会出"已做完了, 交去测试"这种语病)
  toState: TaskState;
  toRole: Role;
  primary?: boolean;    // 一屏只有一个主 CTA
  danger?: boolean;     // 打回/返工类, 视觉上与主动作分开
  keepActor?: boolean;  // 留在当前行动者手里(如"验收通过"就是测试者自己盖章)
  toHuman?: boolean;    // 交到"你"(人类决策者)手里 —— 不能用 keepActor 冒充:
                        // 那会把当前 agent 设成 decider, 等于让 agent 自己批准自己的计划, 正是这道闸要拦的事
  form?: ActionForm;    // 动作携带的内容: 光转交不交东西的动作是空话 —— "提交计划"得有地方写计划
};

// 动作的内容面板: 有 form 的动作点开先展开输入区, 填了才走。
// 为什么长在动作上而不是另设编辑入口: 计划/产出只在"交出去"这一刻才需要成文,
// 把输入口放在动作旁(direct manipulation)比"先去别处编辑、再回来点按钮"少一次心智跳转。
export type ActionForm = {
  kind: 'plan'          // 计划(落到任务内容 inputsMd, 是下一棒执行的输入)
    | 'output'          // 产出 + 一句话摘要(落到 outputsMd/summary, 是测试验收的依据)
    | 'reason';         // 一句说明(作为转交留言记进「经过」—— 打回不说哪里不行, 接手的人只能猜)
  title: string;        // 面板标题
  hint?: string;        // 面板说明(格式提示/写给谁看)
  required?: boolean;   // 内容必填: 空着提交会造出"提交了计划但没有计划"的自相矛盾
  onlyIfMissing?: boolean; // 内容已有时不展开、一键直走 —— 入门守卫(没有就得先写), 不是每次都打断
};

// 纯改派(同态换手): 状态不动, 只换人。canTransition 首行 from===to 就是允许它的,
// 旧换手表单的默认行为正是这个 —— 执行者卡住/下线时要能转给别人, 不能只剩"推到下一阶段"这一条路。
const reassign = (state: TaskState, role: Role): TaskAction => ({
  key: 'reassign', label: '换个人做', hint: '阶段不变, 只换人', done: '已改派', toState: state, toRole: role,
});

export const NEXT_ACTIONS: Record<TaskState, TaskAction[]> = {
  // 主干是 计划→执行→测试→完成; 待确认/待决策是跳出的关卡。确认关可跳过, 但计划不可跳过:
  // 两条推进路(直接开工 / 先过确认)都必须有计划 —— 后端 handoff 同样把着这道门(src/core/handoff.ts)。
  planning: [
    { key: 'start', label: '开始执行', hint: '不用等确认, 有计划就开工', done: '已开工', toState: 'executing', toRole: 'executor', primary: true,
      form: { kind: 'plan', title: '计划(开工前必须有)', hint: '执行前必须有计划; 每行一条, 写成「- [ ] 事项」的行会按清单展示', required: true, onlyIfMissing: true } },
    { key: 'submit', label: '提交计划, 等我确认', hint: '写下计划, 先过你这关再开工', done: '计划已提交, 等你确认', toState: 'awaiting_confirm', toRole: 'decider', toHuman: true,
      form: { kind: 'plan', title: '计划(打算怎么做)', hint: '每行一条; 写成「- [ ] 事项」的行会按清单展示', required: true } },
    reassign('planning', 'planner'),
  ],
  awaiting_confirm: [
    { key: 'approve', label: '批准开工', hint: '计划通过, 马上开做', done: '已批准, 开工了', toState: 'executing', toRole: 'executor', primary: true },
    { key: 'bounce', label: '打回重规划', hint: '计划不行, 退回去重写', done: '已打回, 等重新规划', toState: 'planning', toRole: 'planner', danger: true,
      form: { kind: 'reason', title: '哪里不行?', hint: '写给重新规划的人, 会记进「经过」' } },
  ],
  executing: [
    { key: 'toTest', label: '做完了, 交去测试', hint: '写下做出了什么, 送去验收', done: '已送去测试', toState: 'testing', toRole: 'tester', primary: true,
      form: { kind: 'output', title: '做出了什么', hint: '写给验收的人: 产物每行一条(「- 文件/链接」会按清单展示)+ 一句话摘要', required: true } },
    reassign('executing', 'executor'),
  ],
  // 待决策的唯一出路是"答复它的问题"(答复后状态机自动解冻回执行中), 所以这里刻意为空。
  // 曾想给一条「不答复直接继续」的出口: 虽然 executing 是合法边, 但 spec §3.2 定死
  // "仅当所有待确认都答复完毕, 父任务才解冻" —— 那个按钮能造出"问题还挂着、任务却在跑"的
  // 破坏不变量状态。合法 ≠ 该给。
  awaiting_decision: [],
  testing: [
    { key: 'pass', label: '验收通过', hint: '标记为完成', done: '已验收通过, 完成', toState: 'done', toRole: 'tester', primary: true, keepActor: true },
    { key: 'fail', label: '打回返工', hint: '没通过, 退回去重做', done: '没通过, 已退回去重做', toState: 'executing', toRole: 'executor', danger: true,
      form: { kind: 'reason', title: '哪里没过?', hint: '写给返工的人, 会记进「经过」' } },
    reassign('testing', 'tester'),
  ],
  done: [],
};

// 「下一步」动作提交给后端的完整输入: 去向(谁/角色/状态)+ 留言 + 动作携带的内容
export type ActInput = {
  taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string;
  planMd?: string;                                  // form:'plan' 的动作携带(先落库再转交, 转交失败计划也不丢)
  outputs?: { outputsMd: string; summary: string }; // form:'output' 的动作携带
};
