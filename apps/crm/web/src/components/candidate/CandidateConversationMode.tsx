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
  ScanSearch,
  Send,
  Sparkles,
  Square,
  User,
} from 'lucide-react';
import { crmStream } from '../../api.js';
import { useCandidateChatContext, type CeoChatMessage } from '../../hooks/use-api.js';
import { showToast } from '../../stores/toast.js';
import { journeyBadgeClass, journeyLabel } from '../../lib/leadJourney.js';
import { cn } from '../../lib/utils.js';

interface ResolvedCandidate {
  id: string;
  name: string;
  leadNumber: string | null;
  matchMethod: string;
  confidence: 'high' | 'medium' | 'low';
}

function messageId() {
  return `candidate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CandidateConversationMode({ onBack }: { onBack: () => void }) {
  const [resolvedCandidate, setResolvedCandidate] = useState<ResolvedCandidate | null>(null);
  const [replyOnly, setReplyOnly] = useState(true);
  const [messages, setMessages] = useState<CeoChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const context = useCandidateChatContext(resolvedCandidate?.id ?? null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamStatus]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages]
  );

  const startNewPaste = () => {
    abortRef.current?.abort();
    setResolvedCandidate(null);
    setMessages([]);
    setInput('');
    setError(null);
    setStreamStatus('');
  };

  const sendMessage = async (request: string) => {
    const trimmed = request.trim();
    if (!trimmed || isStreaming) return;

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
    setStreamStatus(
      resolvedCandidate
        ? 'Loading verified CRM context…'
        : 'Identifying the candidate and matching the CRM lead…'
    );

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await crmStream('/api/candidate-chat', {
        method: 'POST',
        body: JSON.stringify({
          leadId: resolvedCandidate?.id,
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
            lead?: {
              id: string;
              name: string;
              leadNumber: string | null;
            };
            resolution?: {
              matchMethod: string;
              confidence: 'high' | 'medium' | 'low';
            };
          };
          if (event.type === 'ready') {
            if (event.lead) {
              setResolvedCandidate({
                ...event.lead,
                matchMethod: event.resolution?.matchMethod ?? 'provided_lead',
                confidence: event.resolution?.confidence ?? 'high',
              });
            }
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
              Paste the conversation · AI finds the lead and loads their CRM history
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
            onClick={startNewPaste}
            disabled={isStreaming || (!resolvedCandidate && messages.length === 0)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            New paste
          </button>
        </div>
      </div>

      {resolvedCandidate && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  <Check size={12} />
                  Matched automatically
                </div>
                <span className="font-semibold text-slate-950">{resolvedCandidate.name}</span>
                {resolvedCandidate.leadNumber && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    {resolvedCandidate.leadNumber}
                  </span>
                )}
                {context.data && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      journeyBadgeClass(context.data.lead.journeyStage)
                    )}
                  >
                    {journeyLabel(context.data.lead.journeyStage)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {context.data?.lead.headline || 'Loading verified profile…'}
              </p>
            </div>
            <div className="text-xs text-emerald-700">
              {resolvedCandidate.confidence} confidence ·{' '}
              {resolvedCandidate.matchMethod.replaceAll('_', ' ')}
            </div>
          </div>

          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
            {context.isLoading ? (
              <div className="col-span-full flex items-center text-xs text-slate-400">
                <Loader2 size={13} className="mr-2 animate-spin" />
                Fetching profile, assessment, and past conversations…
              </div>
            ) : context.data ? (
              <>
                <div className="rounded-lg bg-blue-50 px-3 py-2">
                  <div className="text-lg font-semibold text-blue-800">
                    {context.data.context.linkedinMessages}
                  </div>
                  <div className="text-[10px] text-blue-600">Past messages loaded</div>
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
              </>
            ) : (
              <div className="col-span-full text-xs text-red-600">
                The lead matched, but its detailed context could not be displayed.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-2xl bg-violet-50 p-4 text-violet-600">
              <ScanSearch size={34} />
            </div>
            <h2 className="text-xl font-semibold text-slate-800">
              Paste the LinkedIn conversation
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Include the participant header or candidate name. The resolver identifies who you are
              speaking with, finds the CRM lead, loads their captured profile and previous messages,
              and drafts the next response.
            </p>
            <div className="mt-5 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <Database size={14} />
              No lead search or manual selection required
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
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {message.content}
                    </p>
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
          placeholder={
            resolvedCandidate
              ? 'Paste their next message or ask for a revised reply…'
              : 'Paste the full LinkedIn conversation here, including the candidate name…'
          }
          rows={5}
          maxLength={20_000}
          disabled={isStreaming}
          className="w-full resize-y bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-400 disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-slate-400">
            {replyOnly ? 'One copy-ready reply only' : 'Recommended reply with concise strategy'}
            {latestAssistant && ' · drafts are never marked as sent'}
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
              disabled={!input.trim()}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              {resolvedCandidate ? <Sparkles size={15} /> : <ScanSearch size={15} />}
              {resolvedCandidate ? 'Draft reply' : 'Find lead & draft'}
              <Send size={14} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
