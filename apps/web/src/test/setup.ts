import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, vi } from 'vitest';

// The live layer (audit/live) opens the alert stream and asks for the
// counters and the person's notification preferences on every signed-in page
// of a reader: the pages' specs leave it out (its context's defaults: not
// live), so each needs no stub of those requests. Its own specs, and the
// layout's, take the real one (vi.unmock).
vi.mock('../audit/live/LiveProvider', () => ({
  LiveProvider: ({ children }: { children: ReactNode }) => children,
}));

// Every signed-in page is a lazy route (docs/adr/0014): its first import in a
// run, under coverage instrumentation, can take longer than the default
// second that findBy* and waitFor wait for.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
});
