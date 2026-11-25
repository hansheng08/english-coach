/**
 * Gemini 的 SSE（ARCHITECTURE §5.4.6）：每段以 CRLF 空行結尾、只有 `data:` 行、沒有 `event:` 或 [DONE]。
 * 先把 CRLF 統一成 LF 再用空行切段；不是 `data:` 開頭的行忽略。
 */
export type SseParser = {
  /** 餵入新收到的文字，回傳已完整的各段 data（沒有 data 行的段落略過）。 */
  push(text: string): string[];
  /** 連線結束：緩衝區還有內容就當最後一段。 */
  flush(): string[];
};

function dataOf(event: string): string | null {
  const lines = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''));
  return lines.length === 0 ? null : lines.join('\n');
}

export function createSseParser(): SseParser {
  let buffer = '';
  const collect = (events: readonly string[]): string[] =>
    events.flatMap((event) => {
      const data = dataOf(event);
      return data === null ? [] : [data];
    });
  return {
    push(text) {
      // 結尾單獨的 \r 留在緩衝區，等下一次的 \n 接上後再統一。
      buffer = (buffer + text).replace(/\r\n/g, '\n');
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      return collect(parts);
    },
    flush() {
      const rest = buffer.replace(/\r\n?/g, '\n').trim();
      buffer = '';
      return rest.length === 0 ? [] : collect([rest]);
    },
  };
}
