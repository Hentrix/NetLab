/** Client-only appearance preference. Never stores tokens or laboratory data. */
export const THEME_KEY = 'netlab-theme';
export const THEMES = Object.freeze(['light', 'dark']);
export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}
export function readTheme(storage) {
  try { return normalizeTheme(storage?.getItem(THEME_KEY)); } catch { return 'light'; }
}
export function nextTheme(current) {
  return normalizeTheme(current) === 'dark' ? 'light' : 'dark';
}
export function applyTheme(root, theme, storage) {
  const selected = normalizeTheme(theme);
  root.dataset.theme = selected;
  root.style.colorScheme = selected;
  try { storage?.setItem(THEME_KEY, selected); } catch { /* private browsing: still applies */ }
  return selected;
}
export function initThemeToggle(button, root = document.documentElement, storage = window.localStorage) {
  const sync = () => {
    const dark = root.dataset.theme === 'dark';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    button.title = dark ? 'Светлая тема' : 'Тёмная тема';
    const label = button.querySelector('.theme-toggle-label');
    if (label) label.textContent = dark ? 'Светлая' : 'Тёмная';
  };
  sync();
  button.addEventListener('click', () => {
    applyTheme(root, nextTheme(root.dataset.theme), storage);
    sync();
  });
  return sync;
}
