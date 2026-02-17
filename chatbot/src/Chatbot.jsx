import { useState, useRef, useEffect } from "react";
import "./App.css";

//import { v4 as uuidv4 } from 'uuid'
//const userId = uuidv4();
const getUserId = () => {
  let userId = localStorage.getItem("userId");
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem("userId", userId);
  }
  return userId;
};

export default function Chatbot() {
  const controllerRef = useRef(null);
  const messagesEndRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

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
      const res = await fetch("http://localhost:5000/api/groq/stream", {
        method: "POST",
        body: JSON.stringify({ message: userMessage.content, userId: getUserId() }),
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        if (chunk.includes("[DONE]")) break;

        fullText += chunk;
        setStreamingMessage(prev => prev + chunk);
      }

      setMessages(prev => [
        ...prev,
        { role: "assistant", content: fullText }
      ]);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Streaming error:", err);
        setMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong. Please try again." }]);
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

  return (
    <div className="app-container">
      <div className="chat-container">
        <div className="chat-header">
          <div className="header-info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 6C13.66 6 15 7.34 15 9C15 10.66 13.66 12 12 12C10.34 12 9 10.66 9 9C9 7.34 10.34 6 12 6ZM12 17.2C9.5 17.2 7.29 15.92 6 14C7.3 12.28 10.5 11.8 12 11.8C13.5 11.8 16.7 12.28 18 14C16.71 15.92 14.5 17.2 12 17.2Z" fill="currentColor" />
            </svg>
            <span>AI Assistant</span>
          </div>
          <div className="status-indicator"></div>
        </div>

        <div className="chat-body">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="icon-large">👋</div>
              <h3>Hello! How can I help you today?</h3>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`message-wrapper ${msg.role}`}>
              <div className="avatar">
                {msg.role === 'assistant' ? '🤖' : '👤'}
              </div>
              <div className="message-content">
                {msg.content}
              </div>
            </div>
          ))}

          {isStreaming && (
            <div className="message-wrapper assistant">
              <div className="avatar">🤖</div>
              <div className="message-content streaming">
                {streamingMessage}
                <span className="cursor">▌</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-footer">
          {isStreaming ? (
            <button onClick={stopGeneration} className="stop-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              </svg>
              Stop Generating
            </button>
          ) : null}

          <div className="input-wrapper">
            <input
              type="text"
              placeholder="Type your message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={isStreaming}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="send-btn"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
