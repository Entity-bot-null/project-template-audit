import { describe, expect, it } from 'vitest';
import { parseFrame, type SseFrame, sseFrames } from './sse';

/** A stream that delivers `chunks` as they are, in that order. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function framesOf(chunks: string[]): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of sseFrames(streamOf(chunks))) frames.push(frame);
  return frames;
}

describe('parseFrame', () => {
  it('reads the event, its id and its data, data lines joined', () => {
    expect(
      parseFrame('event: alert\nid: 2026-10-15T09:30:00.000Z|a1\ndata: {"a":1}\ndata: {"b":2}'),
    ).toEqual({
      event: 'alert',
      id: '2026-10-15T09:30:00.000Z|a1',
      data: '{"a":1}\n{"b":2}',
    });
  });

  it('is a message without an event name; skips comments and unknown fields', () => {
    expect(parseFrame(': keep-alive\nfoo: bar\ndata:no space')).toEqual({
      event: 'message',
      data: 'no space',
    });
  });

  it('keeps a numeric retry, ignores another, and refuses an id with a NUL', () => {
    expect(parseFrame('retry: 5000\ndata: x')).toEqual({
      event: 'message',
      data: 'x',
      retry: 5000,
    });
    expect(parseFrame('retry: soon\nid: a\u0000b\ndata: x')).toEqual({
      event: 'message',
      data: 'x',
    });
  });

  it('is nothing for a comment alone (the server’s heartbeat)', () => {
    expect(parseFrame(': ping')).toBeNull();
  });
});

describe('sseFrames', () => {
  it('yields each frame once whole, however the bytes arrive', async () => {
    const frames = await framesOf([
      'event: ready\nda',
      'ta: {}\n',
      '\n: ping\n\nevent: alert\r\nid: c1\r\ndata: {"x":1}\r\n\r',
      '\nevent: end\ndata: {"reason":"renew"}\n\n',
    ]);
    expect(frames).toEqual([
      { event: 'ready', data: '{}' },
      { event: 'alert', id: 'c1', data: '{"x":1}' },
      { event: 'end', data: '{"reason":"renew"}' },
    ]);
  });

  it('decodes characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: Málaga\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8));
        controller.enqueue(bytes.slice(8));
        controller.close();
      },
    });
    const frames: SseFrame[] = [];
    for await (const frame of sseFrames(stream)) frames.push(frame);
    expect(frames).toEqual([{ event: 'message', data: 'Málaga' }]);
  });

  it('drops an unfinished last frame: the connection ended before it did', async () => {
    expect(await framesOf(['data: one\n\ndata: half'])).toEqual([
      { event: 'message', data: 'one' },
    ]);
  });
});
