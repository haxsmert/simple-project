// 导航状态 ↔ URL(hash)编解码 —— 纯函数, 供 App 双向同步与单测。
// 为什么要接 URL(contest-v2 正面范式 #1 Jakob): 导航若只是内存状态, 浏览器后退/前进
// (按钮、鼠标侧键、触控板手势、cmd+方向键)全部失效, 刷新丢位置、无法深链/收藏。
// 用 hash 而非 pushState 路径: 静态托管零配置, 刷新/深链不需要服务端 fallback。
export type NavState = {
  view: 'board' | 'tree';
  ids: string[];          // 路径栈的任务 id 序列('all' 是"全部任务"伪节点)
  taskId: string | null;  // 打开的详情抽屉(抽屉也入历史: 后退=回到开抽屉前, 符合移动端返回键预期)
};

// #/ 项目总览 · #/tree 任务树 · #/b/R-12/R-14 钻取栈 · 任意 + ?task=R-7 抽屉
export function encodeNav(n: NavState): string {
  const base = n.view === 'tree' ? '#/tree' : n.ids.length ? `#/b/${n.ids.join('/')}` : '#/';
  return n.taskId ? `${base}?task=${encodeURIComponent(n.taskId)}` : base;
}

export function decodeNav(hash: string): NavState {
  const [pathPart, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const taskId = new URLSearchParams(query).get('task');
  const segs = pathPart.split('/').filter(Boolean);
  if (segs[0] === 'tree') return { view: 'tree', ids: [], taskId };
  if (segs[0] === 'b') return { view: 'board', ids: segs.slice(1).map(decodeURIComponent), taskId };
  return { view: 'board', ids: [], taskId };
}
