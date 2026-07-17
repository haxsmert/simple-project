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
  onAct: (input: { taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string }, action: TaskAction) => Promise<void> | void;
}) {
  const actions = NEXT_ACTIONS[state];
  const agents = Object.values(actorsById).filter((a) => a.type === 'agent');
  const [assignee, setAssignee] = useState(agents[0]?.id ?? Object.keys(actorsById)[0] ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (actions.length === 0) return null;
  // 有任一动作要转交时才需要"交给谁"; 全是留在原处的动作就不问
  const needsAssignee = actions.some((a) => !a.keepActor);
  const canAct = !needsAssignee || !!assignee;

  const run = async (a: TaskAction) => {
    if (busy) return;
    setBusy(a.key);
    try {
      await onAct({ taskId, toActor: a.keepActor ? (currentActor ?? assignee) : assignee, toRole: a.toRole, toState: a.toState, note: note.trim() }, a);
      setNote('');
    } finally { setBusy(null); }
  };

  return (
    <div className="next-actions">
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
          <button key={a.key} type="button"
            className={`btn act${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`}
            disabled={!!busy || !canAct} onClick={() => run(a)}>
            <span className="act-label">{busy === a.key ? '处理中…' : a.label}</span>
            <span className="act-hint">{a.hint}</span>
          </button>
        ))}
      </div>
      <input className="act-note" placeholder="附一句说明(可选)" value={note}
        onChange={(e) => setNote(e.target.value)} disabled={!!busy} />
    </div>
  );
}
