import './cursor.css';

// Elements over which the crosshair morphs into the green circle.
const BUTTONS = 'button:not(:disabled), a[href], [role="button"], summary, select, label, ' +
  'input[type="range"], input[type="checkbox"], input[type="radio"], .diagram-hit';

if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const root = document.documentElement;
  const cursor = document.createElement('div');
  cursor.className = 'custom-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.append(document.createElement('i'), document.createElement('i'));
  // Lives outside <body> so page code that rewrites the body does not remove it.
  root.append(cursor);

  // Modal dialogs render in the top layer, above any z-index. Keeping the
  // cursor there too (as a popover) lets it stay visible over them.
  const topLayer = typeof cursor.showPopover === 'function';
  let promotedFor = null;
  if (topLayer) { cursor.popover = 'manual'; cursor.showPopover(); }
  const promote = () => {
    if (!topLayer) return;
    const modals = document.querySelectorAll('dialog:modal');
    const modal = modals[modals.length - 1] ?? null;
    if (modal === promotedFor) return;
    promotedFor = modal;
    // Re-showing moves the cursor above a dialog opened after it.
    if (modal) { cursor.hidePopover(); cursor.showPopover(); }
  };

  root.classList.add('has-custom-cursor');

  const hide = () => cursor.classList.remove('is-visible');
  addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') { hide(); return; }
    promote();
    cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    cursor.classList.add('is-visible');
    cursor.classList.toggle('is-button', event.target instanceof Element && event.target.closest(BUTTONS) !== null);
  }, { passive: true });
  addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse') hide(); }, { passive: true });
  root.addEventListener('mouseleave', hide);
  addEventListener('blur', hide);
}
