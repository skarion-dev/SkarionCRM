import { useAuthStore, type AuthStore, type CrmRole } from '../../stores/auth.js';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { bootstrapAuth } from '../../api.js';
import {
  useSearch,
  useNotifications,
  useNotificationCount,
  useMarkNotificationRead,
  type SearchResult,
} from '../../hooks/use-api.js';
import AiWidget from '../../components/AiWidget.js';
import ToastContainer from '../ToastContainer.js';
import {
  LayoutDashboard, Users, Building2, Contact, Target, CheckSquare, Settings, LogOut,
  BarChart, ChevronLeft, ChevronRight, Bell, Search, Menu, X, MessageSquare,
  Check, Info,
} from 'lucide-react';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/', roles: ['manager', 'member'] },
  { icon: Target, label: 'Leads', path: '/leads', roles: ['manager', 'member'] },
  { icon: Contact, label: 'Contacts', path: '/contacts', roles: ['manager', 'member'] },
  { icon: Building2, label: 'Companies', path: '/companies', roles: ['manager', 'member'] },
  { icon: BarChart, label: 'Pipeline', path: '/pipeline', roles: ['manager', 'member'] },
  { icon: Users, label: 'Opportunities', path: '/opportunities', roles: ['manager', 'member'] },
  { icon: CheckSquare, label: 'Tasks', path: '/tasks', roles: ['manager', 'member'] },
  { icon: MessageSquare, label: 'AI Chat', path: '/chat', roles: ['manager', 'member'] },
  { icon: Settings, label: 'Settings', path: '/settings', roles: ['manager'] },
];

const SEARCH_ICONS: Record<SearchResult['type'], React.ComponentType<{ size: number; className?: string }>> = {
  lead: Target,
  company: Building2,
  contact: Contact,
  opportunity: Users,
};

const SEARCH_PATHS: Record<SearchResult['type'], string> = {
  lead: '/leads',
  company: '/companies',
  contact: '/contacts',
  opportunity: '/opportunities',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s: AuthStore) => s.user);
  const isSuperadmin = user?.isSuperadmin ?? false;
  const logout = useAuthStore((s: AuthStore) => s.logout);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notification state
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: searchData } = useSearch(debouncedQuery);
  const { data: notificationsData } = useNotifications();
  const { data: countData } = useNotificationCount();
  const markRead = useMarkNotificationRead();

  const searchResults = searchData?.results ?? [];
  const notifications = notificationsData?.notifications ?? [];
  const unreadCount = countData?.count ?? 0;

  useEffect(() => {
    if (!user) {
      bootstrapAuth()
        .then((authUser) => {
          if (authUser) {
            useAuthStore.getState().setUser({
              id: authUser.id,
              email: authUser.email,
              name: authUser.name,
              role: authUser.role as CrmRole,
              isSuperadmin: authUser.isSuperadmin,
            });
          } else {
            useAuthStore.getState().setLoading(false);
          }
        })
        .catch(() => useAuthStore.getState().setLoading(false));
    }
  }, [user]);

  // Debounce search query
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setSearchOpen(true);
  };

  const handleSearchFocus = () => {
    if (searchQuery.length > 0) {
      setSearchOpen(true);
    }
  };

  const handleSearchResultClick = (result: SearchResult) => {
    navigate(`${SEARCH_PATHS[result.type]}/${result.id}`);
    setSearchOpen(false);
    setSearchQuery('');
    setDebouncedQuery('');
  };

  const handleNotifClick = (id: string, read: boolean) => {
    if (!read) {
      markRead.mutate(id);
    }
  };

  const groupedResults = searchResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    const group = r.type + 's';
    if (!acc[group]) acc[group] = [];
    acc[group].push(r);
    return acc;
  }, {});

  const role = user?.role ?? '';
  const visibleNav = isSuperadmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((n) => n.roles.includes(role));

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setSearchOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static z-50 h-full bg-slate-900 text-white flex flex-col transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between h-14 px-4 border-b border-slate-700">
          {!collapsed && <span className="font-semibold text-lg">Skarion</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1 rounded hover:bg-slate-700"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1 rounded hover:bg-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => (
            <button
              key={item.path}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors hover:bg-slate-700',
                window.location.pathname === item.path && 'bg-slate-700'
              )}
            >
              <item.icon size={18} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-700">
          <button
            onClick={logout}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-slate-700 transition-colors',
              collapsed && 'justify-center'
            )}
          >
            <LogOut size={18} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 relative z-40">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded hover:bg-slate-100"
            >
              <Menu size={20} />
            </button>

            {/* Search bar */}
            <div className="relative" ref={searchRef}>
              <div className="hidden md:flex items-center bg-slate-100 rounded-md px-3 py-1.5 w-80">
                <Search size={16} className="text-slate-400 mr-2 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search leads, contacts, companies..."
                  className="bg-transparent text-sm outline-none w-full placeholder:text-slate-400"
                  value={searchQuery}
                  onChange={handleSearchInputChange}
                  onFocus={handleSearchFocus}
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setDebouncedQuery('');
                      setSearchOpen(false);
                    }}
                    className="ml-1 p-0.5 rounded hover:bg-slate-200 text-slate-400 shrink-0"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Search dropdown */}
              {searchOpen && (
                <div className="absolute top-full left-0 mt-2 w-80 md:w-96 bg-white rounded-lg shadow-xl border border-slate-200 max-h-96 overflow-y-auto">
                  {searchQuery.length < 2 && (
                    <div className="p-4 text-sm text-slate-400 text-center">
                      Type at least 2 characters to search
                    </div>
                  )}
                  {searchQuery.length >= 2 && searchResults.length === 0 && (
                    <div className="p-4 text-sm text-slate-400 text-center">
                      No results found
                    </div>
                  )}
                  {Object.entries(groupedResults).map(([group, items]) => (
                    <div key={group}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase bg-slate-50 border-b border-slate-100">
                        {group}
                      </div>
                      {items.map((result) => {
                        const Icon = SEARCH_ICONS[result.type];
                        return (
                          <button
                            key={result.id}
                            onClick={() => handleSearchResultClick(result)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors"
                          >
                            <Icon size={16} className="text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-800 truncate">{result.title}</div>
                              {result.subtitle && (
                                <div className="text-xs text-slate-500 truncate">{result.subtitle}</div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((prev) => !prev)}
                className="relative p-2 rounded hover:bg-slate-100"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] font-medium flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Notification dropdown */}
              {notifOpen && (
                <div className="absolute top-full right-0 mt-2 w-80 max-w-sm bg-white rounded-lg shadow-xl border border-slate-200 max-h-80 overflow-y-auto z-50">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-semibold">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="text-xs text-blue-600 font-medium">{unreadCount} unread</span>
                    )}
                  </div>
                  {notifications.length === 0 && (
                    <div className="p-4 text-sm text-slate-400 text-center">
                      No notifications
                    </div>
                  )}
                  <div className="divide-y divide-slate-50">
                    {notifications.map((notif) => (
                      <button
                        key={notif.id}
                        onClick={() => handleNotifClick(notif.id, notif.read)}
                        className={cn(
                          'w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50',
                          !notif.read && 'bg-blue-50/50'
                        )}
                      >
                        <div className="mt-0.5 shrink-0">
                          {notif.read ? (
                            <Check size={14} className="text-slate-400" />
                          ) : (
                            <Info size={14} className="text-blue-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn('text-sm', !notif.read ? 'font-medium text-slate-800' : 'text-slate-600')}>
                            {notif.message}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {new Date(notif.createdAt).toLocaleDateString()} {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        {!notif.read && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1.5" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
                {user?.name?.charAt(0) ?? user?.email?.charAt(0) ?? '?'}
              </div>
              <div className="hidden md:block text-sm">
                <div className="font-medium">{user?.name ?? user?.email ?? 'User'}</div>
                <div className="text-slate-500 text-xs capitalize">{role || 'Loading...'}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
      <AiWidget />
      <ToastContainer />
    </div>
  );
}
