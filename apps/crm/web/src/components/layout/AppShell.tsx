import { useAuthStore, type AuthStore, type CrmRole } from '../../stores/auth.js';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { bootstrapAuth } from '../../api.js';
import { useChatHistory, useSendChatMessage } from '../../hooks/use-api.js';
import ToastContainer from '../ToastContainer.js';
import {
  LayoutDashboard, Users, Building2, Contact, Target, CheckSquare, Settings, LogOut,
  BarChart, ChevronLeft, ChevronRight, Bell, Search, Menu, X, MessageSquare,
  Sparkles, Bot, User, Send, Loader2, Check, Copy,
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
      <AiWidget />
      <ToastContainer />
    </div>
  );
}

function AiWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const { data: history, isLoading: historyLoading } = useChatHistory();
  const sendMutation = useSendChatMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const messages = history?.messages ?? [];

  useEffect(() => {
    if (open) scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendMutation.isPending) return;
    sendMutation.mutate(input.trim(), { onSuccess: () => setInput('') });
  };

  const quickPrompts = [
    { label: 'Summarize this lead', action: () => setInput('Summarize my top leads') },
    { label: 'Draft follow-up email', action: () => setInput('Draft a follow-up email template') },
    { label: 'What should I do next?', action: () => setInput('What should I focus on today?') },
    { label: 'Find missing info', action: () => setInput('Which leads are missing contact info?') },
    { label: 'Score this lead', action: () => setInput('How do I score leads effectively?') },
  ];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105"
          aria-label="Open AI assistant"
        >
          <Sparkles size={24} />
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] max-w-[calc(100vw-3rem)] h-[550px] max-h-[calc(100vh-6rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white">
                <Bot size={18} />
              </div>
              <div>
                <div className="font-medium text-sm">AI Assistant</div>
                <div className="text-xs text-slate-500">Powered by Gemini</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Quick prompts */}
          <div className="px-3 py-2 border-b border-slate-100 flex gap-2 overflow-x-auto scrollbar-hide">
            {quickPrompts.map((p, i) => (
              <button
                key={i}
                onClick={p.action}
                className="shrink-0 px-2.5 py-1 text-xs bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {historyLoading && (
              <div className="flex items-center justify-center text-slate-400">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading...
              </div>
            )}

            {messages.length === 0 && !historyLoading && (
              <div className="text-center text-slate-400 py-8">
                <Bot size={32} className="mx-auto mb-2 text-blue-400" />
                <p className="text-sm font-medium">How can I help?</p>
                <p className="text-xs mt-1">Ask about leads, contacts, companies, or opportunities.</p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                </div>
                <div className="max-w-[85%]">
                  <div
                    className={`rounded-lg px-3 py-2 text-sm relative group ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => handleCopy(msg.content)}
                        className="absolute -top-2 -right-2 p-1 bg-white rounded-full shadow border border-slate-200 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {sendMutation.isPending && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <Bot size={14} />
                </div>
                <div className="bg-slate-100 rounded-lg px-3 py-2 text-sm text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your CRM..."
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={sendMutation.isPending}
            />
            <button
              type="submit"
              disabled={sendMutation.isPending || !input.trim()}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

