'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  PRISM_API_ID,
  type StudioProvider,
  type StudioSettings,
  forProvider,
  loadSettings,
  providerLabel,
  providerList,
  saveSettings,
} from './settings';
import { getCore } from './media';
import { Icon, type IconName } from './icons';
import { providerTable, type CoreProvider } from '@prism/ai-core';

interface StudioContextValue {
  settings: StudioSettings;
  updateSettings: (next: StudioSettings) => void;
  providers: StudioProvider[];
  coreProviders: StudioProvider[];
  labelFor: (id: string) => string;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used inside StudioProvider');
  return ctx;
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  // Start from the same value on server and client, then hydrate from
  // localStorage in an effect so hydration never sees divergent markup.
  const [settings, setSettings] = useState<StudioSettings>(() =>
    forProvider(PRISM_API_ID),
  );
  const [coreProviders, setCoreProviders] = useState<StudioProvider[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    let active = true;
    getCore()
      .then((core) => {
        if (!active) return;
        const table = providerTable(core) as CoreProvider[];
        setCoreProviders(
          table.map((p) => ({
            id: p.id,
            label: p.label,
            base_url: p.base_url,
            default_model: p.default_model,
            needs_key: p.needs_key,
          })),
        );
      })
      .catch(() => {
        // Fallback provider list keeps the shell usable offline.
      });
    return () => {
      active = false;
    };
  }, []);

  const updateSettings = useCallback((next: StudioSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const providers = useMemo(() => providerList(coreProviders), [coreProviders]);
  const labelFor = useCallback(
    (id: string) => providerLabel(id, coreProviders),
    [coreProviders],
  );

  return (
    <StudioContext.Provider
      value={{
        settings,
        updateSettings,
        providers,
        coreProviders,
        labelFor,
        sidebarOpen,
        setSidebarOpen,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}

interface NavItemProps {
  href?: string;
  icon: IconName;
  label: string;
  badge?: 'New' | 'Beta';
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}

function NavItem({ href, icon, label, badge, active, muted, onClick }: NavItemProps) {
  const className = [
    'studio-nav-item',
    active ? 'is-active' : '',
    muted ? 'is-muted' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <Icon name={icon} size={17} />
      <span>{label}</span>
      {badge ? (
        <span className={`studio-badge ${badge === 'New' ? 'is-new' : ''}`}>{badge}</span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className} onClick={onClick}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { settings, labelFor, sidebarOpen, setSidebarOpen } = useStudio();
  const close = () => setSidebarOpen(false);

  return (
    <>
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="studio-sidebar-backdrop"
          onClick={close}
        />
      ) : null}
      <aside className={`studio-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <Link href="/" className="studio-brand" onClick={close}>
          <span className="studio-brand-mark">P</span>
          <span>Personal Project</span>
        </Link>

        <nav className="studio-nav" aria-label="Studio">
          <NavItem href="/" icon="home" label="Home" active={pathname === '/'} onClick={close} />

          <p className="studio-nav-heading">Agents</p>
          <NavItem
            href="/chat"
            icon="message"
            label="Chat Mode"
            active={pathname === '/chat'}
            onClick={close}
          />
          <NavItem icon="clapperboard" label="Director Mode" muted />

          <p className="studio-nav-heading">Tools</p>
          <div className="studio-tool-grid">
            <NavItem icon="video" label="Video" muted />
            <NavItem
              href="/image"
              icon="image"
              label="Image"
              active={pathname === '/image'}
              onClick={close}
            />
            <NavItem icon="globe" label="World" muted />
            <NavItem icon="user" label="Character" muted />
            <NavItem icon="mic" label="Audio" muted />
            <NavItem icon="puzzle" label="Plugins" muted />
          </div>

          <p className="studio-nav-heading">Assets</p>
          <NavItem icon="folder" label="Director Projects" muted />
          <NavItem icon="briefcase" label="Character &amp; World" muted />
          <NavItem icon="tag" label="Brand kit" muted />
          <NavItem icon="film" label="Media" muted />
          <NavItem icon="workflow" label="Workflows" badge="Beta" muted />

          <p className="studio-nav-heading">Inspire</p>
          <NavItem icon="template" label="Templates" muted />
          <NavItem icon="zap" label="Arena" badge="New" muted />
        </nav>

        <div className="studio-sidebar-footer">
          <NavItem
            href="/chat"
            icon="message"
            label={`Chat · ${labelFor(settings.provider_id)}`}
            onClick={close}
          />
          <NavItem icon="language" label="Language: English" muted />
          <NavItem
            href="/settings"
            icon="settings"
            label="Settings"
            active={pathname === '/settings'}
            onClick={close}
          />
        </div>
      </aside>
    </>
  );
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, setSidebarOpen } = useStudio();
  return (
    <div className="studio-app">
      <Sidebar />
      <main className="studio-main">
        <button
          type="button"
          className="studio-mobile-menu"
          aria-label="Open navigation"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Icon name="menu" size={20} />
        </button>
        {children}
      </main>
    </div>
  );
}
