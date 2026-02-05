import React from 'react'
import { useState } from "react";
function Practice() {
    const [text, setText] = useState("");
    const startStream = async () => {
    setText(""); // reset

    const response = await fetch("http://localhost:5000/api/test-stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      const chunk = decoder.decode(value);
      setText(prev => prev + chunk);
    }
  };
  return (

  

  
    <div>
      <button onClick={startStream}>Start Stream</button>
      <p>{text}</p>
    </div>
  
)
}

export default Practice