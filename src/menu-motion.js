export const MENU_DURATION = 420, MAP_DURATION = 1800, TIMELINE_DURATION = 280;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), mobileLayout = matchMedia('(max-width: 760px)');
export const menuDuration = () => reducedMotion.matches ? 0 : MENU_DURATION;
export const mapDuration = () => reducedMotion.matches ? 0 : MAP_DURATION;
export const timelineDuration = () => reducedMotion.matches ? 0 : TIMELINE_DURATION;
export const easeCamera = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function overviewRightEdge(width) {
  const menu = document.getElementById('mode-menu');
  return width - (menu?.open && menu.dataset.state !== 'closing' && !mobileLayout.matches ? menu.offsetWidth : 0) - 8;
}

export function overviewPadding() {
  const menu = document.getElementById('mode-menu');
  const visible = menu?.open && menu.dataset.state !== 'closing';
  const mobile = mobileLayout.matches;
  return { top: 35 + (visible && mobile ? menu.offsetHeight : 0), bottom: 55,
    left: 45, right: (mobile ? 110 : 200) + (visible && !mobile ? menu.offsetWidth : 0) };
}
