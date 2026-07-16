import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectPicker } from './ProjectPicker';

const projects = [
  { id: 'P-1', title: '演示项目' },
  { id: 'P-2', title: '另一个项目' },
];

describe('ProjectPicker', () => {
  it('value 为 all 时显示"全部任务"', () => {
    render(<ProjectPicker projects={projects} value="all" onChange={vi.fn()} />);
    expect(screen.getByText('全部任务')).toBeInTheDocument();
  });

  it('点击按钮展开后显示搜索框与全部项目选项', () => {
    render(<ProjectPicker projects={projects} value="all" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByPlaceholderText('搜索项目…')).toBeInTheDocument();
    expect(screen.getByText('演示项目')).toBeInTheDocument();
    expect(screen.getByText('另一个项目')).toBeInTheDocument();
  });

  it('输入关键词过滤为匹配项', () => {
    render(<ProjectPicker projects={projects} value="all" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText('搜索项目…'), { target: { value: '演示' } });
    expect(screen.getByText('演示项目')).toBeInTheDocument();
    expect(screen.queryByText('另一个项目')).not.toBeInTheDocument();
  });

  it('点击选项时以该项目 id 调用 onChange', () => {
    const onChange = vi.fn();
    render(<ProjectPicker projects={projects} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('演示项目'));
    expect(onChange).toHaveBeenCalledWith('P-1');
  });
});
