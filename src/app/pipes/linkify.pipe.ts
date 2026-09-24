import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// escape ก่อน insert เป็น innerHTML เสมอ กัน note text ที่มี <script>/HTML tag หลุดเข้าไปเป็น XSS
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

@Pipe({
  name: 'linkify',
  standalone: true,
})
export class LinkifyPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(text: string | null | undefined): SafeHtml {
    if (!text) {
      return '';
    }

    const escaped = escapeHtml(text);
    const linked = escaped.replace(URL_PATTERN, (match) => {
      const href = match.startsWith('www.') ? `https://${match}` : match;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    });

    return this.sanitizer.bypassSecurityTrustHtml(linked);
  }
}
