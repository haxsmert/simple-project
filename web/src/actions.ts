import type { TaskState, Hold, Role } from './types';

// 「下一步」动作表 —— 界面只呈现"人的意图", 不呈现状态机的内部模型。
//
// 模型(2026-07-17 定调): 主干四阶段 计划→执行→测试→完成 是一条线; 挂起(等确认/等决策)是
// 与主干**平行**的中断字段。动作按 阶段×挂起 给: 挂起中只给"解除挂起"的动作(批准/打回),
// 等决策的出路是答复(不在此表); 未挂起时给主干推进 + 提交把关 + 改派。
// 约束: 每条动作的去向必须是 src/core/stateMachine.ts canMove 允许的位置变更(有测试守着)。
export type TaskAction = {
  key: string;
  label: string;        // 大白话动作名(动词开头, 说清"我要干嘛")
  hint: string;         // 后果: 点下去会发生什么
  done: string;         // 做完后的回执语(独立成句 —— 拿 label 拼"已"字会出"已做完了, 交去测试"这种语病)
  toState: TaskState;
  toHold?: Hold;        // 挂起怎么变: 'confirm'=提交把关, null=解除, 缺省=不动(改派不碰挂起)
  toRole: Role;
  primary?: boolean;    // 一屏只有一个主 CTA
  danger?: boolean;     // 打回/返工类, 视觉上与主动作分开
  keepActor?: boolean;  // 留在当前行动者手里(如"验收通过"就是测试者自己盖章)
  toHuman?: boolean;    // 交到人类决策者手里 —— 不能用 keepActor 冒充:
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

// 纯改派(原地换手): 阶段/挂起都不动, 只换人。canMove 首行"原地恒许"就是允许它的 ——
// 行动者卡住/下线时要能转给别人, 不能只剩"推到下一阶段"这一条路。
const reassign = (state: TaskState): TaskAction => ({
  key: 'reassign', label: '换个人做', hint: '阶段不变, 只换人', done: '已改派', toState: state,
  toRole: state === 'planning' ? 'planner' : state === 'testing' ? 'tester' : 'executor',
});

// 未挂起时的主干动作(按阶段)。确认关可跳过, 计划不可跳过:
// 两条推进路(直接开工 / 先过确认)都必须有计划 —— 后端 handoff 同样把着这道门。
const MAIN_ACTIONS: Record<TaskState, TaskAction[]> = {
  planning: [
    { key: 'start', label: '开始执行', hint: '不用等确认, 有计划就开工', done: '已开工', toState: 'executing', toHold: null, toRole: 'executor', primary: true,
      form: { kind: 'plan', title: '计划(开工前必须有)', hint: '执行前必须有计划; 每行一条, 写成「- [ ] 事项」的行会按清单展示', required: true, onlyIfMissing: true } },
    { key: 'submit', label: '提交计划, 等我确认', hint: '写下计划, 先过你这关再开工', done: '计划已提交, 等你确认', toState: 'planning', toHold: 'confirm', toRole: 'decider', toHuman: true,
      form: { kind: 'plan', title: '计划(打算怎么做)', hint: '每行一条; 写成「- [ ] 事项」的行会按清单展示', required: true } },
    reassign('planning'),
  ],
  executing: [
    { key: 'toTest', label: '做完了, 交去测试', hint: '写下做出了什么, 送去验收', done: '已送去测试', toState: 'testing', toHold: null, toRole: 'tester', primary: true,
      form: { kind: 'output', title: '做出了什么', hint: '写给验收的人: 产物每行一条(「- 文件/链接」会按清单展示)+ 一句话摘要', required: true } },
    reassign('executing'),
  ],
  testing: [
    { key: 'pass', label: '验收通过', hint: '标记为完成', done: '已验收通过, 完成', toState: 'done', toHold: null, toRole: 'tester', primary: true, keepActor: true },
    { key: 'fail', label: '打回返工', hint: '没通过, 退回去重做', done: '没通过, 已退回去重做', toState: 'executing', toHold: null, toRole: 'executor', danger: true,
      form: { kind: 'reason', title: '哪里没过?', hint: '写给返工的人, 会记进「经过」' } },
    reassign('testing'),
  ],
  done: [],
};

// 确认挂起中的动作: 批准(前进一步)/ 打回(原地解除)。按所在阶段给文案 ——
// 机制上任何非完成阶段都能挂确认(MCP 可设), 界面对每种都要给得出路, 不能只认识"计划等确认"。
const CONFIRM_ACTIONS: Partial<Record<TaskState, TaskAction[]>> = {
  planning: [
    { key: 'approve', label: '批准开工', hint: '计划通过, 马上开做', done: '已批准, 开工了', toState: 'executing', toHold: null, toRole: 'executor', primary: true },
    { key: 'bounce', label: '打回重规划', hint: '计划不行, 退回去重写', done: '已打回, 等重新规划', toState: 'planning', toHold: null, toRole: 'planner', danger: true,
      form: { kind: 'reason', title: '哪里不行?', hint: '写给重新规划的人, 会记进「经过」' } },
  ],
  executing: [
    { key: 'approve', label: '批准, 交去测试', hint: '产出通过, 送去验收', done: '已批准, 送去测试', toState: 'testing', toHold: null, toRole: 'tester', primary: true },
    { key: 'bounce', label: '打回继续做', hint: '产出不行, 退回去接着做', done: '已打回, 继续执行', toState: 'executing', toHold: null, toRole: 'executor', danger: true,
      form: { kind: 'reason', title: '哪里不行?', hint: '写给接着做的人, 会记进「经过」' } },
  ],
  testing: [
    { key: 'approve', label: '批准, 标记完成', hint: '验收通过, 收官', done: '已批准, 完成', toState: 'done', toHold: null, toRole: 'tester', primary: true },
    { key: 'bounce', label: '打回重测', hint: '还不行, 退回去再测', done: '已打回, 继续测试', toState: 'testing', toHold: null, toRole: 'tester', danger: true,
      form: { kind: 'reason', title: '哪里不行?', hint: '写给再测的人, 会记进「经过」' } },
  ],
};

// 动作入口: 按 阶段×挂起 取该给的动作。
// 等决策(hold=decision)刻意为空: 出路是答复它的问题(答复后自动解除)。给"不答复直接继续"
// 能造出"问题还挂着、任务却在跑"的破坏不变量状态 —— 合法 ≠ 该给。
export function actionsFor(state: TaskState, hold: Hold): TaskAction[] {
  if (hold === 'decision') return [];
  if (hold === 'confirm') return CONFIRM_ACTIONS[state] ?? [];
  return MAIN_ACTIONS[state];
}

// 项目动作(2026-07-19 定调: 项目=大号任务, 只有 执行中/已完结 两态, 不走四阶段):
// 执行中 → 完结关闭(允许遗留未完成任务, 后端自动留痕)/ 换负责人; 已完结 → 重开。
// toRole 用项目当前角色(项目的角色只是标签, 原地改派保角色的闸要求同角色)。
export function projectActionsFor(state: TaskState, currentRole: Role | null): TaskAction[] {
  const role = currentRole ?? 'planner';
  if (state === 'done') {
    return [
      { key: 'reopen', label: '重开项目', hint: '方向续作, 回到执行中', done: '已重开, 回到执行中', toState: 'executing', toHold: null, toRole: role, primary: true, keepActor: true },
    ];
  }
  return [
    { key: 'close', label: '完结关闭', hint: '方向收官或搁置, 项目沉入「已完结」', done: '已完结关闭', toState: 'done', toHold: null, toRole: role, keepActor: true, danger: true,
      form: { kind: 'reason', title: '为什么完结?(可选)', hint: '会记进「经过」; 还有未完成任务的话会自动留痕' } },
    { key: 'reassign', label: '换负责人', hint: '项目不动, 只换人', done: '已改派', toState: state, toRole: role },
  ];
}

// 结构性测试用: 全部动作条目(带其前置位置), 逐条对 canMove 校验
export const ALL_ACTION_ENTRIES: Array<{ from: { state: TaskState; hold: Hold }; action: TaskAction }> = [
  ...(Object.keys(MAIN_ACTIONS) as TaskState[]).flatMap((s) =>
    MAIN_ACTIONS[s].map((a) => ({ from: { state: s, hold: null as Hold }, action: a }))),
  ...(Object.keys(CONFIRM_ACTIONS) as TaskState[]).flatMap((s) =>
    (CONFIRM_ACTIONS[s] ?? []).map((a) => ({ from: { state: s, hold: 'confirm' as Hold }, action: a }))),
];

// 「下一步」动作提交给后端的完整输入: 去向(谁/角色/阶段/挂起)+ 留言 + 动作携带的内容
export type ActInput = {
  taskId: string; toActor: string; toRole: Role; toState: TaskState; toHold?: Hold; note: string;
  planMd?: string;                                  // form:'plan' 的动作携带(先落库再转交, 转交失败计划也不丢)
  outputs?: { outputsMd: string; summary: string }; // form:'output' 的动作携带
};
