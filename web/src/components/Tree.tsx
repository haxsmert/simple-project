import type { TaskNode, TaskState, Actor } from '../types';
import { ActorBadge } from './ActorBadge';
import { STATE_NAME, STATE_COLOR } from '../states';


export function Tree({ nodes, onOpen, actorsById = {} }: { nodes: TaskNode[]; onOpen: (id: string) => void; actorsById?: Record<string, Actor> }) {
  return (
    <div className="tree">
      {nodes.map((n) => {
        // 两个"轮到你"的关卡: 待确认(确认计划)/ 待决策(答复澄清) —— 整行琥珀高亮 + 标记, 状态点仍按各自状态色
        const needsYou = n.state === 'awaiting_confirm' || n.state === 'awaiting_decision';
        const flag = n.state === 'awaiting_decision' ? '待你决策' : '待你确认';
        const actor = n.currentActor ? actorsById[n.currentActor] ?? null : null;
        return (
          <div key={n.id} className="tree-node">
            <button type="button" className={`trow${needsYou ? ' decide' : ''}`} onClick={() => onOpen(n.id)}>
              <span className="tdot" style={{ background: STATE_COLOR[n.state] }} />
              <span className="tid">{n.id}</span>
              <span className="ttitle">{n.title}</span>
              {needsYou ? <span className="tflag">{flag}</span> : <span className="tstate">{STATE_NAME[n.state]}</span>}
              <span className="tactor"><ActorBadge actor={actor} /></span>
            </button>
            {n.children.length > 0 && <div className="tree-children"><Tree nodes={n.children} onOpen={onOpen} actorsById={actorsById} /></div>}
          </div>
        );
      })}
    </div>
  );
}
