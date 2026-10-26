export function setupMobileCues(button) {
  let visible = true;
  try { visible = localStorage.getItem('tarumi-que-mobile-cues') !== 'hidden'; } catch { /* Preferences are optional. */ }
  const render = () => {
    document.body.classList.toggle('mobile-cues-hidden', !visible);
    button.setAttribute('aria-expanded', String(visible));
    button.setAttribute('aria-label', `次の合図を${visible ? '非表示' : '表示'}`);
    button.textContent = visible ? '非表示' : '表示';
  };
  render();
  button.addEventListener('click', () => {
    visible = !visible; render();
    try { localStorage.setItem('tarumi-que-mobile-cues', visible ? 'visible' : 'hidden'); } catch { /* Preferences are optional. */ }
  });
}
