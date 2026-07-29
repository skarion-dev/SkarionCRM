import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  BarChart3,
  Bot,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
} from 'lucide-react';
import { crmStream } from '../api.js';
import {
  useCeoChatHistory,
  useClearCeoChatHistory,
  type CeoChatMessage,
} from '../hooks/use-api.js';
import { useAuthStore } from '../stores/auth.js';
import { showToast } from '../stores/toast.js';

const CHART_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626'];
const SUGGESTIONS = [
  'Give me an executive briefing on pipeline, lead quality, and immediate risks.',
  'Create charts for leads by status, source, and outreach stage.',
  'Where are the biggest operational bottlenecks in the CRM right now?',
  'Summarize open opportunities and the actions most likely to improve conversion.',
];

interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  title: string;
  valueLabel: string;
  data: Array<{ label: string; value: number }>;
}

function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const value = JSON.parse(raw) as Partial<ChartSpec>;
    if (!value || !['bar', 'line', 'pie'].includes(value.type ?? '')) return null;
    if (typeof value.title !== 'string' || value.title.length > 120) return null;
    if (!Array.isArray(value.data) || value.data.length < 1 || value.data.length > 20) return null;
    const data = value.data.map((item) => ({
      label: String(item?.label ?? '').slice(0, 80),
      value: Number(item?.value),
    }));
    if (data.some((item) => !item.label || !Number.isFinite(item.value))) return null;
    return {
      type: value.type as ChartSpec['type'],
      title: value.title,
      valueLabel: typeof value.valueLabel === 'string' ? value.valueLabel.slice(0, 60) : 'Value',
      data,
    };
  } catch {
    return null;
  }
}

function ExecutiveChart({ spec }: { spec: ChartSpec }) {
  return (
    <div className="my-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 size={17} className="text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-800">{spec.title}</h3>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === 'pie' ? (
            <PieChart>
              <Pie
                data={spec.data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={95}
                label={({ name, percent }) =>
                  `${name} ${percent === undefined ? '' : `${Math.round(percent * 100)}%`}`
                }
              >
                {spec.data.map((entry, index) => (
                  <Cell
                    key={`${entry.label}-${index}`}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [Number(value).toLocaleString(), spec.valueLabel]} />
            </PieChart>
          ) : spec.type === 'line' ? (
            <LineChart data={spec.data} margin={{ top: 10, right: 18, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                angle={-20}
                textAnchor="end"
                height={54}
                tick={{ fontSize: 11 }}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [Number(value).toLocaleString(), spec.valueLabel]} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#2563eb"
                strokeWidth={3}
                dot={{ r: 4 }}
              />
            </LineChart>
          ) : (
            <BarChart data={spec.data} margin={{ top: 10, right: 18, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                angle={-20}
                textAnchor="end"
                height={54}
                tick={{ fontSize: 11 }}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [Number(value).toLocaleString(), spec.valueLabel]} />
              <Bar dataKey="value" fill="#2563eb" radius={[5, 5, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderInline(text: string) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-slate-200 px-1 py-0.5 text-xs">
          {token.slice(1, -1)}
        </code>
      );
    }
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) {
      return (
        <a
          key={index}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          {link[1]}
        </a>
      );
    }
    return token;
  });
}

function tableCells(line: string) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function MarkdownText({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!.trimEnd();
    if (!line.trim()) {
      index++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      const className =
        level === 1
          ? 'mb-3 mt-5 text-xl font-bold'
          : level === 2
            ? 'mb-2 mt-5 text-lg font-semibold'
            : 'mb-2 mt-4 font-semibold';
      const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      blocks.push(
        <Heading key={index} className={className}>
          {renderInline(heading[2]!)}
        </Heading>
      );
      index++;
      continue;
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*\|?\s*$/.test(lines[index + 1]!)
    ) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        rows.push(tableCells(lines[index]!));
        index++;
      }
      blocks.push(
        <div
          key={`table-${index}`}
          className="my-4 overflow-x-auto rounded-lg border border-slate-200"
        >
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {headers.map((header, cellIndex) => (
                  <th
                    key={cellIndex}
                    className="border-b border-slate-200 bg-slate-100 px-3 py-2 font-semibold"
                  >
                    {renderInline(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-b border-slate-100 px-3 py-2">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index]!.match(/^\s*[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]!);
        index++;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index]!.match(/^\s*\d+\.\s+(.+)$/);
        if (!match) break;
        items.push(match[1]!);
        index++;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]!.startsWith('> ')) {
        quote.push(lines[index]!.slice(2));
        index++;
      }
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="my-3 border-l-4 border-blue-300 bg-blue-50 px-4 py-2 text-slate-700"
        >
          {renderInline(quote.join(' '))}
        </blockquote>
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index++;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(#{1,3})\s+/.test(lines[index]!) &&
      !/^\s*[-*]\s+/.test(lines[index]!) &&
      !/^\s*\d+\.\s+/.test(lines[index]!) &&
      !lines[index]!.startsWith('> ')
    ) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    blocks.push(
      <p key={`p-${index}`} className="my-2 leading-6">
        {renderInline(paragraph.join(' '))}
      </p>
    );
  }

  return <>{blocks}</>;
}

function MarkdownReport({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  const fence = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(content)) !== null) {
    if (match.index > cursor) {
      blocks.push(
        <MarkdownText key={`text-${cursor}`} content={content.slice(cursor, match.index)} />
      );
    }
    const language = match[1];
    const raw = match[2]!.trim();
    if (language === 'chart') {
      const spec = parseChartSpec(raw);
      blocks.push(
        spec ? (
          <ExecutiveChart key={`chart-${match.index}`} spec={spec} />
        ) : (
          <div
            key={`chart-error-${match.index}`}
            className="my-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
          >
            The model returned an invalid chart definition.
          </div>
        )
      );
    } else {
      blocks.push(
        <pre
          key={`code-${match.index}`}
          className="my-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100"
        >
          <code>{raw}</code>
        </pre>
      );
    }
    cursor = fence.lastIndex;
  }

  if (cursor < content.length) {
    blocks.push(<MarkdownText key={`text-${cursor}`} content={content.slice(cursor)} />);
  }
  return <div>{blocks}</div>;
}

function messageId() {
  return `local-${crypto.randomUUID()}`;
}

export default function ReportingCeoPage() {
  const isSuperadmin = useAuthStore((state) => state.user?.isSuperadmin ?? false);
  const { data: history, isLoading: historyLoading, refetch } = useCeoChatHistory();
  const clearHistory = useClearCeoChatHistory();
  const [messages, setMessages] = useState<CeoChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initializedRef.current && history?.messages) {
      initializedRef.current = true;
      setMessages(history.messages);
    }
  }, [history]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamStatus]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages]
  );

  const sendMessage = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isStreaming || !isSuperadmin) return;

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
    setStreamStatus('Preparing verified CRM snapshot…');

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await crmStream('/api/ceo-chat', {
        method: 'POST',
        body: JSON.stringify({ message: trimmed }),
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
            setStreamStatus('Analyzing company performance…');
          } else if (event.type === 'delta' && event.delta) {
            setStreamStatus('Streaming executive report…');
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
            throw new Error(event.error || 'The Reporting CEO could not complete this report.');
          }
        }
        if (done) finished = true;
      }
      void refetch();
    } catch (caught) {
      const aborted = controller.signal.aborted;
      const message = aborted
        ? 'Generation stopped.'
        : caught instanceof Error
          ? caught.message
          : 'The Reporting CEO could not complete this report.';
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

  const handleClear = () => {
    if (!window.confirm('Clear your Reporting CEO conversation history?')) return;
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        initializedRef.current = true;
        setMessages([]);
        setError(null);
        showToast('Reporting CEO history cleared', 'success');
      },
      onError: (caught) =>
        showToast(caught instanceof Error ? caught.message : 'Could not clear history', 'error'),
    });
  };

  if (!isSuperadmin) {
    return (
      <div className="mx-auto mt-16 max-w-lg rounded-xl border border-red-200 bg-white p-8 text-center">
        <ShieldCheck size={38} className="mx-auto mb-3 text-red-500" />
        <h1 className="text-xl font-semibold">Superadmin access required</h1>
        <p className="mt-2 text-sm text-slate-500">
          Reporting CEO contains company-wide metrics and is restricted on both the page and API.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-6xl flex-col">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-blue-600 p-2 text-white">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Reporting CEO</h1>
              <p className="text-sm text-slate-500">
                Company-wide analysis from verified CRM metrics · Superadmin only
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClear}
          disabled={isStreaming || clearHistory.isPending || messages.length === 0}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clearHistory.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Trash2 size={15} />
          )}
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {historyLoading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            <Loader2 size={18} className="mr-2 animate-spin" />
            Loading executive history…
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 rounded-2xl bg-blue-50 p-4 text-blue-600">
              <BarChart3 size={34} />
            </div>
            <h2 className="text-xl font-semibold text-slate-800">Ask for the operating picture</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              This agent reads live aggregate CRM metrics, separates facts from interpretation, and
              can render verified charts directly in its response.
            </p>
            <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void sendMessage(suggestion)}
                  className="rounded-xl border border-slate-200 p-4 text-left text-sm text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 p-4 sm:p-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    message.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {message.role === 'user' ? <User size={17} /> : <Bot size={17} />}
                </div>
                <div
                  className={
                    message.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-3 text-sm text-white'
                      : 'min-w-0 max-w-[92%] flex-1 rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800'
                  }
                >
                  {message.role === 'assistant' ? (
                    message.content ? (
                      <MarkdownReport content={message.content} />
                    ) : (
                      <div className="flex items-center gap-2 py-1 text-slate-500">
                        <Loader2 size={15} className="animate-spin" />
                        {streamStatus || 'Preparing report…'}
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
          placeholder="Ask for an executive report, risk analysis, or a visual chart…"
          rows={2}
          maxLength={8_000}
          disabled={isStreaming}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-400 disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck size={13} />
            Read-only · verified CRM snapshot
            {lastAssistant && <span>· history saved</span>}
          </div>
          {isStreaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              <Square size={14} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={15} />
              Ask CEO
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
