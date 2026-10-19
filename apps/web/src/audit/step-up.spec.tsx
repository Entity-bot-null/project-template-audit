import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isReauthenticationRequired, useStepUp } from './step-up';

describe('isReauthenticationRequired', () => {
  it('is a 403 the API marks as needing a recent step-up, nothing else', () => {
    const code = 'reauthentication_required';
    expect(isReauthenticationRequired({ status: 403, message: 'x', code })).toBe(true);
    expect(isReauthenticationRequired({ status: 403, message: 'x' })).toBe(false);
    expect(isReauthenticationRequired({ status: 403, message: 'x', code: 'other' })).toBe(false);
    expect(isReauthenticationRequired({ status: 401, message: 'x', code })).toBe(false);
  });
});

describe('useStepUp', () => {
  function Lonely() {
    useStepUp();
    return null;
  }

  it('needs a StepUpProvider above it', () => {
    // React reports the error it rethrows: kept out of the output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Lonely />)).toThrow('useStepUp needs a StepUpProvider above it');
  });
});
