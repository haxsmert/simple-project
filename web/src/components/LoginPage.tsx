import { useState } from 'react';
import { api, ApiError } from '../api';

// 登录页(2026-08-21 用户否掉浏览器原生 Basic 弹窗 —— 那是系统的模型不是产品体验):
// API 401 时整页渲染这里; 成功后由 App 走 reload 重新初载(登录是边界事件, 全量重来最干净)
export function LoginPage({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.login(user, pass);
      onDone();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : '连不上服务器, 稍后再试');
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit} aria-label="登录 Relay">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true" />
          <h1>Relay</h1>
        </div>
        <p className="login-sub">任务在人和 agent 之间接力</p>
        <label className="login-field">
          <span>账号</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label className="login-field">
          <span>密码</span>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
        </label>
        {err && <p className="login-err" role="alert">{err}</p>}
        <button className="btn primary login-btn" type="submit" disabled={busy || !user || !pass}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
