export function openPopupDialog({
  title = '',
  message = '',
  inputLabel = '',
  inputValue = '',
  inputPlaceholder = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel'
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'build-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1800;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';

    const modal = document.createElement('div');
    modal.className = 'build-modal';
    modal.style.maxWidth = '420px';
    modal.style.width = '100%';
    modal.innerHTML = `
      <h3>${title}</h3>
      <p style="margin:0 0 10px 0;">${message}</p>
      <label style="display:block;font-weight:600;margin-bottom:6px;">${inputLabel}</label>
      <input type="text" class="settings-input" style="width:100%;margin-bottom:12px;" />
      <div class="build-modal-actions">
        <button type="button" class="build-cancel-btn" data-popup-cancel="1">${cancelText}</button>
        <button type="button" class="retro-build-btn" data-popup-confirm="1">${confirmText}</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const input = modal.querySelector('input');
    input.value = inputValue || '';
    input.placeholder = inputPlaceholder || '';
    setTimeout(() => input.focus(), 0);

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    modal.querySelector('[data-popup-cancel]')?.addEventListener('click', () => close(null));
    modal.querySelector('[data-popup-confirm]')?.addEventListener('click', () => close(input.value?.trim?.() || ''));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') close(input.value?.trim?.() || '');
      if (event.key === 'Escape') close(null);
    });
  });
}
