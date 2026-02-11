import { useState,useRef } from "react";
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

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streamingMessage, setStreamingMessage] = useState("");
const [isStreaming, setIsStreaming] = useState(false);
  // const[isLoading,setIsLoading] = useState()
  //const [isClicked, setIsClicked] = useState(false)
  //const [istyping,setIsTyping] = useState(false)
  // const handleSend = async () => {
  //   if (!input.trim()) return;
  //   const userMessage = { role: "user", content: input };
  //     setMessages(prev => [...prev, userMessage]);
  //    setIsLoading(true)
  //  // setIsClicked(true)
  //   // setIsTyping(true)
  //       try {
  //           const response = await fetch('http://localhost:5000/api/groq', {
  //               method: 'POST',
  //               headers: {
  //                 'Content-Type': 'application/json'
  //               },
  //               body: JSON.stringify({ message: input ,userId:getUserId()})
  //           });
  //         const assistantMessage= await response.json();
         
  //          setMessages(prev => [...prev, assistantMessage]);
          
          
  //   }
  //       catch (err) {
  //         console.log(err)
  //   } 
  //   finally {
  //   setIsLoading(false);
  //   setInput("");
  // }
  // };
  const sendMessage = async () => {
    const controller = new AbortController();
    controllerRef.current = controller
    setIsStreaming(true);
    setStreamingMessage("");

    const res = await fetch("http://localhost:5000/api/groq/stream", {
      method: "POST",
      body: JSON.stringify({ message: input, userId: getUserId() }),
      headers: {
        "Content-Type": "application/json"
      },
signal:controller.signal
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

  
    let fullText = "";
    try {
      while (true) {
        
        const { value, done } = await reader.read();
        if (done) break;
      
        const chunk = decoder.decode(value);
        if (chunk.includes("[DONE]")) break;
        fullText += chunk;
          await new Promise(r => setTimeout(r, 30)); //for chatgpt like feel
        setStreamingMessage(prev => prev + chunk);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
      console.error("Streaming error:", err);
    }
    } finally {
      if (fullText) {
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: fullText }
        ]);
      }
      setStreamingMessage("");
      setIsStreaming(false);
      controllerRef.current = null;
    }
  }
      //   while (true) {
      //     const { value, done } = await reader.read();
      //     if (done) break;

      //     const chunk = decoder.decode(value);
      //     if (chunk.includes("[DONE]")) break;
      // setStreamingMessage(prev => prev + chunk);
      //     // assistantText += chunk.replace("data: ", "");
      //     setMessages(prev => [
      //     ...prev,
      //       { role: "assistant", content: streamingMessage }
      //     ]);
      //     }
  
   
const stopGeneration = () => {
  if (controllerRef.current) {
    controllerRef.current.abort();
  }
};



  return (
    <div className="chat-container">
      <div className="chat-header">Chatbot</div>
      
      <div className="chat-body">
        {/* <p>user:{input}</p> */}
       
        {
          messages?.map((msg, i) => (
            <div key={i}>
              <strong>{msg.role}:</strong> {msg.content}
            </div>
          ))
        }
        {isStreaming && (
          <div className="assistant">
            {streamingMessage}
            <span className="cursor">▌</span>
             
          </div>)}
        {/* {isLoading && <div>AI is typing...</div>} */}
        {isStreaming && (
          <button onClick={stopGeneration}>
    Stop
  </button>
        )}
        </div>

      <div className="chat-footer">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
       
          <button onClick={sendMessage}  className="stop"> "Send"</button>
       
      </div>
    </div>
  );
}
