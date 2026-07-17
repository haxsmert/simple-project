import { useState } from 'react';
import type { Actor, TaskState, Role } from '../types';
import { NEXT_ACTIONS, type TaskAction } from '../actions';

// 「下一步」面板: 取代原来的「换手」三元组表单。
// - 只列当前状态允许的去向, 每条是一句大白话 + 后果说明 → 不可能拼出非法组合
// - 「交给谁」是唯一的选择项, 且有可见标签(原来三个下拉全靠 aria-label, 眼睛看不到)
// - 主动作只有一个(primary), 打回类视觉上分开
// - 点击后禁用 + 「处理中…」, 防连点重复提交
export function NextActions({ taskId, state, currentActor, actorsById, onAct }: {
  taskId: string; state: TaskState; currentActor: string | null;
  actorsById: Record<string, Actor>;
  onAct: (input: { taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string }, action: TaskAction) => Promise<boolean>;
}) {
  const actions = NEXT_ACTIONS[state];
  const agents = Object.values(actorsById).filter((a) => a.type === 'agent');
  const human = Object.values(actorsById).find((a) => a.type === 'human');
  const [assignee, setAssignee] = useState(agents[0]?.id ?? Object.keys(actorsById)[0] ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (actions.length === 0) return null;
  // 只有"要转交给别人"的动作才需要问"交给谁"; 留在原处的(keepActor)和交给你的(toHuman)都不问
  const needsAssignee = actions.some((a) => !a.keepActor && !a.toHuman);
  const canAct = !needsAssignee || !!assignee;

  // 谁来接手: 交给你 > 留在原处 > 选中的人。三者不能混为一谈 ——
  // 用 keepActor 冒充"交给你"会把当前 agent 设成决策者, 等于让它自己批自己的计划。
  const targetOf = (a: TaskAction) =>
    a.toHuman ? (human?.id ?? assignee) : a.keepActor ? (currentActor ?? assignee) : assignee;

  const run = async (a: TaskAction) => {
    if (busy) return;
    setBusy(a.key);
    try {
      const ok = await onAct({ taskId, toActor: targetOf(a), toRole: a.toRole, toState: a.toState, note: note.trim() }, a);
      if (ok) setNote(''); // 失败就别抹掉人家写好的说明
    } finally { setBusy(null); }
  };

  return (
    <div className="next-actions" aria-busy={!!busy}>
      {needsAssignee && (
        <label className="assign">
          <span className="assign-label">交给</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {Object.values(actorsById).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <div className="act-list">
        {actions.map((a) => (
          // 可及名只取 label: 否则 label+hint 会糊成"提交计划, 等我确认先过你这关再开工"这种病句
          <button key={a.key} type="button" aria-label={a.label}
            className={`btn act${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`}
            disabled={!!busy || !canAct} onClick={() => run(a)}>
            <span className="act-label" aria-hidden="true">{busy === a.key ? '处理中…' : a.label}</span>
            <span className="act-hint" aria-hidden="true">{a.hint}</span>
          </button>
        ))}
      </div>
      <input className="act-note" placeholder="附一句说明(可选)" value={note}
        onChange={(e) => setNote(e.target.value)} disabled={!!busy} />
    </div>
  );
}
