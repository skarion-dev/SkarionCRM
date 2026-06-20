import { useAuthStore, type AuthStore, type CrmRole } from '../../stores/auth.js';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { bootstrapAuth } from '../../api.js';
import {
  LayoutDashboard, Users, Building2, Contact, Target, CheckSquare, Settings, LogOut,
  BarChart, ChevronLeft, ChevronRight, Bell, Search, Menu, X, MessageSquare,
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s: AuthStore) => s.user);
  const isSuperadmin = user?.isSuperadmin ?? false;
  const logout = useAuthStore((s: AuthStore) => s.logout);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

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
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded hover:bg-slate-100"
            >
              <Menu size={20} />
            </button>
            <div className="hidden md:flex items-center bg-slate-100 rounded-md px-3 py-1.5 w-80">
              <Search size={16} className="text-slate-400 mr-2" />
              <input
                type="text"
                placeholder="Search leads, contacts, companies..."
                className="bg-transparent text-sm outline-none w-full placeholder:text-slate-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative p-2 rounded hover:bg-slate-100">
              <Bell size={20} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>
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
    </div>
  );
}
