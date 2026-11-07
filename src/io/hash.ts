/** A 64-bit FNV-1a hash (as hex) plus the length: enough to tell document states apart. */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${text.length.toString(36)}-${a.toString(16)}${b.toString(16)}`;
}
