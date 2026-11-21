export const MENU_DURATION = 600;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), mobileLayout = matchMedia('(max-width: 760px)');
export const menuDuration = () => reducedMotion.matches ? 0 : MENU_DURATION;

export function overviewPadding() {
  const menu = document.getElementById('mode-menu');
  const visible = menu?.open && menu.dataset.state !== 'closing';
  const mobile = mobileLayout.matches;
  return { top: 35 + (visible && mobile ? menu.offsetHeight : 0), bottom: 55,
    left: 45, right: 110 + (visible && !mobile ? menu.offsetWidth : 0) };
}
