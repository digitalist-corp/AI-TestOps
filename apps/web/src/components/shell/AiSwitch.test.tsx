import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiSwitch } from './AiSwitch';

afterEach(cleanup);

function getSwitch() {
  return screen.getByRole('switch', { name: 'AI 기능' }) as HTMLButtonElement;
}

describe('AiSwitch', () => {
  it('AI 키가 없으면(available=false) 비활성이고 클릭해도 바뀌지 않는다', () => {
    const onChange = vi.fn();
    render(<AiSwitch available={false} enabled onChange={onChange} />);

    const toggle = getSwitch();
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe('관리자가 AI 설정에서 키를 등록해야 켤 수 있습니다');

    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('켜져 있으면 aria-checked=true 이고 클릭하면 꺼짐(false)으로 바꾼다', () => {
    const onChange = vi.fn();
    render(<AiSwitch available enabled onChange={onChange} />);

    const toggle = getSwitch();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('꺼져 있으면 aria-checked=false 이고 클릭하면 켬(true)으로 바꾼다', () => {
    const onChange = vi.fn();
    render(<AiSwitch available enabled={false} onChange={onChange} />);

    const toggle = getSwitch();
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
