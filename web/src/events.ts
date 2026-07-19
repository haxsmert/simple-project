import type { TaskEvent } from './types';
import { STATE_NAME, PROJECT_STATE_NAME } from './states';

// 「经过」/最近动静 的共享叙述层(单一来源): 抽屉线程与项目卡都引这里, 不复制粘贴两份措辞。
// 把一条事件说成一句人话: 谁 + 做了什么 + 给谁 + 阶段/挂起怎么变。

const KIND_VERB: Record<string, string> = {
  handoff: '转交', comment: '留言', output: '交了产出', clarify: '提了个问题等人决定', decide: '拍了板', claim: '接手', plan: '写了计划', update: '改了任务信息',
};

// 项目卡/线程共用的最小事件形状(项目卡的 lastEvent 不带 id 等字段)
export type EventShape = Pick<TaskEvent, 'kind' | 'toActor' | 'stateFrom' | 'stateTo' | 'holdFrom' | 'holdTo'>;

export function eventText(ev: EventShape, nameOf: (id: string | null) => string | null, opts?: { project?: boolean }): string {
  if (ev.kind !== 'handoff') return KIND_VERB[ev.kind] ?? ev.kind;
  const to = nameOf(ev.toActor);
  // 项目(两态)的换手措辞用项目语言: 完结关闭 / 重开 —— 不说"执行中 → 完成"这种任务腔;
  // 完结/重开是留在原负责人手里的动作(keepActor), 不拼"转交给 X"(换负责人是另一个动作, 走下面通用叙述)
  if (opts?.project && ev.stateFrom && ev.stateTo && ev.stateFrom !== ev.stateTo) {
    return ev.stateTo === 'done' ? '完结关闭' : ev.stateFrom === 'done' ? '重开(回到执行中)' : `${PROJECT_STATE_NAME[ev.stateFrom]} → ${PROJECT_STATE_NAME[ev.stateTo]}`;
  }
  const moved = ev.stateFrom && ev.stateTo && ev.stateFrom !== ev.stateTo
    ? `${STATE_NAME[ev.stateFrom]} → ${STATE_NAME[ev.stateTo]}` : null;
  // 挂起变化是动作的"名字": 提交等确认 / 批准(伴随阶段前进) / 打回(原地解除)
  const holdVerb = ev.holdTo === 'confirm' && ev.holdFrom !== 'confirm' ? '提交等确认'
    : ev.holdFrom === 'confirm' && !ev.holdTo ? (moved ? '批准通过' : '打回') : null;
  const bits = [to ? `转交给 ${to}` : null, holdVerb, moved].filter(Boolean);
  if (bits.length === 0) return '转交';           // 迁移前的老事件: 确实没记, 不编
  if (!to && !holdVerb && moved) return `推进到 ${moved}`;
  return bits.join(' · ');
}

// 相对时间: 项目卡"最近动静"用 —— 对持续流, "多久没动"本身就是信号
export function timeAgo(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} 天前`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
