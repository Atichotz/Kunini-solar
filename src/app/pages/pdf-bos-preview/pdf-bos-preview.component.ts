import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { QuotationPreviewService } from '../../services/quotation-preview.service';
import { QUOTATION_HARDCODE } from './quotation-hardcode';

interface PaymentTermRow {
  label: string;
  percentLabel: string;
  amount: number;
}

// ===== ค่าที่ใช้จัดหน้า (ต้องตรงกับ scss: แผ่น A4 สูง 297mm, ขอบ 12mm, ช่องไฟระหว่างแผ่นบนจอ 12mm) =====
const PX_PER_MM = 96 / 25.4;
const SHEET_HEIGHT_MM = 297;
const SHEET_GAP_MM = 12;
const SHEET_PADDING_MM = 12;
// พื้นที่เนื้อหาต่อหน้า = 297 − 12×2 = 273mm หักเผื่ออีก 2mm กัน Chrome ตัดหน้าตอนพิมพ์ก่อนจุดที่คำนวณ (เศษพิกเซล/ฟอนต์ต่างกันนิดหน่อย)
const PAGE_CONTENT_MM = 271;

// รอรูปโหลดนานสุดเท่านี้ก่อนพิมพ์ — กัน print ค้างถ้ารูปช้า/เสีย (รูปที่ยังไม่มาจะว่างใน PDF)
const IMAGE_WAIT_TIMEOUT_MS = 10_000;

/**
 * หน้าพรีวิวใบเสนอราคาสำหรับปุ่ม Export to PDF ของ estimate-page
 *
 * เทียบ Angular: component ธรรมดา แต่ทำหน้าที่เป็น "view" ล้วนๆ — ไม่มี business logic
 * อ่าน snapshot จาก QuotationPreviewService (signal) แล้ว render ตาม layout ใบเสนอราคา
 * การพิมพ์ใช้ window.print() + @media print ใน scss (ไม่มี lib ทำ PDF ในโปรเจกต์)
 *
 * snapshot ว่าง (refresh / เปิด URL ตรง) → โชว์ empty state + ปุ่มกลับ ไม่ redirect อัตโนมัติ
 *
 * การตัดหน้า: เนื้อหาเรียงเป็น .pg-block ต่อกัน แล้ว paginate() วัด/จัดลงแผ่น A4 ให้จอ = ตอนพิมพ์ (วิธีเดียวกับ site-survey-pdf-preview)
 */
@Component({
  selector: 'app-pdf-bos-preview',
  imports: [DecimalPipe, DatePipe, RouterLink, ButtonModule],
  templateUrl: './pdf-bos-preview.component.html',
  styleUrl: './pdf-bos-preview.component.scss',
})
export class PdfBosPreviewComponent {
  private readonly quotationPreview = inject(QuotationPreviewService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly hc = QUOTATION_HARDCODE;
  readonly snapshot = this.quotationPreview.snapshot;

  /** จัดหน้าเสร็จแล้ว — ก่อนหน้านั้นซ่อนเอกสารไว้กันภาพกระโดด และปิดปุ่ม Print */
  readonly isPaginated = signal(false);
  /** ความสูงรวมของทุกแผ่น (mm) สำหรับวาดแผ่นขาวบนจอ; null = ยังไม่จัดหน้า */
  readonly docHeightMm = signal<number | null>(null);
  readonly isPreparingPrint = signal(false);

  constructor() {
    effect(() => {
      // snapshot เปลี่ยน → รอ Angular render เนื้อหาใหม่เสร็จก่อนค่อยวัดความสูงแต่ละก้อน
      if (!this.snapshot()) return;
      this.isPaginated.set(false);
      afterNextRender(() => void this.paginate(), { injector: this.injector });
    });
  }

  /** ปุ่ม X / กลับ: กลับหน้า estimate เดิมถ้ารู้ customerId ไม่งั้นไป dashboard */
  readonly backLink = computed<string[]>(() => {
    const customerId = this.snapshot()?.customerId;
    return customerId ? ['/detail', customerId] : ['/dashboard'];
  });

  /**
   * วันหมดอายุ = issuedDateIso + validityDays
   * บวกด้วย setDate (ไม่บวก ms) เพื่อไม่ให้ DST/timezone ทำวันเลื่อน; date pipe แสดงเป็น local เหมือนช่อง Date
   */
  readonly validityUntil = computed<Date | null>(() => {
    const snap = this.snapshot();
    if (!snap) return null;
    const until = new Date(snap.issuedDateIso);
    until.setDate(until.getDate() + snap.validityDays);
    return until;
  });

  /** Remarks: ใช้เฉพาะหมายเหตุที่ผู้ใช้กรอก (แทนที่ข้อความมาตรฐานใน quotation-hardcode.ts) */
  readonly remarks = computed<string[]>(() => this.snapshot()?.remarkLines ?? []);

  /** เงื่อนไขชำระเงิน: คิดจำนวนเงินจาก grandTotal ตามสัดส่วนใน quotation-hardcode.ts */
  readonly paymentTerms = computed<PaymentTermRow[]>(() => {
    const grandTotal = this.snapshot()?.grandTotal ?? 0;
    return this.hc.payment.map((p) => ({
      label: p.label,
      percentLabel: `${Math.round(p.percent * 100)}%`,
      amount: Math.round(grandTotal * p.percent * 100) / 100,
    }));
  });

  /**
   * เปิด print dialog ของเบราว์เซอร์ (ผู้ใช้เลือกปลายทาง "Save as PDF" เอง — เว็บสั่งเซฟไฟล์เงียบๆ ไม่ได้)
   * รอรูป (logo) decode ก่อน ไม่งั้นรูปที่ยังโหลดไม่เสร็จจะว่างใน PDF
   * ตั้ง document.title ชั่วคราวเป็นชื่อไฟล์ที่อ่านรู้เรื่อง แล้วคืนค่าเดิมเมื่อพิมพ์เสร็จ/ยกเลิก
   */
  async print(): Promise<void> {
    const snap = this.snapshot();
    if (!snap || this.isPreparingPrint()) return;

    this.isPreparingPrint.set(true);
    try {
      await this.waitForImages();

      const originalTitle = document.title;
      // เก็บเฉพาะตัวอักษร/ตัวเลข/ไทย/._- ที่เหลือแทนด้วย _ กันชื่อไฟล์เพี้ยน
      const safeName = (snap.customerName || 'quotation').replace(/[^\w฀-๿.-]+/g, '_');
      const dateStr = new Date(snap.issuedDateIso).toLocaleDateString('en-GB').replace(/\//g, '-'); // dd-MM-yyyy
      document.title = `Quotation-${safeName}-${dateStr}`;

      const restore = (): void => {
        document.title = originalTitle;
        window.removeEventListener('afterprint', restore);
      };
      window.addEventListener('afterprint', restore);

      window.print();
    } finally {
      this.isPreparingPrint.set(false);
    }
  }

  /**
   * จัดหน้า: วัดความสูงจริงของทุก .pg-block แล้วจัดลงหน้า A4 แบบ greedy ให้บนจอ = ตอนพิมพ์
   *
   * - .pg-new  = ขึ้นหน้าใหม่เสมอ (BOS ไม่ใช้ — ผังไหลต่อเนื่อง; คงไว้ให้ตรงกับ survey)
   * - .pg-keep = หัวข้อ: ถ้าก้อนถัดไปไม่พอที่ในหน้านี้ ให้ย้ายหัวข้อไปหน้าใหม่ด้วย ไม่ปล่อยค้างท้ายหน้า
   * - ก้อนแรกของแต่ละหน้า (หน้า 2 เป็นต้นไป) ได้ class .pg-start:
   *     บนจอ → margin-top (--pg-skip) ดันลงไปอยู่ในแผ่นถัดไป / ตอนพิมพ์ → break-before: page
   * - ก้อนสุดท้ายของแต่ละหน้า (ก่อน .pg-start) ได้ class .pg-end ให้ก้อนที่เป็นส่วนของกรอบตาราง (.q-boxed) ปิดเส้นล่าง/เส้นบนตรงรอยตัดหน้า
   *
   * ก้อนเดียวที่สูงเกินหน้า (เช่น Remarks ยาวมาก) แบ่งไม่ได้ จะล้นแผ่นนั้น และพื้นหลังแผ่นถัดๆ ไปอาจเหลื่อมเล็กน้อย
   * logo สูงตายตัวใน scss จึงวัดได้ทันทีไม่ต้องรอรูปโหลด; รอเฉพาะฟอนต์เพราะมีผลกับการตัดบรรทัด
   */
  private async paginate(): Promise<void> {
    try {
      await document.fonts.ready;
    } catch {
      // ไม่รอฟอนต์ได้ก็จัดหน้าต่อ — แค่อาจคลาดเคลื่อนเล็กน้อย
    }

    const doc = this.host.nativeElement.querySelector<HTMLElement>('.quote-doc');
    if (!doc) return;

    try {
      const blocks = Array.from(doc.querySelectorAll<HTMLElement>('.pg-block'));
      // ล้างผลรอบก่อนทิ้ง เพื่อวัดตำแหน่งตามการไหลปกติ
      for (const block of blocks) {
        block.classList.remove('pg-start', 'pg-end');
        block.style.removeProperty('--pg-skip');
      }
      if (blocks.length === 0) return;

      const docTop = doc.getBoundingClientRect().top;
      const rects = blocks.map((block) => {
        const rect = block.getBoundingClientRect();
        return { top: rect.top - docTop, bottom: rect.bottom - docTop };
      });

      // 1) หาว่าก้อนไหนเป็นก้อนแรกของแต่ละหน้า
      const capacityPx = PAGE_CONTENT_MM * PX_PER_MM;
      const pageStartIndexes: number[] = [0];
      let pageTop = rects[0].top;
      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        // หัวข้อต้องมีก้อนถัดไปอยู่หน้าเดียวกัน
        const needsNext = block.classList.contains('pg-keep') && i + 1 < blocks.length;
        const bottom = needsNext ? Math.max(rects[i].bottom, rects[i + 1].bottom) : rects[i].bottom;
        if (block.classList.contains('pg-new') || bottom - pageTop > capacityPx) {
          pageStartIndexes.push(i);
          pageTop = rects[i].top;
        }
      }

      // 2) บนจอ: ดันก้อนแรกของแต่ละหน้าลงไปอยู่ในแผ่นของมัน (ตำแหน่งแผ่น p = p × (สูง+ช่องไฟ))
      let shift = 0; // ระยะที่ก้อนในหน้าปัจจุบันถูกดันลงจากตำแหน่งเดิมแล้ว
      pageStartIndexes.forEach((startIndex, page) => {
        if (page === 0) return;
        const desiredTop = (page * (SHEET_HEIGHT_MM + SHEET_GAP_MM) + SHEET_PADDING_MM) * PX_PER_MM;
        const previousBottom = rects[startIndex - 1].bottom + shift;
        // ติดลบได้เมื่อหน้าก่อนหน้าล้นแผ่น (ก้อนสูงเกินหน้า) — ไม่ให้ซ้อนทับ ยอมเลื่อนลงตามจริง
        const skipPx = Math.max(desiredTop - previousBottom, 0);
        blocks[startIndex].classList.add('pg-start');
        blocks[startIndex - 1].classList.add('pg-end');
        blocks[startIndex].style.setProperty('--pg-skip', `${skipPx}px`);
        shift = previousBottom + skipPx - rects[startIndex].top;
      });

      const sheetCount = pageStartIndexes.length;
      this.docHeightMm.set(sheetCount * SHEET_HEIGHT_MM + (sheetCount - 1) * SHEET_GAP_MM);
    } catch (err) {
      // จัดหน้าพัง → แสดงแบบไหลต่อเนื่องไปก่อน (ไม่มีจุดตัดหน้าที่แม่น) ดีกว่าหน้าว่าง
      console.error('[PDF] Failed to paginate quotation preview:', err);
    } finally {
      this.isPaginated.set(true);
    }
  }

  // รอ <img> ทุกใบใน .quote-doc ถอดรหัสเสร็จ; รูปเสีย/ช้าเกิน timeout ไม่บล็อกการพิมพ์
  private async waitForImages(): Promise<void> {
    const images = Array.from(this.host.nativeElement.querySelectorAll<HTMLImageElement>('.quote-doc img'));
    const allDecoded = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_WAIT_TIMEOUT_MS));
    await Promise.race([allDecoded, timeout]);
  }
}
