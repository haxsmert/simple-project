import type { TaskPackage } from '../core/infoPackage';

export function renderTaskMarkdown(pkg: TaskPackage): string {
  const t = pkg.task;
  const lines: string[] = [
    '---',
    `id: ${t.id}`,
    `title: ${JSON.stringify(t.title)}`,
    `state: ${t.state}`,
    `role: ${t.currentRole ?? ''}`,
    `actor: ${t.currentActor ?? ''}`,
    `parent: ${t.parentId ?? ''}`,
    `priority: ${t.priority ?? ''}`,
    `updated_at: ${t.updatedAt}`,
    '---',
    '',
    `# ${t.title}`,
    '',
    '## 输入 Inputs',
    '',
  ];

  if (t.goal) lines.push(`**目标:** ${t.goal}`, '');
  if (t.inputsMd) lines.push(t.inputsMd, '');
  if (pkg.inputs.depOutputs.length) {
    lines.push('**依赖产出:**');
    for (const d of pkg.inputs.depOutputs) {
      lines.push(`- ${d.taskId} ${d.title}: ${d.summary ?? '(无摘要)'}`);
    }
    lines.push('');
  }

  lines.push('## 产出 Outputs', '');
  if (t.outputsMd) lines.push(t.outputsMd, '');
  if (t.summary) lines.push(`**摘要:** ${t.summary}`, '');

  if (pkg.clarifications.length) {
    lines.push('## 待确认 Clarification', '');
    for (const c of pkg.clarifications) {
      lines.push(`- [${c.state === 'done' ? 'x' : ' '}] ${c.id} ${c.title}`);
    }
    lines.push('');
  }

  if (pkg.subtasks.length) {
    lines.push('## 子任务 Subtasks', '');
    for (const s of pkg.subtasks) {
      lines.push(`- [${s.state === 'done' ? 'x' : ' '}] ${s.id} ${s.title}`);
    }
    lines.push('');
  }

  if (pkg.edges.out.length || pkg.edges.in.length) {
    lines.push('## 关系边 Edges', '');
    for (const e of pkg.edges.out) lines.push(`- ${e.type} → ${e.toTask}`);
    for (const e of pkg.edges.in) lines.push(`- ${e.fromTask} → ${e.type} → (本任务)`);
    lines.push('');
  }

  lines.push('## 交互记录 Thread', '');
  for (const ev of pkg.thread) {
    const route = ev.roleFrom || ev.roleTo ? ` (${ev.roleFrom ?? '?'} → ${ev.roleTo ?? '?'})` : '';
    lines.push(`- ${ev.createdAt} · ${ev.actorId} · ${ev.kind}${route}${ev.body ? ': ' + ev.body : ''}`);
  }
  lines.push('');

  return lines.join('\n');
}
