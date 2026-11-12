import "../styles/chat.css";

export const metadata = {
  title: "RAG Assistant",
  description: "Ask questions about your documents with the RAG Assistant.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
