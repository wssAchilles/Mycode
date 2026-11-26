import { describe, expect, it } from 'vitest';
import {
  isPrivateOrReservedIp,
  parseOpenGraphMetadata,
  validatePreviewTargetUrl,
} from '../src/routes/linkPreviewRoutes';

describe('Wave 4 Link Preview Security & OG Parser', () => {
  it('blocks private, loopback, link-local, and metadata IPs while allowing public IPs', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.20.30.40')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.254')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);

    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:7f00:0001')).toBe(true);

    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false);
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects unsafe schemes, credentials, and localhost URLs', () => {
    expect(() => validatePreviewTargetUrl('file:///etc/passwd')).toThrow();
    expect(() => validatePreviewTargetUrl('javascript:alert(1)')).toThrow();
    expect(() => validatePreviewTargetUrl('http://localhost:3000/test')).toThrow();
    expect(() => validatePreviewTargetUrl('https://user:pass@example.com')).toThrow();
    expect(() => validatePreviewTargetUrl('http://127.0.0.1:8080/health')).toThrow();
    expect(() => validatePreviewTargetUrl('http://169.254.169.254/latest/meta-data')).toThrow();

    const ok = validatePreviewTargetUrl('https://example.com/docs/article?id=42');
    expect(ok.hostname).toBe('example.com');
    expect(ok.protocol).toBe('https:');
  });

  it('extracts OpenGraph metadata, resolves relative image URLs, and decodes entities', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Fallback &amp; Title</title>
          <meta property="og:title" content="Deep Dive &quot;Streaming&quot; &amp; UX" />
          <meta name="description" content="Fallback description" />
          <meta property="og:description" content="Fast link preview with SSRF protection&#39;s check." />
          <meta property="og:image" content="/assets/cover.png" />
          <meta property="og:site_name" content="Example Blog" />
        </head>
      </html>
    `;

    const meta = parseOpenGraphMetadata(html, 'https://example.com/posts/wave-4');
    expect(meta.title).toBe('Deep Dive "Streaming" & UX');
    expect(meta.description).toBe("Fast link preview with SSRF protection's check.");
    expect(meta.image).toBe('https://example.com/assets/cover.png');
    expect(meta.siteName).toBe('Example Blog');
    expect(meta.hostname).toBe('example.com');

    const titleFallback = parseOpenGraphMetadata(
      '<html><head><title>Plain &lt;Page&gt;</title></head></html>',
      'https://plain.example.org/hello',
    );
    expect(titleFallback.title).toBe('Plain <Page>');
    expect(titleFallback.siteName).toBe('plain.example.org');
  });
});
