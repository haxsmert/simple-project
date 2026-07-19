import type { TaskPackage } from '../core/infoPackage';
import type { TaskEvent } from '../model/types';

// 镜像 .md 的承诺是"可脱离应用直接读" —— 所以正文说人话(与 UI 同一套语言),
// frontmatter 保持机器可读(枚举原值)。审计教训(2026-07-18): 缺 hold、中英混排标题、
// 问题卡在两节重复列、交互记录 "claim (? → planner)" 这类带问号的黑话 —— 全部清掉。
const STATE_NAME: Record<string, string> = { planning: '待规划', executing: '执行中', testing: '测试中', done: '完成' };
// 项目(顶层任务)说项目语言(审计第 3 轮: 界面叫「已完结」, 镜像写「完成」= 用词链路断裂)
const PROJECT_STATE_NAME: Record<string, string> = { executing: '执行中', done: '已完结' };
const HOLD_NAME: Record<string, string> = { confirm: '等确认', decision: '等决策' };
const ROLE_NAME: Record<string, string> = { planner: '规划', executor: '执行', tester: '测试', decider: '决策' };

// 与 Web 端 eventText 同一叙事: 谁 + 做了什么 + 给谁 + 阶段/挂起怎么变
function eventLine(ev: TaskEvent): string {
  const when = ev.createdAt.replace('T', ' ').slice(0, 16);
  const verb: Record<string, string> = {
    handoff: '转交', comment: '留言', output: '交了产出', clarify: '提了个问题等人决定',
    decide: '拍了板', claim: '接手', plan: '写了计划', update: '改了任务信息',
  };
  let what = verb[ev.kind] ?? ev.kind;
  if (ev.kind === 'handoff') {
    const moved = ev.stateFrom && ev.stateTo && ev.stateFrom !== ev.stateTo
      ? `${STATE_NAME[ev.stateFrom] ?? ev.stateFrom} → ${STATE_NAME[ev.stateTo] ?? ev.stateTo}` : null;
    const holdVerb = ev.holdTo === 'confirm' && ev.holdFrom !== 'confirm' ? '提交等确认'
      : ev.holdFrom === 'confirm' && !ev.holdTo ? (moved ? '批准通过' : '打回') : null;
    const bits = [ev.toActor ? `转交给 ${ev.toActor}` : null, holdVerb, moved].filter(Boolean);
    what = bits.length ? bits.join(' · ') : '转交';
  }
  if (ev.kind === 'claim' && ev.roleTo) what = `接手(${ROLE_NAME[ev.roleTo] ?? ev.roleTo})`;
  return `- ${when} · ${ev.actorId} · ${what}${ev.body ? `: ${ev.body}` : ''}`;
}

export function renderTaskMarkdown(pkg: TaskPackage): string {
  const t = pkg.task;
  const lines: string[] = [
    '---',
    `id: ${t.id}`,
    `title: ${JSON.stringify(t.title)}`,
    `state: ${t.state}`,
    `hold: ${t.hold ?? ''}`,
    `role: ${t.currentRole ?? ''}`,
    `actor: ${t.currentActor ?? ''}`,
    `parent: ${t.parentId ?? ''}`,
    `priority: ${t.priority ?? ''}`,
    `updated_at: ${t.updatedAt}`,
    '---',
    '',
    `# ${t.title}`,
    '',
    `**${(t.parentId === null ? PROJECT_STATE_NAME[t.state] : STATE_NAME[t.state]) ?? t.state}**${t.hold ? ` · ${HOLD_NAME[t.hold]}` : ''}${t.currentActor ? ` · 在 ${t.currentActor} 手里` : ''}`,
    '',
  ];

  if (t.goal || t.planMd || pkg.inputs.depOutputs.length) {
    lines.push('## 任务内容', '');
    if (t.goal) lines.push(`**目标:** ${t.goal}`, '');
    if (t.planMd) lines.push('**计划:**', '', t.planMd, '');
    if (pkg.inputs.depOutputs.length) {
      lines.push('**依赖的产出:**');
      for (const d of pkg.inputs.depOutputs) {
        lines.push(`- ${d.title}(${d.taskId}): ${d.summary ?? '(无摘要)'}`);
      }
      lines.push('');
    }
  }

  if (t.outputsMd || t.summary) {
    lines.push('## 做出了什么', '');
    if (t.outputsMd) lines.push(t.outputsMd, '');
    if (t.summary) lines.push(`**摘要:** ${t.summary}`, '');
  }

  if (pkg.clarifications.length) {
    lines.push('## 问题(待确认)', '');
    for (const c of pkg.clarifications) {
      const q = c.title.replace(/^待确认:\s*/, '');
      lines.push(`- [${c.state === 'done' ? 'x' : ' '}] ${q}(${c.id})${c.summary ? ` —— 答复: ${c.summary}` : ''}`);
    }
    lines.push('');
  }

  // 问题卡不在子任务里重复列(它已在「问题」一节)
  const clarIds = new Set(pkg.clarifications.map((c) => c.id));
  const realSubtasks = pkg.subtasks.filter((s) => !clarIds.has(s.id));
  if (realSubtasks.length) {
    lines.push('## 子任务', '');
    for (const s of realSubtasks) {
      lines.push(`- [${s.state === 'done' ? 'x' : ' '}] ${s.title}(${s.id}) · ${STATE_NAME[s.state] ?? s.state}${s.hold ? ` · ${HOLD_NAME[s.hold]}` : ''}`);
    }
    lines.push('');
  }

  // 关系边说人话(clarifies 已由「问题」一节承载, 这里只列依赖)
  const depsOut = pkg.edges.out.filter((e) => e.type === 'depends_on');
  const depsIn = pkg.edges.in.filter((e) => e.type === 'depends_on');
  if (depsOut.length || depsIn.length) {
    lines.push('## 关系', '');
    for (const e of depsOut) lines.push(`- 本任务依赖 ${e.peerTitle}(${e.toTask})`);
    for (const e of depsIn) lines.push(`- ${e.peerTitle}(${e.fromTask}) 依赖本任务`);
    lines.push('');
  }

  lines.push('## 经过', '');
  for (const ev of pkg.thread) lines.push(eventLine(ev));
  lines.push('');

  return lines.join('\n');
}
