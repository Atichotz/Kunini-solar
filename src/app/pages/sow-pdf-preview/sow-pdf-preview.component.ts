import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CustomerService } from '../../services/customer.service';
import { SowService } from '../../services/sow.service';
import type { SowDetail, SowMachineryFlags, SowWeather } from '../../dto/sow.dto';
import { QUOTATION_HARDCODE } from '../pdf-bos-preview/quotation-hardcode';

/** รูป EOD ที่พร้อมวางใน PDF */
interface PdfPhoto {
  url: string;
  alt: string;
}

interface DayView {
  label: string;
  date: string | null;
  status: string;
  headcount: number | null;
  leadTech: string | null;
  subcontractorNotes: string | null;
  /** ชื่อเครื่องจักรที่ติ๊กไว้เท่านั้น — ว่าง = ไม่ได้ใช้ */
  machinery: string[];
  machineryNotes: string | null;
  /** task ที่ว่างถูกตัดออกแล้ว */
  tasks: string[];
}

interface EodView {
  label: string;
  date: string | null;
  weatherLabel: string;
  progressNotes: string | null;
  photoRows: PdfPhoto[][];
}

const WEATHER_LABELS: Record<SowWeather, string> = {
  clear: 'Clear / Sunny',
  overcast: 'Overcast',
  rain: 'Rain (Delayed)',
};

const MACHINERY_LABELS: Record<keyof SowMachineryFlags, string> = {
  scaffolding: 'Scaffolding',
  mobileCrane: 'Mobile Crane',
  boomLift: 'Boom Lift',
  fallProtection: 'Fall Protection',
  generator: 'Generator',
};

// ===== ค่าที่ใช้จัดหน้า (ต้องตรงกับ scss: แผ่น A4 สูง 297mm, ขอบ 12mm, ช่องไฟระหว่างแผ่นบนจอ 12mm) =====
const PX_PER_MM = 96 / 25.4;
const SHEET_HEIGHT_MM = 297;
const SHEET_GAP_MM = 12;
const SHEET_PADDING_MM = 12;
// พื้นที่เนื้อหาต่อหน้า = 297 − 12×2 = 273mm หักเผื่ออีก 2mm กัน Chrome ตัดหน้าตอนพิมพ์ก่อนจุดที่คำนวณ
const PAGE_CONTENT_MM = 271;
const PHOTOS_PER_ROW = 3;

// รอรูปโหลดนานสุดเท่านี้ก่อนพิมพ์ — กัน print ค้างถ้า signed URL ช้า/เสีย (รูปที่ยังไม่มาจะว่างใน PDF)
const IMAGE_WAIT_TIMEOUT_MS = 10_000;

/**
 * หน้าพรีวิว Scope of Work สำหรับปุ่ม Export to PDF ของ sow-page
 *
 * เทียบ Angular: component "view" ล้วนๆ เหมือน site-survey-pdf-preview — ดึง SOW ที่ save แล้วด้วย sowId จาก query param
 * (refresh ได้ และ signed URL ของรูปสดใหม่ทุกครั้ง) ชื่อลูกค้า/ที่อยู่ดึงจาก customer เพราะ SowDetail ไม่มีสองค่านี้
 */
@Component({
  selector: 'app-sow-pdf-preview',
  imports: [DatePipe, NgTemplateOutlet, RouterLink, ButtonModule],
  templateUrl: './sow-pdf-preview.component.html',
  styleUrl: './sow-pdf-preview.component.scss',
})
export class SowPdfPreviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly sowService = inject(SowService);
  private readonly customerService = inject(CustomerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly hc = QUOTATION_HARDCODE;

  readonly sow = signal<SowDetail | null>(null);
  readonly customerName = signal('');
  readonly customerAddress = signal('');
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  /** true เมื่อจัดหน้าเสร็จแล้ว — ก่อนหน้านี้ซ่อนเอกสารไว้ (กันภาพกระพริบ) และห้ามพิมพ์ */
  readonly isPaginated = signal(false);
  /** ความสูงรวมของแผ่นทั้งหมดบนจอ (mm) — null = ยังไม่รู้จำนวนแผ่น */
  readonly docHeightMm = signal<number | null>(null);
  /** true ระหว่างรอรูป decode ก่อนเปิด print dialog — กันกดซ้ำ */
  readonly isPreparingPrint = signal(false);

  /** ปุ่ม X: กลับฟอร์ม SOW เดิม ถ้าโหลดไม่สำเร็จไป dashboard */
  readonly backLink = computed<string[]>(() => (this.sow() ? ['/sow'] : ['/dashboard']));
  readonly backQueryParams = computed<Params | null>(() => {
    const sow = this.sow();
    return sow ? { customerId: sow.customerId, sowId: sow.id } : null;
  });

  readonly dayViews = computed<DayView[]>(() =>
    (this.sow()?.days ?? []).map((day, index) => ({
      label: `Day ${index + 1}`,
      date: day.date,
      status: day.status,
      headcount: day.headcount,
      leadTech: day.leadTech,
      subcontractorNotes: day.subcontractorNotes,
      machinery: (Object.keys(MACHINERY_LABELS) as (keyof SowMachineryFlags)[])
        .filter((key) => day.machinery[key])
        .map((key) => MACHINERY_LABELS[key]),
      machineryNotes: day.machineryNotes,
      tasks: day.tasks.map((task) => task.text.trim()).filter((text) => text !== ''),
    })),
  );

  /** รูปที่ไฟล์ใน storage หาย (url = '') ถูกข้ามตั้งแต่ตรงนี้ ไม่ให้เกิดกรอบรูปเสียใน PDF */
  readonly eodViews = computed<EodView[]>(() =>
    (this.sow()?.eodReports ?? []).map((report, index) => ({
      label: `Report: Day ${index + 1}`,
      date: report.date,
      weatherLabel: WEATHER_LABELS[report.weather] ?? report.weather,
      progressNotes: report.progressNotes,
      photoRows: chunk(
        report.photos.filter((p) => p.url !== '').map((p) => ({ url: p.url, alt: p.fileName })),
        PHOTOS_PER_ROW,
      ),
    })),
  );

  ngOnInit(): void {
    const sowId = this.route.snapshot.queryParamMap.get('sowId');
    if (!sowId) {
      this.isLoading.set(false);
      this.errorMessage.set('No SOW selected. Please open the SOW page and click Export to PDF again');
      return;
    }

    this.sowService
      .getOne(sowId)
      .pipe(
        switchMap((sow) =>
          // โหลดลูกค้าไม่ได้ไม่ควรทำให้ทั้งเอกสารพัง — ปล่อยชื่อ/ที่อยู่เป็น '—'
          this.customerService.getOne(sow.customerId).pipe(
            catchError((err: unknown) => {
              console.error('[API] Failed to load customer for SOW PDF:', err);
              return of(null);
            }),
            map((customer) => {
              this.customerName.set(customer?.displayName ?? '');
              this.customerAddress.set(customer?.fullAddress ?? '');
              return sow;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (sow) => {
          this.sow.set(sow);
          this.isLoading.set(false);
          // รอ Angular render เนื้อหาเสร็จก่อนค่อยวัดความสูงแต่ละก้อน
          afterNextRender(() => void this.paginate(), { injector: this.injector });
        },
        error: (err: HttpErrorResponse) => {
          console.error('[API] Failed to load SOW for PDF:', err);
          this.isLoading.set(false);
          this.errorMessage.set(
            err.status === 404
              ? 'This SOW no longer exists. It may have been deleted'
              : 'Failed to load the SOW. Please try again',
          );
        },
      });
  }

  /**
   * เปิด print dialog (ผู้ใช้เลือก "Save as PDF" เอง) — รอรูปทุกรูป decode ก่อน ไม่งั้นรูปที่ยังโหลดไม่เสร็จจะว่างใน PDF
   * ตั้ง document.title ชั่วคราวเป็นชื่อไฟล์ที่อ่านรู้เรื่อง แล้วคืนค่าเดิมหลังพิมพ์เสร็จ/ยกเลิก
   */
  async print(): Promise<void> {
    const sow = this.sow();
    if (!sow || this.isPreparingPrint()) return;

    this.isPreparingPrint.set(true);
    try {
      await this.waitForImages();

      const originalTitle = document.title;
      // เก็บเฉพาะตัวอักษร/ตัวเลข/ไทย/._- ที่เหลือแทนด้วย _ กันชื่อไฟล์เพี้ยน
      const safeName = (this.customerName() || 'sow').replace(/[^\w฀-๿.-]+/g, '_');
      const dateStr = new Date(sow.updatedAt).toLocaleDateString('en-GB').replace(/\//g, '-'); // dd-MM-yyyy
      document.title = `SOW-${safeName}-${dateStr}`;

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
   * - .pg-new  = ขึ้นหน้าใหม่เสมอ
   * - .pg-keep = หัวข้อ: ถ้าก้อนถัดไปไม่พอที่ในหน้านี้ ให้ย้ายหัวข้อไปหน้าใหม่ด้วย ไม่ปล่อยค้างท้ายหน้า
   * - ก้อนแรกของแต่ละหน้า (หน้า 2 เป็นต้นไป) ได้ class .pg-start:
   *     บนจอ → margin-top (--pg-skip) ดันลงไปอยู่ในแผ่นถัดไป / ตอนพิมพ์ → break-before: page
   *
   * รูปสูงตายตัวใน scss จึงวัดได้ทันทีไม่ต้องรอรูปโหลด; รอเฉพาะฟอนต์เพราะมีผลกับการตัดบรรทัด
   * ก้อนเดียวที่สูงเกินหน้า (เช่น ข้อความยาวมาก) แบ่งไม่ได้ จะล้นแผ่นนั้น
   */
  private async paginate(): Promise<void> {
    try {
      await document.fonts.ready;
    } catch {
      // ไม่รอฟอนต์ได้ก็จัดหน้าต่อ — แค่อาจคลาดเคลื่อนเล็กน้อย
    }

    const doc = this.host.nativeElement.querySelector<HTMLElement>('.sow-doc');
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
      console.error('[PDF] Failed to paginate SOW preview:', err);
    } finally {
      this.isPaginated.set(true);
    }
  }

  // รอ <img> ทุกใบใน .sow-doc ถอดรหัสเสร็จ; รูปเสีย/ช้าเกิน timeout ไม่บล็อกการพิมพ์
  private async waitForImages(): Promise<void> {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.sow-doc img'));
    const allDecoded = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_WAIT_TIMEOUT_MS));
    await Promise.race([allDecoded, timeout]);
  }
}

// input: รายการ + ขนาดแถว / output: รายการแบ่งเป็นแถวๆ ละไม่เกิน size (ว่าง → [])
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
