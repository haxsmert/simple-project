import type { TaskState } from './types';

// 状态语言的单一来源 —— 看板列头/条纹、任务树节点点、抽屉子任务点、卡片可及名全部引这里。
// (此前 STATE_NAME/STATE_COLOR 在 Board/Tree/TaskCard/TaskDetail 各有一份字面拷贝, 注释却自称"同源"。)
export const STATE_NAME: Record<TaskState, string> = {
  planning: '待规划', awaiting_confirm: '待确认', executing: '执行中',
  awaiting_decision: '待决策', testing: '测试中', done: '完成',
};

// 待确认与待决策同为"轮到你"的关卡 → 同用琥珀; 两者靠状态名文字区分, 不靠颜色单独传意
export const STATE_COLOR: Record<TaskState, string> = {
  planning: 'var(--text-faint)', awaiting_confirm: 'var(--warn)', executing: 'var(--human)',
  awaiting_decision: 'var(--warn)', testing: 'var(--testing)', done: 'var(--done)',
};
