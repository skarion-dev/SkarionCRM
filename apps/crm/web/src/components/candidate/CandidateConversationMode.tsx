import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Database,
  GraduationCap,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
} from 'lucide-react';
import { crmStream, type Lead } from '../../api.js';
import {
  useCandidateChatContext,
  useCandidateChatHistory,
  useClearCandidateChatHistory,
  useLeads,
  type CeoChatMessage,
} from '../../hooks/use-api.js';
import { showToast } from '../../stores/toast.js';
import { journeyBadgeClass, journeyLabel } from '../../lib/leadJourney.js';
import { cn } from '../../lib/utils.js';

const SUGGESTIONS = [
  'Draft a reply to the latest candidate message.',
  'Ask what roles they are targeting and how the search is going.',
  'Respond to their objection without sounding pushy.',
  'Move this conversation forward by one natural step.',
];

function messageId() {
  return `candidate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CandidateConversationMode({ onBack }: { onBack: () => void }) {
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [replyOnly, setReplyOnly] = useState(true);
  const [messages, setMessages] = useState<CeoChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initializedLeadRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const leadResults = useLeads(
    1,
    8,
    undefined,
    leadSearch.trim() || undefined,
    undefined,
    'updatedAt',
    'desc'
  );
  const context = useCandidateChatContext(selectedLead?.id ?? null);
  const history = useCandidateChatHistory(selectedLead?.id ?? null);
  const clearHistory = useClearCandidateChatHistory(selectedLead?.id ?? null);

  useEffect(() => {
    if (!selectedLead) {
      initializedLeadRef.current = null;
      setMessages([]);
      return;
    }
    if (history.data?.messages && initializedLeadRef.current !== selectedLead.id) {
      initializedLeadRef.current = selectedLead.id;
      setMessages(history.data.messages);
    }
  }, [history.data, selectedLead]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamStatus]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages]
  );
  const results = leadResults.data?.leads ?? [];
  const showResults = !selectedLead && (leadSearch.trim().length > 0 || results.length > 0);

  const chooseLead = (lead: Lead) => {
    abortRef.current?.abort();
    initializedLeadRef.current = null;
    setSelectedLead(lead);
    setLeadSearch('');
    setMessages([]);
    setInput('');
    setError(null);
  };

  const clearSelectedLead = () => {
    abortRef.current?.abort();
    initializedLeadRef.current = null;
    setSelectedLead(null);
    setMessages([]);
    setInput('');
    setError(null);
    setLeadSearch('');
  };

  const sendMessage = async (request: string) => {
    const trimmed = request.trim();
    if (!trimmed || !selectedLead || isStreaming) return;

    const userMessage: CeoChatMessage = {
      id: messageId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    const assistantId = messageId();
    const assistantMessage: CeoChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput('');
    setError(null);
    setIsStreaming(true);
    setStreamStatus('Loading verified lead and conversation context…');

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await crmStream('/api/candidate-chat', {
        method: 'POST',
        body: JSON.stringify({
          leadId: selectedLead.id,
          message: trimmed,
          outputMode: replyOnly ? 'reply_only' : 'coach',
        }),
        signal: controller.signal,
      });
      if (!response.body) throw new Error('The server did not return a response stream.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const block of events) {
          const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(5).trim()) as {
            type: 'ready' | 'delta' | 'done' | 'error';
            delta?: string;
            error?: string;
            id?: string;
            createdAt?: string;
          };
          if (event.type === 'ready') {
            setStreamStatus(replyOnly ? 'Drafting one copy-ready reply…' : 'Preparing strategy…');
          } else if (event.type === 'delta' && event.delta) {
            setStreamStatus(replyOnly ? 'Finalizing reply…' : 'Streaming guidance…');
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + event.delta }
                  : message
              )
            );
          } else if (event.type === 'done') {
            finished = true;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      id: event.id ?? message.id,
                      createdAt: event.createdAt ?? message.createdAt,
                    }
                  : message
              )
            );
          } else if (event.type === 'error') {
            throw new Error(event.error || 'Could not draft the candidate reply.');
          }
        }
        if (done) finished = true;
      }
      void context.refetch();
    } catch (caught) {
      const message = controller.signal.aborted
        ? 'Generation stopped.'
        : caught instanceof Error
          ? caught.message
          : 'Could not draft the candidate reply.';
      setError(message);
      setMessages((current) =>
        current.filter((item) => item.id !== assistantId || item.content.length > 0)
      );
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setStreamStatus('');
    }
  };

  const copyDraft = async (message: CeoChatMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    showToast('Reply copied', 'success');
    window.setTimeout(
      () => setCopiedId((current) => (current === message.id ? null : current)),
      1500
    );
  };

  const clear = () => {
    if (!selectedLead || !window.confirm(`Clear drafting history for ${selectedLead.firstName}?`)) {
      return;
    }
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        initializedLeadRef.current = selectedLead.id;
        setMessages([]);
        setError(null);
        showToast('Candidate drafting history cleared', 'success');
      },
      onError: (caught) =>
        showToast(caught instanceof Error ? caught.message : 'Could not clear history', 'error'),
    });
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-6xl flex-col">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            title="Back to Reporting CEO"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="rounded-lg bg-violet-600 p-2 text-white">
            <MessageSquareText size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Candidate replies</h1>
            <p className="text-sm text-slate-500">
              Verified profile + imported conversation history · drafts are never marked as sent
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-xs">
            <button
              type="button"
              onClick={() => setReplyOnly(true)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium',
                replyOnly ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              Reply only
            </button>
            <button
              type="button"
              onClick={() => setReplyOnly(false)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium',
                !replyOnly ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              Strategy + reply
            </button>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={
              !selectedLead || isStreaming || clearHistory.isPending || messages.length === 0
            }
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            {clearHistory.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Trash2 size={15} />
            )}
            New thread
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {selectedLead ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-950">
                  {selectedLead.firstName} {selectedLead.lastName}
                </span>
                {selectedLead.leadNumber && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    {selectedLead.leadNumber}
                  </span>
                )}
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    journeyBadgeClass(selectedLead.journeyStage)
                  )}
                >
                  {journeyLabel(selectedLead.journeyStage)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {selectedLead.headline || selectedLead.currentRole || 'No profile headline'}
              </p>
            </div>
            <button
              type="button"
              onClick={clearSelectedLead}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Change lead
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={leadSearch}
              onChange={(event) => setLeadSearch(event.target.value)}
              placeholder="Find a lead by name, lead number, company, or LinkedIn…"
              className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400"
            />
            {showResults && (
              <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {leadResults.isFetching && results.length === 0 ? (
                  <div className="flex items-center justify-center p-5 text-sm text-slate-400">
                    <Loader2 size={15} className="mr-2 animate-spin" />
                    Finding leads…
                  </div>
                ) : results.length ? (
                  results.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => chooseLead(lead)}
                      className="flex w-full items-start justify-between gap-3 rounded-lg p-3 text-left hover:bg-blue-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {lead.firstName} {lead.lastName}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {lead.headline || lead.currentRole || lead.companyName || 'No headline'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-slate-400">
                        {lead.leadNumber}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="p-5 text-center text-sm text-slate-400">No matching leads</div>
                )}
              </div>
            )}
          </div>
        )}

        {selectedLead && (
          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
            {context.isLoading ? (
              <div className="col-span-full flex items-center text-xs text-slate-400">
                <Loader2 size={13} className="mr-2 animate-spin" />
                Fetching verified profile and past conversation…
              </div>
            ) : context.data ? (
              <>
                <div className="rounded-lg bg-blue-50 px-3 py-2">
                  <div className="text-lg font-semibold text-blue-800">
                    {context.data.context.linkedinMessages}
                  </div>
                  <div className="text-[10px] text-blue-600">LinkedIn messages loaded</div>
                </div>
                <div className="rounded-lg bg-emerald-50 px-3 py-2">
                  <div className="text-lg font-semibold text-emerald-800">
                    {context.data.context.activities}
                  </div>
                  <div className="text-[10px] text-emerald-600">CRM activities loaded</div>
                </div>
                <div className="rounded-lg bg-violet-50 px-3 py-2">
                  <div className="text-lg font-semibold text-violet-800">
                    {context.data.lead.aiScore ?? '—'}
                  </div>
                  <div className="text-[10px] text-violet-600">Lead score</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <GraduationCap size={13} />
                    {context.data.lead.mostRecentDegree || 'Degree unavailable'}
                  </div>
                  <div className="mt-1 truncate text-[10px] text-slate-500">
                    {context.data.lead.mostRecentSchool || 'School unavailable'}
                  </div>
                </div>
                {context.data.context.latestMessage && (
                  <div className="col-span-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <Database size={11} />
                      Latest imported {context.data.context.latestMessage.direction} message
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {context.data.context.latestMessage.content}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="col-span-full text-xs text-red-600">
                Could not load the selected lead context.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!selectedLead ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-2xl bg-violet-50 p-4 text-violet-600">
              <Search size={32} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Choose the candidate first</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
              The agent will fetch that lead's profile, AI assessment, outreach state, and imported
              message history before writing anything.
            </p>
          </div>
        ) : history.isLoading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            <Loader2 size={18} className="mr-2 animate-spin" />
            Loading this lead's drafting history…
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-2xl bg-violet-50 p-4 text-violet-600">
              <Sparkles size={32} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">
              Draft the next message for {selectedLead.firstName}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Reply-only mode returns one message and nothing else. Switch to strategy mode only
              when you want the reasoning too.
            </p>
            <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void sendMessage(suggestion)}
                  disabled={context.isLoading}
                  className="rounded-xl border border-slate-200 p-3 text-left text-sm text-slate-700 hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-4 sm:p-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex gap-3', message.role === 'user' && 'flex-row-reverse')}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    message.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-violet-100 text-violet-700'
                  )}
                >
                  {message.role === 'user' ? <User size={17} /> : <Bot size={17} />}
                </div>
                <div
                  className={cn(
                    'group relative text-sm',
                    message.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-3 text-white'
                      : 'min-w-0 max-w-[92%] flex-1 rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-slate-800'
                  )}
                >
                  {message.role === 'assistant' ? (
                    message.content ? (
                      <>
                        <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                        <button
                          type="button"
                          onClick={() => void copyDraft(message)}
                          title="Copy reply"
                          className="absolute right-2 top-2 rounded-md p-2 text-slate-400 hover:bg-white hover:text-slate-700"
                        >
                          {copiedId === message.id ? (
                            <Check size={15} className="text-emerald-600" />
                          ) : (
                            <Copy size={15} />
                          )}
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 py-1 text-slate-500">
                        <Loader2 size={15} className="animate-spin" />
                        {streamStatus || 'Preparing reply…'}
                      </div>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
            {error && (
              <div className="mx-auto flex max-w-2xl items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage(input);
        }}
        className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage(input);
            }
          }}
          placeholder={
            selectedLead
              ? 'Paste their newest message, or ask for the next reply…'
              : 'Choose a lead before drafting…'
          }
          rows={2}
          maxLength={8_000}
          disabled={!selectedLead || isStreaming}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-400 disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-slate-400">
            {replyOnly ? 'One copy-ready reply only' : 'Recommended reply with concise strategy'}
            {latestAssistant && ' · drafting history saved'}
          </div>
          {isStreaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              <Square size={14} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!selectedLead || !input.trim() || context.isLoading}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              <Send size={15} />
              Draft reply
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
