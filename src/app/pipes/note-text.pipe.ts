import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import type { NoteMention } from '../dto/customer.dto';
import { escapeHtml, linkifyEscapedHtml } from './linkify.pipe';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ข้อความโน้ต/comment → HTML ที่ลิงก์ URL ได้ และ highlight "@ชื่อ" ของคนที่ถูกแท็ก
// ใช้ชื่อจริงที่ backend คืนมา (mentions) แทน /@\S+/ เพราะชื่อมีเว้นวรรคได้ ("@Somchai Jaidee")
// split ข้อความตามชื่อก่อน แล้ว escape/linkify แต่ละท่อนแยกกัน — กัน URL ที่ติดกับ @ชื่อ ถูก tag ของ highlight ตัดกลาง และ escape ทุกท่อนก่อนใส่ innerHTML เสมอ (กัน XSS)
@Pipe({
  name: 'noteText',
  standalone: true,
})
export class NoteTextPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  // input: ข้อความ + คนที่ถูกแท็กในข้อความนั้น — output: SafeHtml
  transform(text: string | null | undefined, mentions?: readonly NoteMention[] | null): SafeHtml {
    if (!text) return '';

    const names = [...new Set((mentions ?? []).map((m) => m.name).filter((name) => name.length > 0))].sort(
      (a, b) => b.length - a.length,
    );
    if (names.length === 0) {
      return this.sanitizer.bypassSecurityTrustHtml(linkifyEscapedHtml(escapeHtml(text)));
    }

    // ชื่อยาวสุดก่อน กัน "@Bob" ไปกินครึ่งหน้าของ "@Bob Smith"; lookbehind กันอีเมล (a@Bob.com); lookahead กันชื่อที่เป็นแค่ส่วนต้นของคำอื่น
    // \p{M} รวมสระ/วรรณยุกต์ภาษาไทย ที่ \p{L} ไม่ครอบคลุม
    const pattern = new RegExp(`((?<=^|\\s)@(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{M}\\p{N}]))`, 'gu');
    // split ที่มี capture group: index คี่ = ส่วนที่เป็น mention
    const html = text
      .split(pattern)
      .map((part, index) =>
        index % 2 === 1
          ? `<span class="note-mention">${escapeHtml(part)}</span>`
          : linkifyEscapedHtml(escapeHtml(part)),
      )
      .join('');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
