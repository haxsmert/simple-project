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
  keepActor?: boolean;  // true = 留在当前行动者手里, 不需要"交给谁"
};

export const NEXT_ACTIONS: Record<TaskState, TaskAction[]> = {
  planning: [
    { key: 'start', label: '开始执行', hint: '计划够了, 直接开工', done: '已开工', toState: 'executing', toRole: 'executor', primary: true },
    { key: 'submit', label: '提交计划, 等我确认', hint: '先过你这关再开工', done: '计划已提交, 等你确认', toState: 'awaiting_confirm', toRole: 'decider', keepActor: true },
  ],
  awaiting_confirm: [
    { key: 'approve', label: '批准开工', hint: '计划通过, 交给执行者去做', done: '已批准, 开工了', toState: 'executing', toRole: 'executor', primary: true },
    { key: 'bounce', label: '打回重规划', hint: '计划不行, 退回去重写', done: '已打回, 等重新规划', toState: 'planning', toRole: 'planner', danger: true },
  ],
  executing: [
    { key: 'toTest', label: '做完了, 交去测试', hint: '交给测试者验收', done: '已送去测试', toState: 'testing', toRole: 'tester', primary: true },
  ],
  // 待决策的唯一出路是"答复它的问题"(答复后状态机自动解冻回执行中), 所以这里刻意为空。
  // 曾想给一条「不答复直接继续」的出口: 虽然 executing 是合法边, 但 spec §3.2 定死
  // "仅当所有待确认都答复完毕, 父任务才解冻" —— 那个按钮能造出"问题还挂着、任务却在跑"的
  // 破坏不变量状态。合法 ≠ 该给。
  awaiting_decision: [],
  testing: [
    { key: 'pass', label: '验收通过', hint: '标记为完成', done: '已验收通过, 完成', toState: 'done', toRole: 'tester', primary: true, keepActor: true },
    { key: 'fail', label: '打回返工', hint: '没通过, 退回执行者重做', done: '没通过, 已退回去重做', toState: 'executing', toRole: 'executor', danger: true },
  ],
  done: [],
};
