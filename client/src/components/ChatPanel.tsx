import React, { useState, useEffect, useRef } from 'react';
import { Send, Mic, MicOff, PhoneCall, PhoneOff, MessageSquare, Volume2 } from 'lucide-react';

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  color: string;
  text: string;
  timestamp: string;
}

interface User {
  id: string;
  username: string;
  color: string;
  cursor: { lineNumber: number; column: number } | null;
  voiceState?: { inVoice: boolean; muted: boolean };
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  users: User[];
  localUserId: string;
  inVoice: boolean;
  isMuted: boolean;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onToggleMute: () => void;
}

export default function ChatPanel({
  messages,
  onSendMessage,
  users,
  localUserId,
  inVoice,
  isMuted,
  onJoinVoice,
  onLeaveVoice,
  onToggleMute,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll message logs
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  const voiceUsers = users.filter((u) => u.voiceState?.inVoice);

  return (
    <div className="flex flex-col h-screen w-80 bg-ide-sidebar border-l border-ide-border shrink-0 select-none">
      
      {/* Voice Connection Header Bar */}
      <div className="border-b border-ide-border p-4 flex flex-col gap-3 bg-ide-sidebar">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Volume2 size={13} className={inVoice ? 'text-emerald-400' : 'text-zinc-500'} />
            <span className="text-[11px] font-bold tracking-wider uppercase">VOICE STREAM</span>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider ${inVoice ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border border-zinc-700/50'}`}>
            {inVoice ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>

        {inVoice ? (
          <div className="flex gap-2">
            <button 
              onClick={onToggleMute} 
              className={`flex-grow flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold border transition-colors cursor-pointer ${
                isMuted 
                  ? 'bg-rose-950/20 border-rose-900/30 text-rose-400 hover:bg-rose-950/40' 
                  : 'bg-ide-input hover:bg-ide-hover border-ide-border text-zinc-300'
              }`}
            >
              {isMuted ? <MicOff size={12} /> : <Mic size={12} />}
              {isMuted ? 'Muted' : 'Mute Mic'}
            </button>
            <button 
              onClick={onLeaveVoice} 
              className="px-3 py-1.5 bg-ide-input hover:bg-rose-950/20 border border-ide-border hover:border-rose-900/30 text-rose-400 rounded-md transition-colors flex items-center justify-center cursor-pointer"
              title="Disconnect Call"
            >
              <PhoneOff size={12} />
            </button>
          </div>
        ) : (
          <button 
            onClick={onJoinVoice} 
            className="w-full flex items-center justify-center gap-1.5 bg-primary-blue hover:bg-primary-hover text-white text-[13px] font-semibold py-1.5 rounded-md transition-colors cursor-pointer"
          >
            <PhoneCall size={12} />
            Join Voice Channel
          </button>
        )}

        {/* voice members drawer */}
        {voiceUsers.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-0.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Active Speakers:</span>
            <div className="flex flex-wrap gap-1.5">
              {voiceUsers.map((u) => (
                <div 
                  key={u.id} 
                  style={{ borderColor: `${u.color}20` }}
                  className="inline-flex items-center gap-1.5 bg-ide-input border px-2 py-0.5 rounded text-[11px] font-semibold text-zinc-300"
                >
                  {u.voiceState?.muted ? (
                    <MicOff size={9} className="text-rose-500" />
                  ) : (
                    <span 
                      style={{ backgroundColor: u.color, boxShadow: `0 0 5px ${u.color}` }} 
                      className="w-1 h-1 rounded-full voice-speaking-indicator" 
                    />
                  )}
                  <span style={{ color: u.color }} className="truncate max-w-[80px]">{u.username}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Messages Feed Header */}
      <div className="px-4 py-2 border-b border-ide-border bg-[#151518] flex items-center gap-2">
        <MessageSquare size={12} className="text-zinc-500" />
        <span className="text-[11px] font-bold text-zinc-400 tracking-wider uppercase">CHAT WINDOW</span>
      </div>

      {/* Messages Feed - Slack style line-by-line format */}
      <div className="flex-grow overflow-y-auto flex flex-col pr-0.5 py-2">
        {messages.length === 0 ? (
          <div className="my-auto text-center flex flex-col gap-1 text-zinc-600 text-[13px] px-4 select-none">
            <span>No messages in this workspace</span>
            <span>Type a message below to sync with team</span>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.userId === localUserId;
            return (
              <div 
                key={msg.id} 
                className="flex gap-2.5 items-start group hover:bg-ide-hover/30 px-4 py-1.5 transition-all select-text"
              >
                {/* User Avatar tag */}
                <div 
                  style={{ 
                    backgroundColor: `${msg.color}08`, 
                    borderColor: `${msg.color}35`,
                    color: msg.color
                  }}
                  className="w-7 h-7 rounded border flex items-center justify-center font-bold text-[10px] select-none shrink-0"
                >
                  {msg.username.substring(0, 2).toUpperCase()}
                </div>

                <div className="flex flex-col min-w-0 flex-grow">
                  {/* Sender Header row */}
                  <div className="flex items-baseline gap-2">
                    <span 
                      style={{ color: isSelf ? '#5b9bd5' : msg.color }}
                      className="text-[13px] font-bold"
                    >
                      {msg.username}
                      {isSelf && <span className="text-[10px] text-zinc-500 font-semibold ml-1">(You)</span>}
                    </span>
                    <span className="text-[10px] text-zinc-550 font-medium">{msg.timestamp}</span>
                  </div>

                  {/* Message body text */}
                  <div className="text-[13px] text-zinc-300 leading-normal mt-0.5 break-words font-sans">
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <form onSubmit={handleSend} className="p-4 border-t border-ide-border flex gap-2 bg-ide-sidebar">
        <input
          type="text"
          className="flex-grow bg-ide-input border border-ide-border focus:outline-none focus:border-primary-blue rounded px-3 py-1.5 text-[13px] text-zinc-250 placeholder-zinc-600 transition-colors"
          placeholder="Message room..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button 
          type="submit" 
          className="bg-primary-blue hover:bg-primary-hover text-white p-1.5 rounded transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          title="Send message"
        >
          <Send size={12} />
        </button>
      </form>
    </div>
  );
}
