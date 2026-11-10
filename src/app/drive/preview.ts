/**
 * Google Drive is shown unless switched off (Settings → Google Drive, kept in localStorage).
 * While Google still has VormCraft in testing, only accounts on its test list can sign in;
 * `DRIVE_IN_TESTING` makes Connect say so first. Set it to false once Google has verified the app.
 */
const HIDDEN_KEY = 'vormcraft.drive.hidden';

export const DRIVE_IN_TESTING = false;

/** What to tell people before they sign in, and when Google turns them away, while in testing. */
export const DRIVE_TESTING_NOTE =
  'Google Drive saving is new and Google is still verifying VormCraft. Until then, only accounts on VormCraft’s test list can sign in; other accounts will see “Access blocked” from Google. Once Google has verified VormCraft, it will work for everyone.';

/** Google turned the sign-in away (or the person said no). */
export function accessDeniedMessage(): string {
  return DRIVE_IN_TESTING
    ? 'Google Drive access was not allowed. If Google said access is blocked, this account is not on VormCraft’s test list yet: Google Drive saving opens to everyone once Google has verified VormCraft.'
    : 'Google Drive access was not allowed.';
}

export function driveShown(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) !== '1';
  } catch {
    return true;
  }
}

export function setDriveShown(on: boolean): void {
  try {
    if (on) localStorage.removeItem(HIDDEN_KEY);
    else localStorage.setItem(HIDDEN_KEY, '1');
  } catch {
    // Not remembered.
  }
}
