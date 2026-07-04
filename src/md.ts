export function mdToSafeHtml(escapedText: string): string {
  const lines = escapedText.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listBuf: { tag: string; items: string[] } | null = null;
  let quoteBuf: string[] = [];

  function flushList() {
    if (!listBuf) return;
    out.push(`<${listBuf.tag}>${listBuf.items.map(i => `<li>${i}</li>`).join('')}</${listBuf.tag}>`);
    listBuf = null;
  }

  function flushQuote() {
    if (!quoteBuf.length) return;
    out.push(`<blockquote>${quoteBuf.join('<br>')}</blockquote>`);
    quoteBuf = [];
  }

  function inline(s: string): string {
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const safeUrl = url.replace(/&quot;/g, '%22').replace(/\s.*$/, '');
        return `<a href="${safeUrl}" target="_blank" rel="noopener">${text}</a>`;
      }
      return `[${text}](${url})`;
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
    return s;
  }

  for (const line of lines) {
    if (line.trim() === '```') {
      if (inCode) {
        out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushList(); flushQuote();
        inCode = true;
      }
      continue;
    }

    if (inCode) { codeLines.push(line); continue; }

    const hm = line.match(/^(#{1,6}) (.+)$/);
    if (hm) {
      flushList(); flushQuote();
      out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`);
      continue;
    }

    if (line.startsWith('&gt; ')) {
      flushList();
      quoteBuf.push(inline(line.slice(5)));
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushQuote();
      const item = inline(line.slice(2));
      if (listBuf?.tag === 'ul') listBuf.items.push(item);
      else { flushList(); listBuf = { tag: 'ul', items: [item] }; }
      continue;
    }

    const om = line.match(/^\d+\. (.+)$/);
    if (om) {
      flushQuote();
      const item = inline(om[1]);
      if (listBuf?.tag === 'ol') listBuf.items.push(item);
      else { flushList(); listBuf = { tag: 'ol', items: [item] }; }
      continue;
    }

    flushList(); flushQuote();
    if (line.trim() === '') { out.push('<br>'); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }

  flushList(); flushQuote();
  if (inCode) out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);

  return out.join('');
}
