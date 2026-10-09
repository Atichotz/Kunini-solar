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

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

// input: ข้อความที่ escape HTML แล้ว — output: HTML ที่แปลง URL เป็น <a> (ต้อง escape ก่อนเสมอ ไม่งั้น URL pattern จะหลุด tag เข้ามา)
export function linkifyEscapedHtml(escaped: string): string {
  return escaped.replace(URL_PATTERN, (match) => {
    const href = match.startsWith('www.') ? `https://${match}` : match;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`;
  });
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

    const linked = linkifyEscapedHtml(escapeHtml(text));

    return this.sanitizer.bypassSecurityTrustHtml(linked);
  }
}
