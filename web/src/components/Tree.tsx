import type { TaskNode, TaskState, Actor } from '../types';
import { ActorBadge } from './ActorBadge';
import { STATE_NAME, STATE_COLOR, HOLD_FLAG } from '../states';


export function Tree({ nodes, onOpen, actorsById = {} }: { nodes: TaskNode[]; onOpen: (id: string) => void; actorsById?: Record<string, Actor> }) {
  return (
    <div className="tree">
      {nodes.map((n) => {
        // 挂起(等确认/等决策) = "轮到你" —— 整行琥珀高亮 + 标记; 阶段点仍按阶段色(挂起是平行信息, 由文字承载)
        const needsYou = n.hold !== null;
        const flag = n.hold ? HOLD_FLAG[n.hold] : '';
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
