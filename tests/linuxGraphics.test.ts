import { describe, expect, it } from 'vitest';
import { describeLinuxGraphics, type LinuxCard } from '../src/app/linuxGraphics';

const intel: LinuxCard = { name: 'Intel Iris Xe Graphics', driver: 'i915', pci: '0000:00:02.0', in_use: false, startup: true };
const nvidia: LinuxCard = { name: 'NVIDIA GeForce RTX 3050 Laptop GPU', driver: 'nvidia', pci: '0000:01:00.0', in_use: false, startup: false };

describe('Linux graphics, as shown in About and Settings', () => {
  it('names the chip in use first, then the others', () => {
    expect(describeLinuxGraphics({ cards: [{ ...nvidia, in_use: true }, intel], checked: true, software: false })).toBe(
      'NVIDIA GeForce RTX 3050 Laptop GPU (in use) · Intel Iris Xe Graphics (also in this computer)',
    );
    expect(describeLinuxGraphics({ cards: [{ ...intel, in_use: true }], checked: true, software: false })).toBe('Intel Iris Xe Graphics (in use)');
  });

  it('says so when WebKit draws in software', () => {
    expect(describeLinuxGraphics({ cards: [intel, nvidia], checked: true, software: true })).toBe(
      'none in use (drawing in software) · Intel Iris Xe Graphics, NVIDIA GeForce RTX 3050 Laptop GPU (in this computer)',
    );
  });

  it('lists the chips when it cannot tell which one draws', () => {
    expect(describeLinuxGraphics({ cards: [intel, nvidia], checked: false, software: false })).toBe(
      'Intel Iris Xe Graphics, NVIDIA GeForce RTX 3050 Laptop GPU (which one draws is not known)',
    );
    expect(describeLinuxGraphics({ cards: [], checked: false, software: false })).toMatch(/not known/);
  });
});
