import { describe, expect, it } from 'vitest';
import { updateErrorMessage } from '../src/app/updater';

describe('update check messages', () => {
  it('explain failures in plain words', () => {
    expect(updateErrorMessage(new Error('Could not fetch a valid release JSON from the remote'))).toMatch(/No release/);
    expect(updateErrorMessage(new Error('error sending request: dns error'))).toMatch(/internet connection/);
    expect(updateErrorMessage('signature verification failed')).toMatch(/signature/);
    expect(updateErrorMessage(new Error('something odd'))).toBe('something odd');
  });
});
