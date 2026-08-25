import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type TaxonomyDimension } from './api.ts';
import { Login } from './pages/Login.tsx';
import { Feed } from './pages/Feed.tsx';
import { MarketLens } from './pages/MarketLens.tsx';
import { HilChecker } from './pages/HilChecker.tsx';
import { Admin } from './pages/Admin.tsx';

type TabKey = 'lens' | 'archive' | 'hil' | 'admin';

interface Tab {
  key: TabKey;
  label: string;
  permission?: string;
}

/**
 * Four sections, in the order the work is actually done: look at the market,
 * decide what belongs in it, search everything ever collected, administer.
 *
 * "This Week" is gone. It was the Market Lens with a seven-day window, and a
 * whole tab is a heavy way to express a date filter — the Lens now marks recent
 * articles in place instead. "Favorites" is gone too; the Review Queue is where
 * an article is marked as worth keeping, and two parallel ways to say so meant
 * neither was the answer to "what did we decide about this one".
 */
const TABS: Tab[] = [
  { key: 'lens', label: 'Market Lens', permission: 'articles.read' },
  { key: 'hil', label: 'Review Queue', permission: 'hil.review' },
  { key: 'archive', label: 'Archive', permission: 'articles.read' },
  { key: 'admin', label: 'Admin' },  // shown if any admin permission is held
];

const ADMIN_PERMISSIONS = ['admin.users', 'admin.roles', 'sources.manage'];

type Theme = 'light' | 'dark' | 'system';

/**
 * Dark by default, still switchable.
 *
 * The key is versioned. The previous default was "system", and the old code
 * wrote that to storage on first render — so every existing user has an
 * explicit "system" saved, and reading the old key would keep handing them the
 * old default. Bumping the key lets the new default actually reach them while
 * leaving their ability to choose intact.
 *
 * index.html reads the same key before the first paint; keep them in step.
 */
const THEME_KEY = 'theme.v2';

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) ?? 'dark',
  );

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyDimension[]>([]);
  const [tab, setTab] = useState<TabKey>('lens');
  const [booting, setBooting] = useState(true);
  const [theme, setTheme] = useTheme();

  const boot = useCallback(async () => {
    setBooting(true);
    try {
      const [user, tax] = await Promise.all([api.me(), api.taxonomy()]);
      setMe(user);
      setTaxonomy(tax.dimensions);
    } catch {
      setMe(null);   // a 401 here simply means "show the login form"
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  if (booting) {
    return <div className="login-wrap"><p className="muted">Loading…</p></div>;
  }

  if (!me) return <Login onSuccess={boot} />;

  const visible = TABS.filter((t) => {
    if (t.key === 'admin') return ADMIN_PERMISSIONS.some((p) => me.permissions.includes(p));
    return !t.permission || me.permissions.includes(t.permission);
  });

  // A user whose role lost a permission should not be stranded on a dead tab.
  const active = visible.some((t) => t.key === tab) ? tab : visible[0]?.key;

  const logout = async () => {
    await api.logout();
    setMe(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        {/* A wordmark rather than a line of text: a mark, the two letters that
            name the subject in the accent, and the rest in ordinary text. The
            aria-label keeps it one readable name for a screen reader, which the
            split spans would otherwise break into fragments. */}
        <h1 aria-label="AI Banking Market News">
          <span className="mark" aria-hidden="true" />
          <span className="wordmark">
            <span className="wordmark-ai">AI</span>{' '}
            <span className="wordmark-rest">Banking Market News</span>
          </span>
        </h1>
        <span className="spacer" />

        <label htmlFor="theme" className="who">Theme</label>
        <select
          id="theme" value={theme} style={{ padding: '3px 6px' }}
          onChange={(e) => setTheme(e.currentTarget.value as Theme)}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>

        <span className="who">
          {me.displayName || me.email}
          {me.roles.length > 0 && ` · ${me.roles.map((r) => r.name).join(', ')}`}
        </span>
        <button onClick={logout}>Sign out</button>
      </header>

      <nav className="tabs" aria-label="Sections">
        {visible.map((t) => (
          <button
            key={t.key}
            aria-current={active === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {active === 'lens' && <MarketLens taxonomy={taxonomy} />}

        {active === 'archive' && (
          <Feed
            key="archive"
            taxonomy={taxonomy}
            me={me}
            fixed={{ minRelevance: 0, includeDuplicates: true }}
            title="Archive"
            description={
              'Searching. Every AI article ever collected, with no date limit and no '
              + 'relevance floor, so a specific story can be found again months later. '
              + 'Marking an article relevant or not relevant here records the decision '
              + 'in the Review Queue, where it can be revisited and exported.'
            }
          />
        )}

        {active === 'hil' && <HilChecker taxonomy={taxonomy} me={me} />}

        {active === 'admin' && <Admin taxonomy={taxonomy} me={me} />}
      </main>
    </div>
  );
}
