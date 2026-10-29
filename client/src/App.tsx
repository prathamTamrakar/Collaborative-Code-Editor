import React, { useState, useEffect, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import { Share2, Users, Code, Check, Terminal, Sparkles, MessageSquare } from 'lucide-react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { Awareness } from 'y-protocols/awareness';
import * as awarenessProtocol from 'y-protocols/awareness';
import ChatPanel from './components/ChatPanel';

// Determine backend WebSocket URL with production fallback
const getSocketUrl = (): string => {
  const envUrl = import.meta.env.VITE_SOCKET_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim();
  }
  if (typeof window !== 'undefined') {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
      return 'http://localhost:5000';
    }
    return window.location.origin;
  }
  return 'http://localhost:5000';
};

const SOCKET_URL = getSocketUrl();


interface User {
  id: string;
  username: string;
  color: string;
  cursor: { lineNumber: number; column: number } | null;
  voiceState?: { inVoice: boolean; muted: boolean };
}

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  color: string;
  text: string;
  timestamp: string;
}

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'cpp', label: 'C++' },
  { value: 'markdown', label: 'Markdown' },
];

const generateRoomId = () => {
  return Math.random().toString(36).substring(2, 10);
};

export default function App() {
  const [roomId, setRoomId] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [inputName, setInputName] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);
  const [language, setLanguage] = useState<string>('javascript');
  const [copied, setCopied] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);

  // Chat & Voice states
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inVoice, setInVoice] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showChat, setShowChat] = useState<boolean>(true);

  const socketRef = useRef<Socket | null>(null);
  const editorRef = useRef<any>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  // WebRTC states
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const inVoiceRef = useRef<boolean>(false);

  useEffect(() => {
    inVoiceRef.current = inVoice;
  }, [inVoice]);

  // Load or generate Room ID from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let room = params.get('room');
    if (!room) {
      room = generateRoomId();
      const newUrl = `${window.location.pathname}?room=${room}`;
      window.history.pushState({ path: newUrl }, '', newUrl);
    }
    setRoomId(room);
  }, []);

  // WebRTC helper: peer connection creation
  const createPeerConnection = (peerId: string) => {
    if (peersRef.current.has(peerId)) {
      return peersRef.current.get(peerId)!;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('webrtc-signal', {
          targetId: peerId,
          signal: { type: 'candidate', candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`WebRTC audio track received from peer: ${peerId}`);
      let audio = peerAudiosRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        peerAudiosRef.current.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
      audio.play().catch((err) => console.error('Audio track playback failed:', err));
    };

    peersRef.current.set(peerId, pc);
    return pc;
  };

  // Initialize Sockets and Yjs syncing
  useEffect(() => {
    if (!roomId || !username) return;

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('monaco');
    ytextRef.current = ytext;

    const awareness = new Awareness(ydoc);
    awarenessRef.current = awareness;

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-room', { roomId, username });
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      console.warn(`[Socket] Disconnected: ${reason}`);
    });

    socket.on('connect_error', (err) => {
      setConnected(false);
      console.warn(`[Socket] Connection error to ${SOCKET_URL}:`, err.message);
    });

    socket.on('room-init', ({ docUpdate, language: serverLang, users: serverUsers }) => {
      Y.applyUpdate(ydoc, new Uint8Array(docUpdate), 'socket');
      setLanguage(serverLang);
      setUsers(serverUsers);

      const socketId = socket.id || '';
      const ourUser = serverUsers.find((u: any) => u.id === socketId);
      const ourColor = ourUser ? ourUser.color : '#0e639c';

      awareness.setLocalStateField('user', {
        name: username,
        color: ourColor,
        socketId: socketId,
      });
    });

    socket.on('users-update', (updatedUsers: User[]) => {
      setUsers(updatedUsers);
    });

    socket.on('yjs-update', (update: ArrayBuffer) => {
      Y.applyUpdate(ydoc, new Uint8Array(update), 'socket');
    });

    socket.on('awareness-update', (update: ArrayBuffer) => {
      awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(update), 'socket');
    });

    socket.on('language-update', ({ language: updatedLang }) => {
      setLanguage(updatedLang);
    });

    socket.on('chat-message', (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on('voice-state-update', async ({ userId, voiceState }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, voiceState } : u))
      );

      if (voiceState.inVoice && inVoiceRef.current) {
        // Settle WebRTC offer (polite/impolite peer: higher socket ID initiates)
        const socketId = socket.id || '';
        if (socketId && socketId > userId) {
          const pc = createPeerConnection(userId);
          
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
              const sender = pc.getSenders().find((s) => s.track === track);
              if (!sender) {
                pc.addTrack(track, localStreamRef.current!);
              }
            });
          }

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc-signal', {
            targetId: userId,
            signal: { type: 'offer', sdp: offer },
          });
        }
      } else if (!voiceState.inVoice) {
        const pc = peersRef.current.get(userId);
        if (pc) {
          pc.close();
          peersRef.current.delete(userId);
        }
        const audio = peerAudiosRef.current.get(userId);
        if (audio) {
          audio.srcObject = null;
          peerAudiosRef.current.delete(userId);
        }
      }
    });

    socket.on('webrtc-signal', async ({ senderId, signal }) => {
      const pc = peersRef.current.get(senderId);

      if (signal.type === 'offer') {
        const activePc = createPeerConnection(senderId);
        await activePc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
            const sender = activePc.getSenders().find((s) => s.track === track);
            if (!sender) {
              activePc.addTrack(track, localStreamRef.current!);
            }
          });
        }

        const answer = await activePc.createAnswer();
        await activePc.setLocalDescription(answer);

        socket.emit('webrtc-signal', {
          targetId: senderId,
          signal: { type: 'answer', sdp: answer },
        });
      } else if (signal.type === 'answer') {
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }
      } else if (signal.type === 'candidate') {
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch((err) => {
            console.error('Error applying ICE candidate:', err);
          });
        }
      }
    });

    ydoc.on('update', (update, origin) => {
      if (origin !== 'socket') {
        socket.emit('yjs-update', { roomId, update });
      }
    });

    awareness.on('update', () => {
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [ydoc.clientID]);
      socket.emit('awareness-update', { roomId, update });
    });

    const handleAwarenessChange = () => {
      const states = awareness.getStates();
      setUsers((prevUsers) => {
        return prevUsers.map((u) => {
          let activeState: any = null;
          for (const state of states.values()) {
            if (state.user && state.user.socketId === u.id) {
              activeState = state;
              break;
            }
          }

          if (activeState && activeState.cursor) {
            return {
              ...u,
              cursor: {
                lineNumber: activeState.cursor.lineNumber,
                column: activeState.cursor.column,
              },
            };
          }
          return { ...u, cursor: null };
        });
      });
    };

    awareness.on('change', handleAwarenessChange);

    return () => {
      socket.disconnect();
      ydoc.destroy();
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      for (const pc of peersRef.current.values()) {
        pc.close();
      }
      peersRef.current.clear();
      peerAudiosRef.current.clear();

      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [roomId, username]);

  // Handle Monaco Editor lifecycle
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    if (ytextRef.current && awarenessRef.current) {
      const binding = new MonacoBinding(
        ytextRef.current,
        editor.getModel(),
        new Set([editor]),
        awarenessRef.current
      );
      bindingRef.current = binding;

      const undoManager = new Y.UndoManager(ytextRef.current);

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.US_Z, () => {
        undoManager.undo();
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.US_Y, () => {
        undoManager.redo();
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.US_Z, () => {
        undoManager.redo();
      });

      editor.onDidChangeCursorPosition((e: any) => {
        const localUser = awarenessRef.current?.getLocalState()?.user;
        if (localUser) {
          awarenessRef.current?.setLocalStateField('cursor', {
            lineNumber: e.position.lineNumber,
            column: e.position.column,
          });
        }
      });
    }
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedLang = e.target.value;
    setLanguage(selectedLang);
    if (socketRef.current && connected) {
      socketRef.current.emit('language-change', { roomId, language: selectedLang });
    }
  };

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(window.location.href);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = window.location.href;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputName.trim()) {
      setUsername(inputName.trim());
    }
  };

  const handleSendMessage = (text: string) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('chat-message', { roomId, message: text });
    }
  };

  const handleJoinVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setInVoice(true);
      setIsMuted(false);

      const socket = socketRef.current;
      if (socket && connected) {
        socket.emit('voice-state-change', {
          roomId,
          voiceState: { inVoice: true, muted: false },
        });

        const socketId = socket.id || '';
        users.forEach(async (u) => {
          if (u.id !== socketId && u.voiceState?.inVoice) {
            if (socketId > u.id) {
              const pc = createPeerConnection(u.id);
              stream.getTracks().forEach((track) => {
                const sender = pc.getSenders().find((s) => s.track === track);
                if (!sender) {
                  pc.addTrack(track, stream);
                }
              });
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.emit('webrtc-signal', {
                targetId: u.id,
                signal: { type: 'offer', sdp: offer },
              });
            }
          }
        });
      }
    } catch (err) {
      alert('Failed to gain microphone permissions for voice channel!');
      console.error(err);
    }
  };

  const handleLeaveVoice = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    for (const pc of peersRef.current.values()) {
      pc.close();
    }
    peersRef.current.clear();
    peerAudiosRef.current.clear();

    setInVoice(false);
    setIsMuted(false);

    if (socketRef.current && connected) {
      socketRef.current.emit('voice-state-change', {
        roomId,
        voiceState: { inVoice: false, muted: false },
      });
    }
  };

  const handleToggleMute = () => {
    if (!localStreamRef.current) return;
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !newMutedState;
    });

    if (socketRef.current && connected) {
      socketRef.current.emit('voice-state-change', {
        roomId,
        voiceState: { inVoice: true, muted: newMutedState },
      });
    }
  };

  // Render Modal to ask for Name if not joined
  if (!username) {
    return (
      <div className="fixed inset-0 bg-[#0f0f11]/85 backdrop-blur-md flex items-center justify-center z-50">
        <form onSubmit={handleJoin} className="w-full max-w-sm bg-ide-sidebar border border-ide-border p-8 rounded-md flex flex-col gap-6 shadow-2xl">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary-blue p-1.5 rounded-sm text-white">
              <Code size={20} />
            </div>
            <h1 className="font-sans font-bold text-base text-zinc-100 tracking-tight">
              CoCode Workspace
            </h1>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-bold text-zinc-500 tracking-wider uppercase">
              Choose a username to join the session
            </label>
            <input
              type="text"
              className="w-full bg-[#151518] border border-ide-border focus:outline-none focus:border-primary-blue rounded px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-650 transition-colors"
              placeholder="e.g. Alice"
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              required
              autoFocus
            />
          </div>
          
          <button type="submit" className="w-full flex items-center justify-center gap-2 bg-primary-blue hover:bg-primary-hover text-white font-semibold text-xs py-2.5 rounded-md transition-colors cursor-pointer shadow-md shadow-primary-blue/10">
            <Sparkles size={14} />
            Join coding session
          </button>
        </form>
      </div>
    );
  }

  return (
    <div 
      className="grid h-screen w-screen overflow-hidden bg-ide-editor text-[#cccccc] font-sans"
      style={{ 
        gridTemplateColumns: showChat ? '240px minmax(0, 1fr) 320px' : '240px minmax(0, 1fr)',
      }}
    >
      {/* Left Sidebar Panel (Explorer) */}
      <aside className="bg-ide-sidebar border-r border-ide-border flex flex-col h-screen select-none shrink-0">
        
        {/* Sidebar Header Title */}
        <div className="h-11 border-b border-ide-border flex items-center px-4 gap-2 bg-[#151518]">
          <Code size={13} className="text-primary-blue" />
          <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
            EXPLORER
          </span>
        </div>

        {/* Room Information (Flat rows instead of nested cards) */}
        <div className="border-b border-ide-border p-4 flex flex-col gap-2.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">SESSION DETAILS</span>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_5px_#10b981]' : 'bg-amber-500 shadow-[0_0_5px_#f59e0b]'}`} />
              <span className={`text-[10px] font-bold tracking-wide uppercase ${connected ? 'text-emerald-400' : 'text-amber-500'}`}>
                {connected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>
          </div>
          <div className="flex gap-1.5 items-center">
            <span className="text-xs text-zinc-400 font-mono select-all tracking-wider truncate flex-grow bg-[#151518] border border-ide-border px-2.5 py-1.5 rounded-md">
              {roomId}
            </span>
            <button 
              onClick={handleCopyLink} 
              className={`p-2 rounded-md border transition-colors cursor-pointer shrink-0 ${
                copied 
                  ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400' 
                  : 'bg-[#252526] hover:bg-ide-hover border-ide-border text-zinc-300'
              }`}
              title="Copy Session Link"
            >
              {copied ? <Check size={11} /> : <Share2 size={11} />}
            </button>
          </div>
        </div>

        <div className="border-b border-ide-border p-4 flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">SYNTAX HIGHLIGHTING</label>
          <select 
            value={language} 
            onChange={handleLanguageChange} 
            className="w-full bg-[#252526] border border-ide-border text-[13px] text-zinc-300 rounded px-2.5 py-1.5 cursor-pointer focus:outline-none focus:border-primary-blue transition-colors"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value} className="bg-ide-sidebar">
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col flex-grow overflow-hidden p-4">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-550 tracking-wider uppercase mb-3">
            <Users size={12} className="text-zinc-500" />
            <span>COLLABORATORS ({users.length})</span>
          </div>

          <div className="flex flex-col gap-0.5 overflow-y-auto pr-1">
            {users.map((user) => (
              <div 
                key={user.id} 
                className="hover:bg-ide-hover/30 -mx-4 px-4 py-1.5 flex items-center gap-2.5 transition-colors cursor-default"
              >
                {/* 8px online dot color-coded */}
                <span 
                  style={{ backgroundColor: user.color }} 
                  className="w-2 h-2 rounded-full shrink-0" 
                />
                
                <div className="flex flex-col min-w-0 flex-grow">
                  <span className="text-[13px] font-semibold text-zinc-300 truncate">
                    {user.username}
                    {user.id === socketRef.current?.id && ' (You)'}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {user.cursor ? `Ln ${user.cursor.lineNumber}, Col ${user.cursor.column}` : 'Idle'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer active sync */}
        <div className="mt-auto py-2.5 px-4 border-t border-ide-border flex items-center gap-1.5 text-[10px] text-zinc-500 font-bold uppercase select-none">
          <Terminal size={11} />
          <span>Yjs Sync Active</span>
        </div>
      </aside>

      {/* Center Monaco Editor Panel */}
      <main className="flex flex-col h-screen flex-grow relative bg-ide-editor min-w-0">
        
        {/* Editor Tabbed Header */}
        <header className="h-11 bg-[#18181c] border-b border-ide-border flex items-center justify-between px-4 select-none z-10">
          
          {/* Active file tab */}
          <div className="flex items-center h-full">
            <div className="h-full bg-ide-editor border-t-2 border-primary-blue border-r border-ide-border flex items-center px-4 gap-2">
              <Code size={12} className="text-indigo-400" />
              <span className="text-[13px] font-bold text-zinc-200">
                main.{language === 'typescript' ? 'ts' : language === 'javascript' ? 'js' : language === 'python' ? 'py' : language === 'html' ? 'html' : language === 'css' ? 'css' : language === 'cpp' ? 'cpp' : 'md'}
              </span>
            </div>
            
            {/* Syntax indicator */}
            <div className="h-full flex items-center px-3">
              <span className="bg-[#2d2d2d] text-zinc-400 text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">
                {language}
              </span>
            </div>
          </div>

          {/* Toggle sidebar button */}
          <button 
            onClick={() => setShowChat(!showChat)} 
            className="flex items-center gap-1.5 bg-[#252526] hover:bg-[#2d2d30] border border-ide-border text-zinc-300 font-semibold text-[11px] px-2.5 py-1.5 rounded transition-colors cursor-pointer select-none"
            title={showChat ? 'Hide Chat Sidebar' : 'Show Chat Sidebar'}
          >
            <MessageSquare size={12} className={showChat ? 'text-primary-blue' : 'text-zinc-500'} />
            <span>{showChat ? 'Hide Chat' : 'Show Chat'}</span>
          </button>
        </header>

        {/* Monaco Editor Frame */}
        <div className="flex-grow w-full h-[calc(100vh-44px)] bg-ide-editor overflow-hidden">
          <MonacoEditor
            height="100%"
            language={language}
            theme="vs-dark"
            onMount={handleEditorDidMount}
            options={{
              fontSize: 14,
              fontFamily: 'Fira Code, monospace',
              fontLigatures: true,
              minimap: { enabled: true },
              automaticLayout: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              padding: { top: 12 },
              lineNumbersMinChars: 3,
            }}
          />
        </div>
      </main>

      {/* Right Sidebar (Chat & Voice panel) */}
      {showChat && (
        <ChatPanel
          messages={messages}
          onSendMessage={handleSendMessage}
          users={users}
          localUserId={socketRef.current?.id || ''}
          inVoice={inVoice}
          isMuted={isMuted}
          onJoinVoice={handleJoinVoice}
          onLeaveVoice={handleLeaveVoice}
          onToggleMute={handleToggleMute}
        />
      )}
    </div>
  );
}
