import type { Role } from '../types';

const LABEL: Record<Role, string> = { planner: '规划', executor: '执行', tester: '测试', decider: '决策' };
const CLS: Record<Role, string> = { planner: 'plan', executor: 'exec', tester: 'test', decider: 'decide' };

export function RoleChip({ role }: { role: Role | null }) {
  if (!role) return null;
  return (<span className={`role ${CLS[role]}`}><span className="rd" />{LABEL[role]}</span>);
}
