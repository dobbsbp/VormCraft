import { describe, expect, it } from 'vitest';
import { updaterJson } from '../scripts/updater-json.mjs';

const ASSETS = [
  'VormCraft_0.6.0-beta.1_x64-setup.exe',
  'VormCraft_0.6.0-beta.1_x64-setup.exe.sig',
  'VormCraft_0.6.0-beta.1_amd64.AppImage',
  'VormCraft_0.6.0-beta.1_amd64.AppImage.sig',
  'VormCraft_0.6.0-beta.1_aarch64.AppImage',
  'VormCraft_0.6.0-beta.1_aarch64.AppImage.sig',
];
const make = (assets: string[]) =>
  updaterJson({ repo: 'dobbsbp/VormCraft', tag: 'v0.6.0-beta.1', notes: '- New', pubDate: '2026-11-20T00:00:00Z', assets, signature: (name) => `sig of ${name}\n` });

describe('latest.json for the updater', () => {
  it('lists the Windows installer and both Linux AppImages, at their published addresses', () => {
    const j = make(ASSETS);
    expect(j.version).toBe('0.6.0-beta.1');
    expect(j.notes).toBe('- New');
    expect(Object.keys(j.platforms).sort()).toEqual(
      ['linux-aarch64', 'linux-aarch64-appimage', 'linux-x86_64', 'linux-x86_64-appimage', 'windows-x86_64', 'windows-x86_64-nsis'].sort(),
    );
    expect(j.platforms['linux-aarch64']).toEqual({
      signature: 'sig of VormCraft_0.6.0-beta.1_aarch64.AppImage.sig',
      url: 'https://github.com/dobbsbp/VormCraft/releases/download/v0.6.0-beta.1/VormCraft_0.6.0-beta.1_aarch64.AppImage',
    });
    expect(j.platforms['windows-x86_64'].url).toMatch(/_x64-setup\.exe$/);
    expect(j.platforms['linux-x86_64'].url).toMatch(/_amd64\.AppImage$/);
  });

  it('refuses a release with a build or a signature missing', () => {
    expect(() => make(ASSETS.filter((a) => !a.includes('aarch64')))).toThrow(/_aarch64\.AppImage/);
    expect(() => make(ASSETS.filter((a) => a !== 'VormCraft_0.6.0-beta.1_amd64.AppImage.sig'))).toThrow(/_amd64\.AppImage/);
  });
});
