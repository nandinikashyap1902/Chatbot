import { useState, useRef, useEffect } from "react";
import "../styles/chat.css";

// Dev: hit backend directly | Prod: use env URL or nginx proxy
const API_BASE = import.meta.env.DEV
  ? "http://localhost:6001"
  : (import.meta.env.VITE_API_URL || "");

const getUserId = () => {
  let userId = localStorage.getItem("userId");
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem("userId", userId);
  }
  return userId;
};

export default function Chat() {
  const controllerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedSources, setUploadedSources] = useState([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  // --- File Upload ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const allowedExts = ['.pdf', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExts.includes(ext)) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `❌ File type "${ext}" is not supported.\nSupported: ${allowedExts.join(', ')}`
      }]);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "❌ File too large. Maximum size is 10MB."
      }]);
      return;
    }

    const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    const icon = isImage ? '🖼️' : '📎';

    setIsUploading(true);
    setMessages(prev => [...prev, {
      role: "user",
      content: `${icon} ${file.name}`
    }]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        body: formData
      });

      const data = await res.json();

      if (res.ok) {
        setUploadedSources(prev => [...prev, { name: file.name, type: isImage ? 'image' : 'file', chunks: data.chunks }]);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: isImage
            ? `Got it! You can now ask me anything about this image.`
            : `Got it! You can now ask me anything about "${file.name}".`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `❌ Upload failed: ${data.error}`
        }]);
      }
    } catch (err) {
      console.error("Upload error:", err);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "❌ Upload failed. Make sure the server is running."
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  // --- Website URL Upload ---
  const handleUrlSubmit = async () => {
    const url = urlInput.trim();
    if (!url) return;

    try {
      new URL(url);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "❌ Invalid URL format. Use https://example.com"
      }]);
      return;
    }

    setShowUrlInput(false);
    setUrlInput('');
    setIsUploading(true);

    setMessages(prev => [...prev, {
      role: "user",
      content: `🌐 ${url}`
    }]);

    try {
      const res = await fetch(`${API_BASE}/api/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      const data = await res.json();

      if (res.ok) {
        const displayName = url.length > 50 ? url.slice(0, 50) + '...' : url;
        setUploadedSources(prev => [...prev, { name: displayName, type: 'website', chunks: data.chunks }]);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Got it! You can now ask me anything about this website.`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `❌ Failed: ${data.error}`
        }]);
      }
    } catch (err) {
      console.error("URL upload error:", err);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "❌ Failed to index website. Check server."
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  // --- Send Message (streaming) ---
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsStreaming(true);
    setStreamingMessage("");

    try {
      const res = await fetch(`${API_BASE}/api/groq/stream`, {
        method: "POST",
        body: JSON.stringify({ message: userMessage.content, userId: getUserId() }),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        let chunk = decoder.decode(value, { stream: true });

        // Strip end markers
        if (chunk.includes("[DONE]")) {
          chunk = chunk.replace("[DONE]", "");
        }
        if (chunk.includes("[ERROR]")) {
          chunk = chunk.replace("[ERROR]", "");
          break;
        }

        if (chunk) {
          fullText += chunk;
          setStreamingMessage(prev => prev + chunk);
        }
      }

      if (fullText.trim()) {
        setMessages(prev => [...prev, { role: "assistant", content: fullText }]);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Streaming error:", err);
        setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
      }
    } finally {
      setStreamingMessage("");
      setIsStreaming(false);
      controllerRef.current = null;
    }
  };

  const stopGeneration = () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      setIsStreaming(false);
      if (streamingMessage) {
        setMessages(prev => [...prev, { role: "assistant", content: streamingMessage }]);
        setStreamingMessage("");
      }
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleUrlKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUrlSubmit();
    }
    if (e.key === 'Escape') {
      setShowUrlInput(false);
      setUrlInput('');
    }
  };

  const sourceCount = {
    file: uploadedSources.filter(s => s.type === 'file').length,
    image: uploadedSources.filter(s => s.type === 'image').length,
    website: uploadedSources.filter(s => s.type === 'website').length,
  };

  return (
    <div className="app-container">
      <div className="chat-container">

        {/* ===== HEADER ===== */}
        <div className="chat-header">
          <div className="header-info">
            <div className="header-logo">⚡</div>
            <div className="header-text">
              <h1>RAG Assistant</h1>
              <p>Powered by Groq + Pinecone</p>
            </div>
          </div>
          <div className="header-right">
            {uploadedSources.length > 0 && (
              <div className="uploaded-badges" title={uploadedSources.map(s => s.name).join(', ')}>
                {sourceCount.file > 0 && <span className="source-badge file-badge">📄 {sourceCount.file}</span>}
                {sourceCount.image > 0 && <span className="source-badge image-badge">🖼️ {sourceCount.image}</span>}
                {sourceCount.website > 0 && <span className="source-badge web-badge">🌐 {sourceCount.website}</span>}
              </div>
            )}
            <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <div className="status-dot" title="Server connected"></div>
          </div>
        </div>

        {/* ===== MESSAGES ===== */}
        <div className="chat-body">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-logo">⚡</div>
              <h2>What can I help you with?</h2>
              <p className="empty-hint">
                Upload documents, images, or index a website — then ask questions about them.
              </p>
              <div className="source-types">
                <span className="source-type-chip">📄 PDF & Text</span>
                <span className="source-type-chip">🖼️ Images</span>
                <span className="source-type-chip">🌐 Websites</span>
                <span className="source-type-chip">📊 CSV</span>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`message-wrapper ${msg.role}`}>
              <div className="avatar">
                {msg.role === 'assistant' ? '⚡' : '👤'}
              </div>
              <div className="message-content">
                {msg.content}
              </div>
            </div>
          ))}

          {isStreaming && (
            <div className="message-wrapper assistant">
              <div className="avatar">⚡</div>
              <div className="message-content streaming">
                {streamingMessage}
                <span className="cursor">▌</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ===== FOOTER ===== */}
        <div className="chat-footer">
          {isStreaming && (
            <button onClick={stopGeneration} className="stop-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              Stop
            </button>
          )}

          {isUploading && (
            <div className="upload-progress">
              <div className="upload-spinner"></div>
              <span>Processing source...</span>
            </div>
          )}

          {showUrlInput && (
            <div className="url-input-bar">
              <div className="url-icon">🌐</div>
              <input
                type="text"
                placeholder="Paste website URL..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={handleUrlKeyPress}
                autoFocus
                disabled={isUploading}
              />
              <button
                className="url-submit-btn"
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim() || isUploading}
              >
                Index
              </button>
              <button
                className="url-cancel-btn"
                onClick={() => { setShowUrlInput(false); setUrlInput(''); }}
              >
                ✕
              </button>
            </div>
          )}

          <div className="input-wrapper">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
              style={{ display: 'none' }}
            />

            <button
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || isUploading}
              title="Upload file or image"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
              </svg>
            </button>

            <button
              className="url-btn"
              onClick={() => setShowUrlInput(!showUrlInput)}
              disabled={isStreaming || isUploading}
              title="Index a website"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </button>

            <input
              type="text"
              placeholder="Ask anything about your documents..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={isStreaming || isUploading}
            />

            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming || isUploading}
              className="send-btn"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
