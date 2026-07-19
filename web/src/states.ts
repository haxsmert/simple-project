import type { TaskState, Hold } from './types';

// 状态语言的单一来源 —— 看板列头/条纹、任务树节点点、抽屉子任务点、卡片可及名全部引这里。
// 模型: 主干四阶段是列; 挂起(等确认/等决策)是平行字段, 用琥珀"轮到你"语言亮在卡片/行上, 不占列。
export const STATE_NAME: Record<TaskState, string> = {
  planning: '待规划', executing: '执行中', testing: '测试中', done: '完成',
};

export const STATE_COLOR: Record<TaskState, string> = {
  planning: 'var(--text-faint)', executing: 'var(--human)', testing: 'var(--testing)', done: 'var(--done)',
};

// 挂起的两种叫法: 中性名(徽标/事件用)与"轮到你"名(卡片/树上招手用)
export const HOLD_NAME: Record<Exclude<Hold, null>, string> = { confirm: '等确认', decision: '等决策' };
export const HOLD_FLAG: Record<Exclude<Hold, null>, string> = { confirm: '待你确认', decision: '待你决策' };

// 项目 = 大号任务(2026-07-19 定调): 只有两态, 界面用项目自己的语言(内部仍复用 executing/done 枚举)
// planning/testing 对项目不存在(迁移已归一), 映射仅为类型完整
export const PROJECT_STATE_NAME: Record<TaskState, string> = {
  planning: '执行中', executing: '执行中', testing: '执行中', done: '已完结',
};
