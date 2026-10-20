// Server-Sent Events read with fetch (the access token in a header, never in
// the URL: EventSource cannot send one): the frames of a text/event-stream,
// as the HTML standard parses them.

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

/** One frame's lines: `field: value`, comments (`:`) skipped, data lines joined. */
export function parseFrame(block: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\u0000')) id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  }
  if (data.length === 0 && id === undefined && retry === undefined) return null;
  return {
    event,
    data: data.join('\n'),
    ...(id === undefined ? {} : { id }),
    ...(retry === undefined ? {} : { retry }),
  };
}

/** The frames of a stream as they arrive; ends with the stream. */
export async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end = boundary(buffer);
      while (end !== null) {
        const frame = parseFrame(buffer.slice(0, end.at));
        buffer = buffer.slice(end.at + end.length);
        if (frame !== null) yield frame;
        end = boundary(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Where the first frame ends: a blank line, whatever the line endings. */
function boundary(buffer: string): { at: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match === null ? null : { at: match.index, length: match[0].length };
}
