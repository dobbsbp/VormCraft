import { describe, expect, it } from 'vitest';
import { updateErrorMessage } from '../src/app/updater';

describe('update check messages', () => {
  it('explain failures in plain words', () => {
    expect(updateErrorMessage(new Error('Could not fetch a valid release JSON from the remote'))).toMatch(/No release/);
    expect(updateErrorMessage(new Error('error sending request: dns error'))).toMatch(/internet connection/);
    expect(updateErrorMessage('signature verification failed')).toMatch(/signature/);
    expect(updateErrorMessage(new Error('something odd'))).toBe('something odd');
    // Linux: a release without an AppImage, and an AppImage in a folder it cannot change.
    expect(updateErrorMessage(new Error('the platform `linux-aarch64` was not found in the response `platforms` object'))).toMatch(/no newer version/);
    expect(updateErrorMessage(new Error('Permission denied (os error 13)'))).toMatch(/AppImage/);
  });
});
