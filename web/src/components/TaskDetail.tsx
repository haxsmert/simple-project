import { useState } from 'react';
import type { TaskPackage, Actor, TaskState } from '../types';
import { ActorBadge } from './ActorBadge';
import { RoleChip } from './RoleChip';
import { EdgeChip } from './EdgeChip';

const STATE_NAME: Record<TaskState, string> = { planning: '待规划', awaiting_confirm: '待确认', executing: '执行中', awaiting_decision: '待决策', testing: '测试中', done: '完成' };

function ClarBox({ clarId, onAnswer }: { clarId: string; onAnswer: (id: string, answer: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
      <input placeholder="答复决策…" value={v} onChange={(e) => setV(e.target.value)} style={{ flex: 1 }} />
      <button className="btn primary" onClick={() => onAnswer(clarId, v)}>答复</button>
    </div>
  );
}

export function TaskDetail({ pkg, actorsById, onAnswer, onClose }: {
  pkg: TaskPackage; actorsById: Record<string, Actor>; onAnswer: (clarId: string, answer: string) => void; onClose: () => void;
}) {
  const t = pkg.task;
  return (
    <div className="drawer">
      <button className="btn" onClick={onClose} style={{ float: 'right' }}>关闭</button>
      <div className="crumb">{pkg.breadcrumb.map((b) => <span key={b.id}>{b.title} ▸</span>)}</div>
      <h2>{t.title}</h2>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <span className="pill">{STATE_NAME[t.state]}</span>
        <ActorBadge actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} />
        <RoleChip role={t.currentRole} />
      </div>

      <div className="slot"><h4>输入 Inputs</h4>
        {pkg.inputs.goal && <p><b>目标:</b> {pkg.inputs.goal}</p>}
        {pkg.inputs.inputsMd && <pre style={{ whiteSpace: 'pre-wrap' }}>{pkg.inputs.inputsMd}</pre>}
        {pkg.inputs.depOutputs.map((d) => <div key={d.taskId} className="card-id">依赖 {d.taskId}: {d.summary ?? '—'}</div>)}
      </div>

      <div className="slot"><h4>产出 Outputs</h4>
        {pkg.outputs.outputsMd && <pre style={{ whiteSpace: 'pre-wrap' }}>{pkg.outputs.outputsMd}</pre>}
        {pkg.outputs.summary && <p><b>摘要:</b> {pkg.outputs.summary}</p>}
      </div>

      {pkg.clarifications.length > 0 && (
        <div className="slot"><h4>待确认 Clarification</h4>
          {pkg.clarifications.map((c) => (
            <div key={c.id} className="clar">
              <div>{c.title}{c.state === 'done' ? '(已决策)' : ''}</div>
              {c.state !== 'done' && <ClarBox clarId={c.id} onAnswer={onAnswer} />}
            </div>
          ))}
        </div>
      )}

      {pkg.subtasks.length > 0 && (
        <div className="slot"><h4>子任务 Subtasks</h4>
          {pkg.subtasks.map((s) => <div key={s.id} className="card-id">{s.state === 'done' ? '☑' : '☐'} {s.id} <span>{s.title}</span></div>)}
        </div>
      )}

      {(pkg.edges.out.length > 0 || pkg.edges.in.length > 0) && (
        <div className="slot"><h4>关系边 Edges</h4>
          {pkg.edges.out.map((e) => <div key={e.id}><EdgeChip type={e.type} /> → {e.toTask}</div>)}
          {pkg.edges.in.map((e) => <div key={e.id}>{e.fromTask} → <EdgeChip type={e.type} /></div>)}
        </div>
      )}

      <div className="slot thread"><h4>交互记录 Thread</h4>
        {pkg.thread.map((ev) => (
          <div key={ev.id} className="ev">{ev.createdAt} · {ev.actorId} · {ev.kind}{ev.body ? `: ${ev.body}` : ''}</div>
        ))}
      </div>
    </div>
  );
}
