const STATE_ATTR = 'data-feature-loading-state';

function getContainer() {
  let el = document.querySelector(`[${STATE_ATTR}]`);
  if (el) return el;
  el = document.createElement('div');
  el.setAttribute(STATE_ATTR, '');
  Object.assign(el.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    zIndex: '12000',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    pointerEvents: 'none'
  });
  document.body.appendChild(el);
  return el;
}

export function showFeatureLoading(label) {
  if (typeof document === 'undefined') return () => {};
  const container = getContainer();
  const chip = document.createElement('div');
  chip.textContent = `${label}…`;
  Object.assign(chip.style, {
    background: 'rgba(8, 12, 22, 0.82)',
    color: '#f3f6ff',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '999px',
    fontSize: '12px',
    padding: '6px 10px',
    letterSpacing: '0.01em'
  });
  container.appendChild(chip);
  return () => {
    chip.remove();
    if (!container.childElementCount) {
      container.remove();
    }
  };
}
