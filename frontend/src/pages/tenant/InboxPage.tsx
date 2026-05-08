import { useEffect, useState } from 'react';
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

export function InboxPage() {
  const token = useAuthStore((s) => s.token);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [reply, setReply] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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

  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-8rem)]">
      <div className="col-span-12 md:col-span-4 border rounded-lg bg-white overflow-hidden flex flex-col">
        <div className="p-3 border-b flex items-center gap-2">
          <select
            className="h-9 rounded border px-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Все</option>
            <option value="awaiting_human">Awaiting human</option>
            <option value="human_active">Human active</option>
            <option value="ai_active">AI active</option>
            <option value="resolved">Resolved</option>
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
                'w-full text-left border-b p-3 hover:bg-slate-50',
                activeId === c.id && 'bg-slate-100',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium truncate">{c.contactName ?? c.contactIdentifier}</div>
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
                >
                  {c.status}
                </Badge>
              </div>
              <div className="text-xs text-slate-500">{new Date(c.lastMessageAt).toLocaleString('ru-RU')}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-12 md:col-span-8 border rounded-lg bg-white flex flex-col">
        {!activeConv ? (
          <div className="m-auto text-slate-500">Выберите разговор</div>
        ) : (
          <>
            <div className="p-3 border-b flex items-center justify-between">
              <div>
                <div className="font-medium">{activeConv.contactName ?? activeConv.contactIdentifier}</div>
                <div className="text-xs text-slate-500">{activeConv.contactIdentifier}</div>
              </div>
              <div className="flex gap-2">
                {activeConv.status !== 'human_active' && (
                  <Button size="sm" variant="outline" onClick={takeOver}>
                    Взять на себя
                  </Button>
                )}
                {activeConv.status === 'human_active' && (
                  <Button size="sm" variant="outline" onClick={returnToAi}>
                    Вернуть AI
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={resolve}>
                  Resolve
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                    m.direction === 'outgoing'
                      ? 'ml-auto bg-emerald-100'
                      : 'mr-auto bg-slate-100',
                  )}
                >
                  <div>{m.transcribedText ?? m.content ?? `[${m.mediaType ?? 'media'}]`}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {m.sentBy === 'ai' ? 'AI' : m.sentBy === 'customer' ? 'клиент' : 'оператор'} ·{' '}
                    {new Date(m.createdAt).toLocaleTimeString('ru-RU')}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-3 flex gap-2">
              <Input
                placeholder="Ответ оператора..."
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
