import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';

function typeCreds(user: string, pass: string) {
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: user } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: pass } });
}

beforeEach(() => vi.restoreAllMocks());

describe('LoginPage', () => {
  it('空字段不给提交(禁用而不是点了报错)', () => {
    render(<LoginPage onDone={() => {}} />);
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled();
  });

  it('密码不对: 显示后端人话, 不调 onDone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: '账号或密码不对' }) })) as any);
    const onDone = vi.fn();
    render(<LoginPage onDone={onDone} />);
    typeCreds('bianzhiwen', '猜的');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不对');
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '登录' })).not.toBeDisabled(); // 失败后能再试
  });

  it('登录成功: 调 onDone(由 App 重新初载)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })) as any);
    const onDone = vi.fn();
    render(<LoginPage onDone={onDone} />);
    typeCreds('bianzhiwen', '对的');
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const call = (fetch as any).mock.calls[0] as unknown[];
    expect(call[0]).toBe('/api/login');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ user: 'bianzhiwen', pass: '对的' });
  });
});
