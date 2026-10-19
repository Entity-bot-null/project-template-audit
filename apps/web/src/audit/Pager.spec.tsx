import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CursorPager, OffsetPager } from './Pager';

const button = (name: string) => screen.getByRole('button', { name });

describe('OffsetPager', () => {
  function show(total: number, offset: number, limit = 20) {
    const onChange = vi.fn<(offset: number) => void>();
    const { container } = render(
      <OffsetPager total={total} limit={limit} offset={offset} onChange={onChange} />,
    );
    return { container, onChange, user: userEvent.setup() };
  }

  it('shows nothing for an empty list', () => {
    const { container } = show(0, 0);
    expect(container).toBeEmptyDOMElement();
  });

  it('on the first page, offers the next one only', async () => {
    const { onChange, user } = show(45, 0);
    expect(screen.getByRole('navigation', { name: 'Pages' })).toHaveTextContent('1–20 of 45');
    expect(button('Previous')).toBeDisabled();
    await user.click(button('Next'));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('in the middle, goes either way', async () => {
    const { onChange, user } = show(45, 20);
    expect(screen.getByText('21–40 of 45')).toBeInTheDocument();
    await user.click(button('Previous'));
    await user.click(button('Next'));
    expect(onChange.mock.calls).toEqual([[0], [40]]);
  });

  it('on the last page, offers the previous one only', async () => {
    const { onChange, user } = show(45, 40);
    expect(screen.getByText('41–45 of 45')).toBeInTheDocument();
    expect(button('Next')).toBeDisabled();
    await user.click(button('Previous'));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('never goes back before the start, and writes large numbers grouped', async () => {
    const { onChange, user } = show(12345, 10, 1000);
    expect(screen.getByText('11–1,010 of 12,345')).toBeInTheDocument();
    await user.click(button('Previous'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('shows a single page with both buttons off', () => {
    show(3, 0);
    expect(screen.getByText('1–3 of 3')).toBeInTheDocument();
    expect(button('Previous')).toBeDisabled();
    expect(button('Next')).toBeDisabled();
  });
});

describe('CursorPager', () => {
  function show(nextCursor: string | null, atNewest: boolean) {
    const onOlder = vi.fn<(cursor: string) => void>();
    const onNewest = vi.fn<() => void>();
    const { container } = render(
      <CursorPager
        nextCursor={nextCursor}
        atNewest={atNewest}
        onOlder={onOlder}
        onNewest={onNewest}
      />,
    );
    return { container, onOlder, onNewest, user: userEvent.setup() };
  }

  it('shows nothing when everything fits on the newest page', () => {
    const { container } = show(null, true);
    expect(container).toBeEmptyDOMElement();
  });

  it('on the newest page, offers older items with the cursor', async () => {
    const { onOlder, onNewest, user } = show('cursor-2', true);
    expect(button('Newest')).toBeDisabled();
    await user.click(button('Older'));
    expect(onOlder).toHaveBeenCalledWith('cursor-2');
    expect(onNewest).not.toHaveBeenCalled();
  });

  it('on the oldest page, offers the way back to the newest', async () => {
    const { onOlder, onNewest, user } = show(null, false);
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    expect(button('Older')).toBeDisabled();
    await user.click(button('Newest'));
    expect(onNewest).toHaveBeenCalledOnce();
    expect(onOlder).not.toHaveBeenCalled();
  });

  it('in between, goes either way', async () => {
    const { onOlder, onNewest, user } = show('cursor-3', false);
    await user.click(button('Newest'));
    await user.click(button('Older'));
    expect(onNewest).toHaveBeenCalledOnce();
    expect(onOlder).toHaveBeenCalledWith('cursor-3');
  });
});
