/** §5.6.3：先刪 XML 1.0 不允許的控制字元（保留 \t \n \r），再依序跳脫（`&` 一定最先）。 */
export function escapeSsmlText(text: string): string {
  let kept = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) kept += ch;
  }
  return kept
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSsml(voiceName: string, text: string): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${escapeSsmlText(voiceName)}">${escapeSsmlText(text)}</voice></speak>`;
}
