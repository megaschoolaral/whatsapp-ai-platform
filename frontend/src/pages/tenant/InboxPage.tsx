import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Conversation {
  id: string;
  contactIdentifier: string;
  contactName: string | null;
  status: 'ai_active' | 'human_active' | 'awaiting_human' | 'resolved';
  lastMessageAt: string;
  unreadCount: number;
}

interface Message {
  id: string;
  direction: 'incoming' | 'outgoing';
  sentBy: string;
  content: string | null;
  transcribedText: string | null;
  mediaType: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<Conversation['status'], string> = {
  awaiting_human: 'нужен оператор',
  human_active: 'оператор',
  ai_active: 'AI',
  resolved: 'решён',
};

export function InboxPage() {
  const token = useAuthStore((s) => s.token);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [reply, setReply] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    const data = await apiRequest<Conversation[]>('/tenant/conversations', {
      query: statusFilter ? { status: statusFilter } : {},
    });
    setConversations(data);
  };
  const loadMessages = async (id: string) => {
    const res = await apiRequest<{ conversation: Conversation; messages: Message[] }>(
      `/tenant/conversations/${id}/messages`,
    );
    setActiveConv(res.conversation);
    setMessages(res.messages);
  };

  useEffect(() => {
    loadConversations();
    if (!token || !tenantId) return;
    const sock = connectSocket(token, tenantId);
    sock.on('message:new', (payload: { conversationId: string }) => {
      loadConversations();
      if (activeId === payload.conversationId) loadMessages(payload.conversationId);
    });
    sock.on('conversation:updated', () => loadConversations());
    return () => disconnectSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tenantId, statusFilter]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
  }, [activeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendReply = async () => {
    if (!activeId || !reply.trim()) return;
    try {
      await apiRequest(`/tenant/conversations/${activeId}/reply`, {
        method: 'POST',
        body: { text: reply.trim() },
      });
      setReply('');
      await loadMessages(activeId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const takeOver = async () => {
    if (!activeId) return;
    await apiRequest(`/tenant/conversations/${activeId}/take-over`, { method: 'POST' });
    await loadMessages(activeId);
    await loadConversations();
  };
  const returnToAi = async () => {
    if (!activeId) return;
    await apiRequest(`/tenant/conversations/${activeId}/return-to-ai`, { method: 'POST' });
    await loadMessages(activeId);
    await loadConversations();
  };
  const resolve = async () => {
    if (!activeId) return;
    await apiRequest(`/tenant/conversations/${activeId}/resolve`, { method: 'POST' });
    await loadMessages(activeId);
    await loadConversations();
  };

  // Layout: on md+ side-by-side. On mobile show only one panel at a time.
  // Use available viewport: header (3.5rem) + page padding (~2rem).
  const containerHeight = 'h-[calc(100vh-7rem)]';

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4', containerHeight)}>
      {/* List panel */}
      <div
        className={cn(
          'md:col-span-4 border rounded-lg bg-white overflow-hidden flex flex-col',
          activeId ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="p-2 sm:p-3 border-b flex items-center gap-2">
          <select
            className="h-9 rounded border px-2 text-sm flex-1 min-w-0"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Все</option>
            <option value="awaiting_human">Нужен оператор</option>
            <option value="human_active">Оператор ведёт</option>
            <option value="ai_active">AI</option>
            <option value="resolved">Решены</option>
          </select>
          <Button size="sm" variant="outline" onClick={loadConversations}>
            ↻
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {conversations.length === 0 && <div className="p-4 text-slate-500 text-sm">Нет разговоров</div>}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                'w-full text-left border-b p-3 hover:bg-slate-50 transition-colors',
                activeId === c.id && 'bg-slate-100',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium truncate text-sm">{c.contactName ?? c.contactIdentifier}</div>
                <Badge
                  variant={
                    c.status === 'awaiting_human'
                      ? 'danger'
                      : c.status === 'human_active'
                        ? 'warning'
                        : c.status === 'ai_active'
                          ? 'success'
                          : 'default'
                  }
                  className="shrink-0"
                >
                  {STATUS_LABEL[c.status]}
                </Badge>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {new Date(c.lastMessageAt).toLocaleString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat panel */}
      <div
        className={cn(
          'md:col-span-8 border rounded-lg bg-white flex-col',
          activeId ? 'flex' : 'hidden md:flex',
        )}
      >
        {!activeConv ? (
          <div className="m-auto text-slate-500 hidden md:block">Выберите разговор</div>
        ) : (
          <>
            <div className="p-2 sm:p-3 border-b flex items-center gap-2">
              {/* Back button — mobile only */}
              <button
                type="button"
                className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 hover:bg-slate-50 shrink-0"
                onClick={() => setActiveId(null)}
                aria-label="Назад"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate text-sm sm:text-base">
                  {activeConv.contactName ?? activeConv.contactIdentifier}
                </div>
                <div className="text-xs text-slate-500 truncate">{activeConv.contactIdentifier}</div>
              </div>
              <div className="flex gap-1 sm:gap-2 shrink-0">
                {activeConv.status !== 'human_active' ? (
                  <Button size="sm" variant="outline" onClick={takeOver}>
                    Взять
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={returnToAi}>
                    AI
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={resolve}>
                  ✓
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 sm:p-4 space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'max-w-[85%] sm:max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                    m.direction === 'outgoing' ? 'ml-auto bg-emerald-100' : 'mr-auto bg-slate-100',
                  )}
                >
                  <div>{m.transcribedText ?? m.content ?? `[${m.mediaType ?? 'media'}]`}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {m.sentBy === 'ai' ? 'AI' : m.sentBy === 'customer' ? 'клиент' : 'оператор'} ·{' '}
                    {new Date(m.createdAt).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t p-2 sm:p-3 flex gap-2">
              <Input
                placeholder="Сообщение..."
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
              />
              <Button onClick={sendReply}>Отправить</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
