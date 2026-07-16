import type { TaskNode } from '../types';

export function Tree({ nodes, onOpen }: { nodes: TaskNode[]; onOpen: (id: string) => void }) {
  return (
    <div>
      {nodes.map((n) => (
        <div key={n.id} className="tree-node">
          <span style={{ cursor: 'pointer' }} onClick={() => onOpen(n.id)}><span className="card-id">{n.id}</span> {n.title}</span>
          {n.children.length > 0 && <div className="tree-children"><Tree nodes={n.children} onOpen={onOpen} /></div>}
        </div>
      ))}
    </div>
  );
}
