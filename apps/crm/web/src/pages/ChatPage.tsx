import { useState, useRef, useEffect } from 'react';
import { useChatHistory, useSendChatMessage } from '../hooks/use-api.js';
import { Send, Bot, User, Loader2 } from 'lucide-react';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const { data: history, isLoading: historyLoading } = useChatHistory();
  const sendMutation = useSendChatMessage();
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = history?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendMutation.isPending) return;
    sendMutation.mutate(input.trim(), {
      onSuccess: () => setInput(''),
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">AI Assistant</h1>
        <p className="text-slate-500 text-sm mt-1">
          Ask questions about your CRM data. Answers are based on records you have access to.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-4">
        {historyLoading && (
          <div className="flex items-center justify-center text-slate-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading history...
          </div>
        )}

        {messages.length === 0 && !historyLoading && (
          <div className="text-center text-slate-400 py-12">
            <Bot size={40} className="mx-auto mb-3" />
            <p className="text-lg font-medium">No messages yet</p>
            <p className="text-sm">Ask a question about your leads, contacts, companies, or opportunities.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-800'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {sendMutation.isPending && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <Bot size={16} />
            </div>
            <div className="bg-slate-100 rounded-lg px-4 py-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your CRM data..."
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={sendMutation.isPending}
        />
        <button
          type="submit"
          disabled={sendMutation.isPending || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Send size={16} />
          Send
        </button>
      </form>
    </div>
  );
}
