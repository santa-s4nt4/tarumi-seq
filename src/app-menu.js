export function setupAppMenu({ header, navigation, actions = [], mapControls = [] }) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'menu-toggle';
  toggle.setAttribute('aria-label', 'メニューを開く');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'app-menu');
  toggle.innerHTML = '<span></span><span></span><span></span>';

  const menu = document.createElement('div');
  menu.id = 'app-menu';
  menu.className = 'app-menu';
  menu.hidden = true;
  const menuHeader = document.createElement('div');
  menuHeader.className = 'app-menu-header';
  menuHeader.innerHTML = '<h2>メニュー</h2>';
  menu.append(menuHeader);

  const group = (label, className, contents) => {
    if (!contents.length) return;
    const section = document.createElement('section');
    section.className = `app-menu-group ${className}`;
    const heading = document.createElement('h2');
    heading.textContent = label;
    const content = document.createElement('div');
    content.className = `${className}-content`;
    content.append(...contents);
    section.append(heading, content);
    menu.append(section);
  };

  group('画面切替', 'app-menu-navigation', [navigation]);
  group('接続・ダイヤ', 'app-menu-actions', actions);
  group('ズーム率', 'app-menu-map', mapControls);
  header.replaceChildren(toggle, menu);

  let open = false;
  function setOpen(value) {
    open = value;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    header.classList.toggle('menu-open', open);
  }
  toggle.addEventListener('click', () => setOpen(!open));
  menu.addEventListener('click', event => {
    if (event.target.closest('.app-menu-map')) return;
    if (event.target.closest('a, button')) setOpen(false);
  });
  document.addEventListener('pointerdown', event => {
    if (open && !header.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      toggle.focus();
    }
  });
  return menu;
}
