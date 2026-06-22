import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  useChatHistory,
  useSendChatMessage,
  useSummarizeLead,
  useDraftOutreach,
  useScoreLead,
  useSuggestNextAction,
  useLead,
  useCompany,
  useContact,
} from '../hooks/use-api.js';
import {
  Send,
  Bot,
  User,
  Loader2,
  X,
  Sparkles,
  MessageSquare,
  Copy,
  Check,
  Target,
  Building2,
  Contact,
  Zap,
  FileText,
  BarChart3,
  ArrowRight,
} from 'lucide-react';


interface SpecialMessage {
  id: string;
  role: 'assistant';
  content: string;
  title: string;
  createdAt: string;
}

export default function AiWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const { data: history, isLoading: historyLoading } = useChatHistory();
  const sendMutation = useSendChatMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [specialMessages, setSpecialMessages] = useState<SpecialMessage[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  const leadMatch = location.pathname.match(/^\/leads\/([^/]+)$/);
  const companyMatch = location.pathname.match(/^\/companies\/([^/]+)$/);
  const contactMatch = location.pathname.match(/^\/contacts\/([^/]+)$/);

  const leadId = leadMatch?.[1] ?? '';
  const companyId = companyMatch?.[1] ?? '';
  const contactId = contactMatch?.[1] ?? '';

  const { data: leadData } = useLead(leadId, !!leadId);
  const { data: companyData } = useCompany(companyId, !!companyId);
  const { data: contactData } = useContact(contactId, !!contactId);

  const lead = leadData?.lead ?? null;
  const company = companyData?.company ?? null;
  const contact = contactData?.contact ?? null;

  const summarizeMutation = useSummarizeLead(leadId);
  const outreachMutation = useDraftOutreach(leadId);
  const scoreMutation = useScoreLead(leadId);
  const suggestMutation = useSuggestNextAction(leadId);

  const messages = history?.messages ?? [];

  useEffect(() => {
    if (isOpen) scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, specialMessages.length, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendMutation.isPending) return;
    sendMutation.mutate(input.trim(), { onSuccess: () => setInput('') });
  };

  const addSpecialMessage = useCallback((title: string, content: string) => {
    setSpecialMessages((prev) => [
      ...prev,
      {
        id: `special-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content,
        title,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const handleSummarize = () => {
    if (!lead) return;
    summarizeMutation.mutate(undefined, {
      onSuccess: (data) => addSpecialMessage('Lead Summary', data.summary),
    });
  };

  const handleDraftOutreach = () => {
    if (!lead) return;
    outreachMutation.mutate({ tone: 'professional', channel: 'email' }, {
      onSuccess: (data) => addSpecialMessage('Outreach Draft', data.draft),
    });
  };

  const handleScore = () => {
    if (!lead) return;
    scoreMutation.mutate(undefined, {
      onSuccess: (data) => addSpecialMessage(`Lead Score: ${data.score}`, data.reasoning),
    });
  };

  const handleSuggest = () => {
    if (!lead) return;
    suggestMutation.mutate(undefined, {
      onSuccess: (data) => addSpecialMessage('Suggested Next Action', data.suggestion),
    });
  };

  const quickPrompts = [
    ...(lead
      ? [
          { label: 'Summarize this lead', icon: FileText, action: handleSummarize, loading: summarizeMutation.isPending },
          { label: 'Draft outreach', icon: Zap, action: handleDraftOutreach, loading: outreachMutation.isPending },
          { label: 'Score lead', icon: BarChart3, action: handleScore, loading: scoreMutation.isPending },
          { label: 'Suggest next action', icon: ArrowRight, action: handleSuggest, loading: suggestMutation.isPending },
        ]
      : []),
    ...(company
      ? [{ label: `About ${company.name}`, icon: Building2, action: () => { setInput(`Tell me about company ${company.name}`); }, loading: false }]
      : []),
    ...(contact
      ? [{ label: `About ${contact.firstName} ${contact.lastName}`, icon: Contact, action: () => { setInput(`Tell me about contact ${contact.firstName} ${contact.lastName}`); }, loading: false }]
      : []),
    { label: 'General CRM help', icon: Bot, action: () => { setInput('How can I help you today?'); }, loading: false },
  ];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  };

  const allMessages: Array<
    | (typeof messages)[number]
    | SpecialMessage
  > = [...messages, ...specialMessages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const isLoading =
    sendMutation.isPending ||
    summarizeMutation.isPending ||
    outreachMutation.isPending ||
    scoreMutation.isPending ||
    suggestMutation.isPending;

  return (
    <>
      {/* Floating toggle button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105"
          aria-label="Open AI assistant"
        >
          <Sparkles size={24} />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
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
                onClick={() => navigate('/chat')}
                className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                title="Open full chat page"
              >
                <MessageSquare size={16} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Context badge */}
          {lead && (
            <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
              <Target size={14} className="text-blue-600" />
              <span className="text-xs text-blue-700 font-medium">
                Context: {lead.firstName} {lead.lastName}
              </span>
            </div>
          )}
          {company && !lead && (
            <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
              <Building2 size={14} className="text-blue-600" />
              <span className="text-xs text-blue-700 font-medium">Context: {company.name}</span>
            </div>
          )}
          {contact && !lead && !company && (
            <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
              <Contact size={14} className="text-blue-600" />
              <span className="text-xs text-blue-700 font-medium">
                Context: {contact.firstName} {contact.lastName}
              </span>
            </div>
          )}

          {/* Quick prompts */}
          {quickPrompts.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-100 flex gap-2 overflow-x-auto scrollbar-hide">
              {quickPrompts.slice(0, 4).map((p, i) => (
                <button
                  key={i}
                  onClick={p.action}
                  disabled={p.loading}
                  className="shrink-0 px-2.5 py-1 text-xs bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  <p.icon size={12} />
                  {p.label}
                  {p.loading && <Loader2 size={10} className="animate-spin" />}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {historyLoading && (
              <div className="flex items-center justify-center text-slate-400">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading...
              </div>
            )}

            {allMessages.length === 0 && !historyLoading && (
              <div className="text-center text-slate-400 py-8">
                <Bot size={32} className="mx-auto mb-2 text-blue-400" />
                <p className="text-sm font-medium">How can I help?</p>
                <p className="text-xs mt-1">Ask about leads, contacts, companies, or opportunities.</p>
              </div>
            )}

            {allMessages.map((msg) => {
              const isSpecial = 'title' in msg;
              return (
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
                          : isSpecial
                            ? 'bg-amber-50 text-slate-800 border border-amber-100'
                            : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {isSpecial && (
                        <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-amber-200/60">
                          <Zap size={12} className="text-amber-600" />
                          <span className="text-xs font-semibold text-amber-700">{msg.title}</span>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      {msg.role === 'assistant' && (
                        <button
                          onClick={() => handleCopy(msg.content, msg.id)}
                          className="absolute -top-2 -right-2 p-1 bg-white rounded-full shadow border border-slate-200 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Copy to clipboard"
                        >
                          {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && !historyLoading && (
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
