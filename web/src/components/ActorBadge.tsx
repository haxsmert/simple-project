import type { Actor } from '../types';

const BotGlyph = () => (
  <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden>
    <rect x="3" y="5" width="10" height="8" rx="2" /><rect x="6.5" y="1.5" width="3" height="3" rx="1" />
  </svg>
);

export function ActorBadge({ actor }: { actor: Actor | null }) {
  if (!actor) return (<span className="actor none"><span className="av" />未分派</span>);
  const cls = actor.type === 'human' ? 'actor human' : 'actor agent';
  return (
    <span className={cls}>
      <span className="av">{actor.type === 'agent' ? <BotGlyph /> : actor.name.slice(0, 1)}</span>
      {actor.name}
    </span>
  );
}
