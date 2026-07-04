import { expect, test } from 'bun:test';
import { mdToSafeHtml } from '../src/md';

function esc(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// XSS cases
test('script tag is not injected', () => {
  const html = mdToSafeHtml(esc('<script>alert(1)</script>'));
  expect(html).not.toContain('<script');
  expect(html).toContain('&lt;script');
});

test('img onerror is not injected', () => {
  const html = mdToSafeHtml(esc('<img onerror="alert(1)">'));
  expect(html).not.toContain('<img');
});

test('javascript: link is not rendered as href', () => {
  const html = mdToSafeHtml(esc('[click](javascript:alert(1))'));
  expect(html).not.toContain('href=');
  expect(html).toContain('[click]');
});

test('quote in url does not break href boundary', () => {
  const html = mdToSafeHtml(esc('[text](https://x.com" onclick="alert(1))'));
  expect(html).not.toContain('onclick');
  expect(html).toContain('<a href=');
});

test('html injection in plain text is escaped', () => {
  const html = mdToSafeHtml(esc('<b>bold</b>'));
  expect(html).toContain('&lt;b&gt;');
  expect(html).not.toContain('<b>');
});

// Formatting cases
test('h1 heading', () => {
  const html = mdToSafeHtml('# Hello World');
  expect(html).toContain('<h1>');
  expect(html).toContain('Hello World');
});

test('bold with **', () => {
  const html = mdToSafeHtml('**bold**');
  expect(html).toContain('<strong>bold</strong>');
});

test('fenced code block', () => {
  const html = mdToSafeHtml('```\ncontent\n```');
  expect(html).toContain('<pre><code>');
  expect(html).toContain('content');
});

test('unordered list', () => {
  const html = mdToSafeHtml('- item1\n- item2');
  expect(html).toContain('<ul>');
  expect(html).toContain('<li>');
});

test('valid https link', () => {
  const html = mdToSafeHtml('[click](https://example.com)');
  expect(html).toContain('<a href="https://example.com"');
  expect(html).toContain('target="_blank"');
});

test('inline code', () => {
  const html = mdToSafeHtml('`code`');
  expect(html).toContain('<code>code</code>');
});
