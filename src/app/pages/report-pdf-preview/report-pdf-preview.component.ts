import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { InstallationReportService } from '../../services/installation-report.service';
import type {
  InstallationDcString,
  InstallationInstallerRow,
  InstallationPhotoSlot,
  InstallationReportDetail,
  InstallationSerialGroup,
} from '../../dto/installation-report.dto';
import { QUOTATION_HARDCODE } from '../pdf-bos-preview/quotation-hardcode';
import { REPORT_MAINTENANCE_HINT, REPORT_WARRANTY_TERMS } from '../report-page/report-warranty';

/** รูปที่พร้อมวางใน PDF */
interface PdfPhoto {
  url: string;
  name: string;
}

/** 1 section ของตาราง Installer Comments (แถวทุกแถวใน section เดียวกันแชร์ช่อง Section/Component แบบ rowspan) */
interface InstallerGroup {
  section: string;
  component: string;
  rows: InstallationInstallerRow[];
}

interface PhotoSection {
  slot: InstallationPhotoSlot;
  title: string;
  /** จำนวนรูปต่อแถว (จำนวนคอลัมน์ของ grid) — ใช้กำหนด column ใน template ด้วย */
  perRow: number;
  rows: PdfPhoto[][];
}

interface SerialSection {
  label: string;
  /** SN แบ่งเป็นก้อนละ SERIALS_PER_ROW × SERIAL_ROWS_PER_BLOCK ค่า (จัดเป็น grid กี่คอลัมน์ใน scss) — กลุ่มที่ยาวมากตัดหน้าระหว่างก้อนได้ */
  chunks: string[][];
}

// SLD เป็นแผนผังที่ต้องอ่านรายละเอียดได้ → แถวละ 1 รูปเต็มกว้าง; รูปถ่ายหน้างาน (roof/equipment) แถวละ 3 รูป
const PHOTO_SECTIONS: readonly { slot: InstallationPhotoSlot; title: string; perRow: number }[] = [
  { slot: 'sld', title: 'Single Line Diagram (SLD)', perRow: 1 },
  { slot: 'roof', title: 'Roof Layout (SketchUp/Photo)', perRow: 3 },
  { slot: 'equipment', title: 'Equipment Layout (Inverter / Combiner)', perRow: 3 },
];

const SERIAL_SECTIONS: readonly { group: InstallationSerialGroup; label: string }[] = [
  { group: 'inverter', label: 'Inverter(s)' },
  { group: 'battery', label: 'Batteries' },
  { group: 'panel', label: 'Solar Panels' },
  { group: 'optimizer', label: 'Optimizers / Microinverters' },
];

// ===== ค่าที่ใช้จัดหน้า (ต้องตรงกับ scss: แผ่น A4 สูง 297mm, ขอบ 12mm, ช่องไฟระหว่างแผ่นบนจอ 12mm) =====
const PX_PER_MM = 96 / 25.4;
const SHEET_HEIGHT_MM = 297;
const SHEET_GAP_MM = 12;
const SHEET_PADDING_MM = 12;
// พื้นที่เนื้อหาต่อหน้า = 297 − 12×2 = 273mm หักเผื่ออีก 2mm กัน Chrome ตัดหน้าตอนพิมพ์ก่อนจุดที่คำนวณ (เศษพิกเซล/ฟอนต์ต่างกันนิดหน่อย)
const PAGE_CONTENT_MM = 271;

// จำนวนแถวสูงสุดต่อก้อนของตารางยาว — ตารางที่ยาวกว่านี้ถูกแบ่งเป็นหลายก้อน (repeat หัวตาราง) เพื่อให้ตัดหน้าได้
// ตั้งสูงพอที่รายงานทั่วไป (DC string ไม่เกิน ~15 แถว) ไม่โดนแบ่ง จะได้ไม่เห็นหัวตารางซ้ำกลางหน้าเดียวกัน
const TABLE_ROWS_PER_BLOCK = 15;
const VALUE_ROWS_PER_BLOCK = 10;
const SERIALS_PER_ROW = 3;
const SERIAL_ROWS_PER_BLOCK = 6;

// รอรูปโหลดนานสุดเท่านี้ก่อนพิมพ์ — กัน print ค้างถ้า signed URL ช้า/เสีย (รูปที่ยังไม่มาจะว่างใน PDF)
const IMAGE_WAIT_TIMEOUT_MS = 10_000;

/**
 * หน้าพรีวิว Installation Report สำหรับปุ่ม Export to PDF ของ report-page
 *
 * เทียบ Angular: component ที่เป็น "view" ล้วนๆ เหมือน site-survey-pdf-preview
 * ดึงรายงานที่ save แล้วด้วย reportId จาก query param: refresh ได้ และ signed URL ของรูปสดใหม่ทุกครั้งที่เปิด
 * เนื้อหาเรียงเป็นก้อน .pg-block ต่อกันเส้นเดียว แล้ว paginate() วัดความสูงจัดลงแผ่น A4 ให้บนจอ = ตอนพิมพ์
 */
@Component({
  selector: 'app-report-pdf-preview',
  imports: [DatePipe, NgTemplateOutlet, RouterLink, ButtonModule],
  templateUrl: './report-pdf-preview.component.html',
  styleUrl: './report-pdf-preview.component.scss',
})
export class ReportPdfPreviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly reportService = inject(InstallationReportService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly hc = QUOTATION_HARDCODE;
  readonly warrantyTerms = REPORT_WARRANTY_TERMS;
  readonly maintenanceHint = REPORT_MAINTENANCE_HINT;

  readonly report = signal<InstallationReportDetail | null>(null);
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  /** true เมื่อจัดหน้าเสร็จแล้ว — ก่อนหน้านี้ซ่อนเอกสารไว้ (กันภาพกระพริบ) และห้ามพิมพ์ */
  readonly isPaginated = signal(false);
  /** ความสูงรวมของแผ่นทั้งหมดบนจอ (mm) — null = ยังไม่รู้จำนวนแผ่น */
  readonly docHeightMm = signal<number | null>(null);
  /** true ระหว่างรอรูป decode ก่อนเปิด print dialog — กันกดซ้ำ */
  readonly isPreparingPrint = signal(false);

  /** ปุ่ม X: กลับฟอร์ม report เดิม (เปิดรายงานเดิมด้วย reportId) ถ้าโหลดไม่สำเร็จไป dashboard */
  readonly backLink = computed<string[]>(() => (this.report() ? ['/report'] : ['/dashboard']));
  readonly backQueryParams = computed<Params | null>(() => {
    const report = this.report();
    return report ? { customerId: report.customerId, reportId: report.id } : null;
  });

  // ===== section 2 =====
  readonly arrayRows = computed(() => chunk(this.report()?.arrayDetails ?? [], TABLE_ROWS_PER_BLOCK));
  readonly powerStorageRows = computed(() => chunk(this.report()?.powerStorageItems ?? [], TABLE_ROWS_PER_BLOCK));

  /** Output: section เรียงตามลำดับที่เจอใน report (บันทึกไว้เรียงต่อกันทุก section) */
  readonly installerGroups = computed<InstallerGroup[]>(() => {
    const groups: InstallerGroup[] = [];
    for (const row of this.report()?.installerRows ?? []) {
      let group = groups.find((g) => g.section === row.section);
      if (!group) {
        group = { section: row.section, component: row.component, rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    }
    return groups;
  });

  // ===== section 3 =====
  readonly dcRows = computed<InstallationDcString[][]>(() => chunk(this.report()?.dcStrings ?? [], TABLE_ROWS_PER_BLOCK));
  readonly acRows = computed(() => chunk(this.report()?.acPhases ?? [], TABLE_ROWS_PER_BLOCK));

  readonly serialSections = computed<SerialSection[]>(() => {
    const serials = this.report()?.serials;
    return SERIAL_SECTIONS.map(({ group, label }) => ({
      label,
      chunks: chunk(serials?.[group] ?? [], SERIALS_PER_ROW * SERIAL_ROWS_PER_BLOCK).map(padToFullRow),
    }));
  });

  // ===== section 4–6: แถว checkbox + ค่า =====
  readonly permitRows = computed(() => chunk(this.report()?.permitChecklist ?? [], VALUE_ROWS_PER_BLOCK));
  readonly backupLoadRows = computed(() => chunk(this.report()?.backupLoadChecklist ?? [], VALUE_ROWS_PER_BLOCK));
  readonly loadRows = computed(() => chunk(this.report()?.loadChecklist ?? [], VALUE_ROWS_PER_BLOCK));

  // ===== section 7 =====
  /** รูปที่ไฟล์ใน storage หาย (url = '') ถูกข้ามตั้งแต่ตรงนี้ ไม่ให้เกิดกรอบรูปเสียใน PDF — จัดเป็นแถวละ perRow รูปตาม section (1 แถว = 1 ก้อนตัดหน้า) */
  readonly photoSections = computed<PhotoSection[]>(() => {
    const photosBySlot = this.report()?.photosBySlot;
    return PHOTO_SECTIONS.map(({ slot, title, perRow }) => ({
      slot,
      title,
      perRow,
      rows: chunk(
        (photosBySlot?.[slot] ?? []).filter((p) => p.url !== '').map((p) => ({ url: p.url, name: p.fileName })),
        perRow,
      ),
    }));
  });

  ngOnInit(): void {
    const reportId = this.route.snapshot.queryParamMap.get('reportId');
    if (!reportId) {
      this.isLoading.set(false);
      this.errorMessage.set('No report selected. Please open the Installation Report and click Export to PDF again');
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
          console.error('[API] Failed to load installation report for PDF:', err);
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
      const safeName = (report.customerName || 'installation-report').replace(/[^\w฀-๿.-]+/g, '_');
      const dateStr = (report.completionDate ? parseDateOnly(report.completionDate) : new Date(report.createdAt))
        .toLocaleDateString('en-GB')
        .replace(/\//g, '-'); // dd-MM-yyyy
      document.title = `Installation-Report-${safeName}-${dateStr}`;

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
   * - .pg-new  = ขึ้นหน้าใหม่เสมอ (รายงานนี้ไม่ใช้ — section ไหลต่อกันตามความยาวจริง; ยังรองรับไว้ตาม pattern ของ preview อื่น)
   * - .pg-keep = หัวข้อ: ถ้าก้อนถัดไปไม่พอที่ในหน้านี้ ให้ย้ายหัวข้อไปหน้าใหม่ด้วย ไม่ปล่อยค้างท้ายหน้า
   * - .pg-repeat = หัวข้อ/หัวตารางที่ซ่อนไว้ และโผล่เมื่อก้อนนั้นเป็นก้อนแรกของหน้า (ตารางเดิมต่อข้ามหน้า) — ความสูงที่เพิ่มถูกนับรวมในความจุหน้า
   * - ก้อนแรกของแต่ละหน้า (หน้า 2 เป็นต้นไป) ได้ class .pg-start:
   *     บนจอ → margin-top (--pg-skip) ดันลงไปอยู่ในแผ่นถัดไป / ตอนพิมพ์ → break-before: page
   *
   * รูปสูงตายตัวใน scss จึงวัดได้ทันทีไม่ต้องรอรูปโหลด; รอเฉพาะฟอนต์เพราะมีผลกับการตัดบรรทัด
   * ก้อนเดียวที่สูงเกินหน้า (เช่น Technician notes ยาวมาก) แบ่งไม่ได้ จะล้นแผ่นนั้น และพื้นหลังแผ่นถัดๆ ไปอาจเหลื่อมเล็กน้อย
   */
  private async paginate(): Promise<void> {
    try {
      await document.fonts.ready;
    } catch {
      // ไม่รอฟอนต์ได้ก็จัดหน้าต่อ — แค่อาจคลาดเคลื่อนเล็กน้อย
    }

    const doc = this.host.nativeElement.querySelector<HTMLElement>('.report-doc');
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

      // ก้อนที่มี .pg-repeat (หัวข้อ/หัวตารางซ้ำ) สูงขึ้นเมื่อได้เป็นก้อนแรกของหน้า — วัดส่วนที่เพิ่มไว้ก่อน เพื่อนับรวมในความจุหน้า
      const repeatExtraPx = blocks.map((block, i) => {
        if (!block.querySelector('.pg-repeat')) return 0;
        block.classList.add('pg-start');
        const grownHeight = block.getBoundingClientRect().height;
        block.classList.remove('pg-start');
        return Math.max(grownHeight - (rects[i].bottom - rects[i].top), 0);
      });

      // 1) หาว่าก้อนไหนเป็นก้อนแรกของแต่ละหน้า
      const capacityPx = PAGE_CONTENT_MM * PX_PER_MM;
      const pageStartIndexes: number[] = [0];
      let pageTop = rects[0].top;
      // ความสูงที่เพิ่มขึ้นของก้อนแรกในหน้าปัจจุบัน (หัวซ้ำ) — ก้อนที่ตามมาในหน้าเดียวกันถูกดันลงเท่านี้
      let pageExtra = 0;
      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        // หัวข้อต้องมีก้อนถัดไปอยู่หน้าเดียวกัน
        const needsNext = block.classList.contains('pg-keep') && i + 1 < blocks.length;
        const bottom = needsNext ? Math.max(rects[i].bottom, rects[i + 1].bottom) : rects[i].bottom;
        if (block.classList.contains('pg-new') || bottom + pageExtra - pageTop > capacityPx) {
          pageStartIndexes.push(i);
          pageTop = rects[i].top;
          pageExtra = repeatExtraPx[i];
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
        // หัวซ้ำของก้อนแรกทำให้ก้อนถัดๆ ไปในหน้านี้ถูกดันลงอีก repeatExtraPx
        shift = previousBottom + skipPx - rects[startIndex].top + repeatExtraPx[startIndex];
      });

      const sheetCount = pageStartIndexes.length;
      this.docHeightMm.set(sheetCount * SHEET_HEIGHT_MM + (sheetCount - 1) * SHEET_GAP_MM);
    } catch (err) {
      // จัดหน้าพัง → แสดงแบบไหลต่อเนื่องไปก่อน (ไม่มีจุดตัดหน้าที่แม่น) ดีกว่าหน้าว่าง
      console.error('[PDF] Failed to paginate installation report preview:', err);
    } finally {
      this.isPaginated.set(true);
    }
  }

  // รอ <img> ทุกใบใน .report-doc ถอดรหัสเสร็จ; รูปเสีย/ช้าเกิน timeout ไม่บล็อกการพิมพ์
  private async waitForImages(): Promise<void> {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.report-doc img'));
    const allDecoded = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_WAIT_TIMEOUT_MS));
    await Promise.race([allDecoded, timeout]);
  }
}

// input: รายการ + ขนาดแถว / output: รายการแบ่งเป็นแถวๆ ละไม่เกิน size (ว่าง → [])
function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// input: ค่า SN ในก้อนหนึ่ง / output: เติมสตริงว่างให้ครบแถวละ SERIALS_PER_ROW ช่อง — ไม่งั้นช่องท้ายแถวสุดท้ายไม่มีกรอบ เส้นตารางขาด
function padToFullRow(values: string[]): string[] {
  const remainder = values.length % SERIALS_PER_ROW;
  return remainder === 0 ? values : [...values, ...Array<string>(SERIALS_PER_ROW - remainder).fill('')];
}

// input: 'YYYY-MM-DD' / output: Date เที่ยงคืนตามเวลาท้องถิ่น (new Date('YYYY-MM-DD') ตีเป็น UTC แล้ววันเลื่อนได้)
function parseDateOnly(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
}
