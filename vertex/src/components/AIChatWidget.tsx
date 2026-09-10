"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { isInternalPortalPath } from "@/lib/rbac";

export default function AIChatWidget() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [hasSpeechSupport, setHasSpeechSupport] = useState(false);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Custom mock of useChat to avoid build errors from ai/react package
  const [messages, setMessages] = useState<{id: string, role: string, content: string}[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{message: string} | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { id: Date.now().toString(), role: "user", content: input };
    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Request failed");
      }

      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: data.text || "No response received." } : m)
      );
    } catch (err: any) {
      console.error(err);
      setError({ message: err.message || "An error occurred" });
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Scroll to bottom when messages change
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    // Initialize Speech Recognition if supported
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        setHasSpeechSupport(true);
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        recognitionRef.current.lang = "en-US";

        recognitionRef.current.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
          // Auto-submit could be enabled here if desired:
          // setTimeout(() => document.getElementById("ai-chat-form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })), 100);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      }
    }
  }, [setInput]);

  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error("Microphone access error:", e);
      }
    }
  };

  if (isInternalPortalPath(pathname)) return null;

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 flex items-end justify-end flex-col gap-4">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-[90vw] sm:w-[380px] h-[550px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white shadow-inner">
                    <img src="/logo.svg" alt="Vertex" className="h-4.5 w-auto brightness-0 invert" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Vertex AI Assistant</h3>
                    <p className="text-xs text-slate-300">We respond instantly</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Chat Area */}
              <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center text-slate-500 py-10">
                    <div className="text-4xl mb-3">👋</div>
                    <p className="text-sm font-medium text-slate-700">Hi there!</p>
                    <p className="text-xs mt-1 px-4">Ask me about jobs, visas, or how to pay application fees.</p>
                  </div>
                ) : (
                  messages.map(m => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                        m.role === 'user'
                          ? 'bg-emerald-600 text-white rounded-tr-sm'
                          : 'bg-white text-slate-800 border border-slate-200 rounded-tl-sm shadow-sm'
                      }`}>
                        {m.role === 'assistant' && !m.content && isLoading ? (
                          <span className="flex gap-1 items-center py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        ) : (
                          <>
                            {m.content}
                            {m.role === 'assistant' && isLoading && m.content && (
                              <span className="inline-block w-0.5 h-3.5 bg-slate-400 ml-0.5 animate-pulse align-middle" />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}


                {error && (
                  <div className="text-xs text-center text-red-500 bg-red-50 p-2 rounded-lg border border-red-100">
                    {error.message || "Failed to connect to AI server."}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <form id="ai-chat-form" onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-100">
                <div className="relative flex items-center bg-slate-100 rounded-xl outline-2 outline-emerald-500 focus-within:outline transition-all">
                  <input
                    className="flex-1 bg-transparent border-none py-3 pl-4 pr-12 text-sm text-slate-800 focus:ring-0 focus:outline-none placeholder-slate-400"
                    value={input}
                    onChange={handleInputChange}
                    placeholder="Type your question..."
                    disabled={isLoading}
                  />
                  
                  <div className="absolute right-2 flex items-center gap-1">
                    {hasSpeechSupport && (
                      <button 
                        type="button" 
                        onClick={toggleListen}
                        className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-100 text-red-600 animate-pulse' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200'}`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                      </button>
                    )}
                    
                    {input.trim() && (
                      <button 
                        type="submit" 
                        disabled={isLoading}
                        className="p-2 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        <svg className="w-4 h-4 translate-x-[-1px] translate-y-[1px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-center text-slate-400 mt-2">
                  AI answers may occasionally be inaccurate.
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toggle Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 ${isOpen ? 'bg-slate-700' : 'bg-slate-900'}`}
        >
          {isOpen ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <div className="relative group">
              <span className="absolute -inset-1 rounded-full bg-emerald-500 opacity-40 blur transition duration-500 group-hover:opacity-75"></span>
              <img src="/logo.svg" alt="Vertex" className="h-7 w-auto brightness-0 invert relative z-10" />
            </div>
          )}
        </button>
      </div>
    </>
  );
}
