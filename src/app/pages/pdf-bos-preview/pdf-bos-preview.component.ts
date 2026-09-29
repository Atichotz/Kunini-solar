import { Component, computed, inject } from '@angular/core';
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

/**
 * หน้าพรีวิวใบเสนอราคาสำหรับปุ่ม Export to PDF ของ estimate-page
 *
 * เทียบ Angular: component ธรรมดา แต่ทำหน้าที่เป็น "view" ล้วนๆ — ไม่มี business logic
 * อ่าน snapshot จาก QuotationPreviewService (signal) แล้ว render ตาม layout ใบเสนอราคา
 * การพิมพ์ใช้ window.print() + @media print ใน scss (ไม่มี lib ทำ PDF ในโปรเจกต์)
 *
 * snapshot ว่าง (refresh / เปิด URL ตรง) → โชว์ empty state + ปุ่มกลับ ไม่ redirect อัตโนมัติ
 */
@Component({
  selector: 'app-pdf-bos-preview',
  imports: [DecimalPipe, DatePipe, RouterLink, ButtonModule],
  templateUrl: './pdf-bos-preview.component.html',
  styleUrl: './pdf-bos-preview.component.scss',
})
export class PdfBosPreviewComponent {
  private readonly quotationPreview = inject(QuotationPreviewService);

  readonly hc = QUOTATION_HARDCODE;
  readonly snapshot = this.quotationPreview.snapshot;

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
   * ตั้ง document.title ชั่วคราวเป็นชื่อไฟล์ที่อ่านรู้เรื่อง แล้วคืนค่าเดิมเมื่อพิมพ์เสร็จ/ยกเลิก
   */
  print(): void {
    const snap = this.snapshot();
    if (!snap) return;

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
  }
}
