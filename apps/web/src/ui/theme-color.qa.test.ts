// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../../test/setup';
import { applyThemeColor } from './theme';

// QA probes for T-019 AC-T19-11、AC-T19-12（ADR-014 決定 4）。
function head(): HTMLHeadElement {
  const h = document.createElement('head');
  h.innerHTML = `<meta name="color-scheme" content="light dark" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F4F5F7" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0A1420" />
<script id="inline"></script>`;
  return h;
}
const metas = (h: HTMLHeadElement) =>
  [...h.querySelectorAll('meta[name="theme-color"]')].map((m) => `${m.getAttribute('media') ?? '-'}=${m.getAttribute('content') ?? ''}`);
const order = (h: HTMLHeadElement) =>
  [...h.children].map((el) => (el.tagName === 'SCRIPT' ? 'script' : `${el.getAttribute('name') ?? ''}${el.hasAttribute('media') ? '+m' : ''}`));

describe('T-019 QA theme-color', () => {
  it('(QA-12) metas stay between color-scheme and the inline script through manual, manual and system', () => {
    const h = head();
    applyThemeColor('dark', '#0A1420', h);
    expect(order(h)).toEqual(['color-scheme', 'theme-color', 'script']);
    applyThemeColor('light', '#F4F5F7', h);
    expect(order(h)).toEqual(['color-scheme', 'theme-color', 'script']);
    applyThemeColor('system', 'ignored', h);
    expect(order(h)).toEqual(['color-scheme', 'theme-color+m', 'theme-color+m', 'script']);
    expect(metas(h)).toEqual(['(prefers-color-scheme: light)=#F4F5F7', '(prefers-color-scheme: dark)=#0A1420']);
  });

  it('(QA-13) system ignores the color argument; repeated system calls keep exactly two metas', () => {
    const h = head();
    applyThemeColor('system', '#123456', h);
    applyThemeColor('system', '#123456', h);
    expect(metas(h)).toEqual(['(prefers-color-scheme: light)=#F4F5F7', '(prefers-color-scheme: dark)=#0A1420']);
  });

  it('(QA-14) other metas in head are left alone', () => {
    const h = head();
    const other = document.createElement('meta');
    other.name = 'description';
    other.content = 'x';
    h.appendChild(other);
    applyThemeColor('dark', '#0A1420', h);
    applyThemeColor('system', '', h);
    expect(h.querySelector('meta[name="description"]')).toBe(other);
    expect(h.querySelector('meta[name="color-scheme"]')).not.toBeNull();
  });
});
