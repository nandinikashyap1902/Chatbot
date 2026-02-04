import { useState } from "react";
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
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const[isLoading,setIsLoading] = useState()
  //const [isClicked, setIsClicked] = useState(false)
  //const [istyping,setIsTyping] = useState(false)
  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage = { role: "user", content: input };
      setMessages(prev => [...prev, userMessage]);
     setIsLoading(true)
   // setIsClicked(true)
    // setIsTyping(true)
        try {
            const response = await fetch('http://localhost:5000/api/groq', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: input ,userId:getUserId()})
            });
          const assistantMessage= await response.json();
         
           setMessages(prev => [...prev, assistantMessage]);
          
          
    }
        catch (err) {
          console.log(err)
    } 
    finally {
    setIsLoading(false);
    setInput("");
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
        {isLoading && <div>AI is typing...</div>}
        </div>

      <div className="chat-footer">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
         
        />
       
          <button onClick={handleSend} disabled={isLoading} >{isLoading ? "Sending..." : "Send"}</button>
       
      </div>
    </div>
  );
}
