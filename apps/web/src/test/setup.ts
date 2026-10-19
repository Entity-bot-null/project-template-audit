import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Every signed-in page is a lazy route (docs/adr/0014): its first import in a
// run, under coverage instrumentation, can take longer than the default
// second that findBy* and waitFor wait for.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
});
