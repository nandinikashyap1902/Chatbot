const TERMINAL_MARKERS = ['[DONE]', '[ERROR]']

export async function readChatStream(reader, onText) {
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';

  const emit = (content) => {
    if (!content) return;
    text += content;
    onText(content);
  };

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });

    const terminal = TERMINAL_MARKERS
      .map(marker => ({ marker, index: pending.indexOf(marker) }))
      .filter(({ index }) => index !== -1)
      .sort((left, right) => left.index - right.index)[0];

    if (terminal) {
      emit(pending.slice(0, terminal.index));
      const remainder = pending.slice(terminal.index + terminal.marker.length);
      return {
        text,
        error: terminal.marker === '[ERROR]' ? remainder.trim() || 'The AI service could not complete the request.' : null,
      };
    }

    if (done) {
      emit(pending);
      return { text, error: null };
    }

    const retainedLength = Math.max(...TERMINAL_MARKERS.map(marker => marker.length)) - 1;
    const safeLength = Math.max(0, pending.length - retainedLength);
    emit(pending.slice(0, safeLength));
    pending = pending.slice(safeLength);
  }
}
