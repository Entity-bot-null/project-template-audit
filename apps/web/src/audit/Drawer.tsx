import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A detail beside the table it was chosen from (an event's, an alert's): a
 * modal dialog, with a link to the detail's own page. The focus moves into
 * it and stays there (Tab cycles), Escape or Close ends it, and the focus
 * goes back to the button that opened it.
 */
export function Drawer({
  title,
  page,
  onClose,
  children,
}: {
  title: string;
  page: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => {
      opener?.focus();
    };
  }, []);

  function keepFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || panel.current === null) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="drawer-backdrop">
      <div
        ref={panel}
        className="drawer stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keepFocus}
      >
        <div className="drawer-header">
          <h2 id={titleId}>{title}</h2>
          <div className="actions">
            {page !== null && <Link to={page}>Open as a page</Link>}
            <button type="button" className="secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
