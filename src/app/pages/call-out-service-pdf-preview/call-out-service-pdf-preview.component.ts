import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CallOutServiceReportService } from '../../services/call-out-service-report.service';
import type {
  CallOutPhotoSlot,
  CallOutResolutionStatus,
  CallOutServiceReportDetail,
} from '../../dto/call-out-service-report.dto';
import { QUOTATION_HARDCODE } from '../pdf-bos-preview/quotation-hardcode';

/** รูปที่พร้อมวางใน PDF — caption บอกว่าเป็นรูปของ slot ไหน */
interface PdfPhoto {
  url: string;
  caption: string;
}

const SLOT_CAPTIONS: Record<CallOutPhotoSlot, string> = {
  preWork1: 'Pre-Work Photo (Issue)',
  preWork2: 'Pre-Work Photo (Issue)',
  postWork1: 'Post-Work Photo (Resolution)',
  postWork2: 'Post-Work Photo (Resolution)',
};

// ค่าใน DB → ข้อความที่ลูกค้าอ่านรู้เรื่อง (ตรงกับตัวเลือกในฟอร์ม)
const RESOLUTION_STATUS_LABELS: Record<CallOutResolutionStatus, string> = {
  resolved: 'Resolved (Fully Operational)',
  monitoring: 'Monitoring (Requires Observation)',
  unresolved: 'Unresolved (Requires Return Visit)',
};

// ===== ค่าที่ใช้จัดหน้า (ต้องตรงกับ scss: แผ่น A4 สูง 297mm, ขอบ 12mm, ช่องไฟระหว่างแผ่นบนจอ 12mm) =====
const PX_PER_MM = 96 / 25.4;
const SHEET_HEIGHT_MM = 297;
const SHEET_GAP_MM = 12;
const SHEET_PADDING_MM = 12;
// พื้นที่เนื้อหาต่อหน้า = 297 − 12×2 = 273mm หักเผื่ออีก 2mm กัน Chrome ตัดหน้าตอนพิมพ์ก่อนจุดที่คำนวณ (เศษพิกเซล/ฟอนต์ต่างกันนิดหน่อย)
const PAGE_CONTENT_MM = 271;
const PHOTOS_PER_ROW = 3;

// รอรูปโหลดนานสุดเท่านี้ก่อนพิมพ์ — กัน print ค้างถ้า signed URL ช้า/เสีย (รูปที่ยังไม่มาจะว่างใน PDF)
const IMAGE_WAIT_TIMEOUT_MS = 10_000;

/**
 * หน้าพรีวิว Call Out Service Report สำหรับปุ่ม Export to PDF ของ call-out-service-report-page
 *
 * เทียบ Angular: component ที่เป็น "view" ล้วนๆ เหมือน site-survey-pdf-preview — ดึงรายงานที่ save แล้วด้วย
 * reportId จาก query param (refresh ได้ และ signed URL ของรูปสดใหม่ทุกครั้งที่เปิด)
 *
 * ผังหน้า: หน้า 1 = S1+S2 (+รูป Pre-Work), หน้า 2 = S3+S4 (+รูป Post-Work) — กลุ่มไหนล้นจะไหลไปหน้าถัดไปเอง
 */
@Component({
  selector: 'app-call-out-service-pdf-preview',
  imports: [DatePipe, NgTemplateOutlet, RouterLink, ButtonModule],
  templateUrl: './call-out-service-pdf-preview.component.html',
  styleUrl: './call-out-service-pdf-preview.component.scss',
})
export class CallOutServicePdfPreviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly reportService = inject(CallOutServiceReportService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly hc = QUOTATION_HARDCODE;

  readonly report = signal<CallOutServiceReportDetail | null>(null);
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  /** true เมื่อจัดหน้าเสร็จแล้ว — ก่อนหน้านี้ซ่อนเอกสารไว้ (กันภาพกระพริบ) และห้ามพิมพ์ */
  readonly isPaginated = signal(false);
  /** ความสูงรวมของแผ่นทั้งหมดบนจอ (mm) — null = ยังไม่รู้จำนวนแผ่น */
  readonly docHeightMm = signal<number | null>(null);
  /** true ระหว่างรอรูป decode ก่อนเปิด print dialog — กันกดซ้ำ */
  readonly isPreparingPrint = signal(false);

  /** ปุ่ม X: กลับฟอร์ม call out เดิม (เปิดรายงานเดิมด้วย reportId) ถ้าโหลดไม่สำเร็จไป dashboard */
  readonly backLink = computed<string[]>(() => (this.report() ? ['/call-out-service-report'] : ['/dashboard']));
  readonly backQueryParams = computed<Params | null>(() => {
    const report = this.report();
    return report ? { customerId: report.customerId, reportId: report.id } : null;
  });

  // รูปจัดเป็นแถวละ 3 ใบ: 1 แถว = 1 ก้อนที่ตัดหน้าได้ (ดู paginate())
  readonly preWorkPhotoRows = computed<PdfPhoto[][]>(() => chunk(this.photosOf(['preWork1', 'preWork2']), PHOTOS_PER_ROW));
  readonly postWorkPhotoRows = computed<PdfPhoto[][]>(() => chunk(this.photosOf(['postWork1', 'postWork2']), PHOTOS_PER_ROW));

  readonly resolutionStatusLabel = computed<string>(() => {
    const status = this.report()?.resolutionStatus;
    return status ? RESOLUTION_STATUS_LABELS[status] : '—';
  });

  ngOnInit(): void {
    const reportId = this.route.snapshot.queryParamMap.get('reportId');
    if (!reportId) {
      this.isLoading.set(false);
      this.errorMessage.set('No report selected. Please open the Call Out Service Report and click Export to PDF again');
      return;
    }

    this.reportService
      .getOne(reportId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.isLoading.set(false);
          // รอ Angular render เนื้อหาเสร็จก่อนค่อยวัดความสูงแต่ละก้อน
          afterNextRender(() => void this.paginate(), { injector: this.injector });
        },
        error: (err: HttpErrorResponse) => {
          console.error('[API] Failed to load call out service report for PDF:', err);
          this.isLoading.set(false);
          this.errorMessage.set(
            err.status === 404
              ? 'This report no longer exists. It may have been deleted'
              : 'Failed to load the report. Please try again',
          );
        },
      });
  }

  /**
   * เปิด print dialog (ผู้ใช้เลือก "Save as PDF" เอง) — รอรูปทุกรูป decode ก่อน ไม่งั้นรูปที่ยังโหลดไม่เสร็จจะว่างใน PDF
   * ตั้ง document.title ชั่วคราวเป็นชื่อไฟล์ที่อ่านรู้เรื่อง แล้วคืนค่าเดิมหลังพิมพ์เสร็จ/ยกเลิก
   */
  async print(): Promise<void> {
    const report = this.report();
    if (!report || this.isPreparingPrint()) return;

    this.isPreparingPrint.set(true);
    try {
      await this.waitForImages();

      const originalTitle = document.title;
      // เก็บเฉพาะตัวอักษร/ตัวเลข/ไทย/._- ที่เหลือแทนด้วย _ กันชื่อไฟล์เพี้ยน
      const safeName = (report.customerName || 'call-out').replace(/[^\w฀-๿.-]+/g, '_');
      const dateStr = new Date(report.callOutDateTime ?? report.createdAt).toLocaleDateString('en-GB').replace(/\//g, '-'); // dd-MM-yyyy
      document.title = `Call-Out-Service-Report-${safeName}-${dateStr}`;

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
   * (หลักการเดียวกับ SiteSurveyPdfPreviewComponent.paginate — ดูคำอธิบายเต็มที่นั่น)
   *
   * - .pg-new  = ขึ้นหน้าใหม่เสมอ (จุดเริ่มกลุ่ม: S1 และ S3)
   * - .pg-keep = หัวข้อ: ถ้าก้อนถัดไปไม่พอที่ในหน้านี้ ให้ย้ายหัวข้อไปหน้าใหม่ด้วย ไม่ปล่อยค้างท้ายหน้า
   * - ก้อนแรกของแต่ละหน้า (หน้า 2 เป็นต้นไป) ได้ class .pg-start:
   *     บนจอ → margin-top (--pg-skip) ดันลงไปอยู่ในแผ่นถัดไป / ตอนพิมพ์ → break-before: page
   *
   * ก้อนเดียวที่สูงเกินหน้า (เช่นข้อความยาวมาก) แบ่งไม่ได้ จะล้นแผ่นนั้น
   */
  private async paginate(): Promise<void> {
    try {
      await document.fonts.ready;
    } catch {
      // ไม่รอฟอนต์ได้ก็จัดหน้าต่อ — แค่อาจคลาดเคลื่อนเล็กน้อย
    }

    const doc = this.host.nativeElement.querySelector<HTMLElement>('.callout-doc');
    if (!doc) return;

    try {
      const blocks = Array.from(doc.querySelectorAll<HTMLElement>('.pg-block'));
      // ล้างผลรอบก่อนทิ้ง เพื่อวัดตำแหน่งตามการไหลปกติ
      for (const block of blocks) {
        block.classList.remove('pg-start');
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
        blocks[startIndex].style.setProperty('--pg-skip', `${skipPx}px`);
        shift = previousBottom + skipPx - rects[startIndex].top;
      });

      const sheetCount = pageStartIndexes.length;
      this.docHeightMm.set(sheetCount * SHEET_HEIGHT_MM + (sheetCount - 1) * SHEET_GAP_MM);
    } catch (err) {
      // จัดหน้าพัง → แสดงแบบไหลต่อเนื่องไปก่อน (ไม่มีจุดตัดหน้าที่แม่น) ดีกว่าหน้าว่าง
      console.error('[PDF] Failed to paginate call out service report preview:', err);
    } finally {
      this.isPaginated.set(true);
    }
  }

  // รอ <img> ทุกใบใน .callout-doc ถอดรหัสเสร็จ; รูปเสีย/ช้าเกิน timeout ไม่บล็อกการพิมพ์
  private async waitForImages(): Promise<void> {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.callout-doc img'));
    const allDecoded = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_WAIT_TIMEOUT_MS));
    await Promise.race([allDecoded, timeout]);
  }

  // input: slot ที่ต้องการรวมเป็น grid เดียว / output: รูปเรียงตาม slot แล้วตามลำดับในรายงาน ข้ามรูปที่ไฟล์หาย (url = '')
  private photosOf(slots: readonly CallOutPhotoSlot[]): PdfPhoto[] {
    const report = this.report();
    if (!report) return [];
    return slots.flatMap((slot) =>
      report.photosBySlot[slot]
        .filter((photo) => photo.url !== '')
        .map((photo) => ({ url: photo.url, caption: SLOT_CAPTIONS[slot] })),
    );
  }
}

// input: รายการ + ขนาดแถว / output: รายการแบ่งเป็นแถวๆ ละไม่เกิน size (ว่าง → [])
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
