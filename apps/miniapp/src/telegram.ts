type TgUser = { id: number; first_name?: string; username?: string };

type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  initDataUnsafe?: { user?: TgUser };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function applyTelegramTheme(wa?: TelegramWebApp) {
  const root = document.documentElement;
  const scheme = wa?.colorScheme === 'dark' ? 'dark' : 'light';
  root.dataset.colorScheme = scheme;

  const params = wa?.themeParams ?? {};
  const map: Record<string, string | undefined> = {
    '--tg-theme-bg-color': params.bg_color,
    '--tg-theme-text-color': params.text_color,
    '--tg-theme-hint-color': params.hint_color,
    '--tg-theme-link-color': params.link_color,
    '--tg-theme-button-color': params.button_color,
    '--tg-theme-button-text-color': params.button_text_color,
    '--tg-theme-secondary-bg-color': params.secondary_bg_color,
  };
  for (const [cssVar, value] of Object.entries(map)) {
    if (value) root.style.setProperty(cssVar, value);
  }
}

export function initTelegramWebApp(): { inTelegram: boolean; chatId: string | null } {
  const wa = window.Telegram?.WebApp;
  if (!wa) {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.colorScheme = prefersDark ? 'dark' : 'light';
    return { inTelegram: false, chatId: null };
  }
  try {
    wa.ready();
    wa.expand();
  } catch {
    /* ignore */
  }

  applyTelegramTheme(wa);
  const onTheme = () => applyTelegramTheme(wa);
  try {
    wa.onEvent?.('themeChanged', onTheme);
  } catch {
    /* ignore */
  }

  // Browser / OS dark mode outside Telegram
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!window.Telegram?.WebApp) {
        document.documentElement.dataset.colorScheme = e.matches ? 'dark' : 'light';
      }
    });
  } catch {
    /* ignore */
  }

  const id = wa.initDataUnsafe?.user?.id;
  return {
    inTelegram: true,
    chatId: id != null ? String(id) : null,
  };
}
