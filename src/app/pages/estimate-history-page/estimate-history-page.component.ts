import { Component, DestroyRef, OnDestroy, OnInit, AfterViewInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ScrollSpy } from '../../scroll-spy.util';
import { ScrollToTopComponent } from '../../scroll-to-top/scroll-to-top.component';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
import { buildQuotationSnapshot, salesRepNameOf } from '../../quotation-snapshot.util';
import { EstimateService } from '../../services/estimate.service';
import { CustomerService } from '../../services/customer.service';
import { QuotationPreviewService } from '../../services/quotation-preview.service';
import { AuthService } from '../../services/auth.service';
import type { EstimateDetail, EstimatePanelItemView } from '../../dto/estimate.dto';
import type { ContactDetail } from '../../dto/customer.dto';
import type { QuotationExtras } from '../../dto/quotation.dto';

interface RackingRoofTypeTotal {
  roofTypeName: string;
  totalCost: number;
  salePrice: number;
  profit: number;
  total: number;
}

// แถวตารางสรุปของแต่ละ section (Panels / Inverters / Batteries / BOS / Installation)
interface SectionSummaryRow {
  description: string;
  totalCost: number;
  salePrice: number;
  profit: number;
  total: number;
}

interface NavItem {
  id: string;
  num: number;
  label: string;
}

const BOS_CATEGORY_LABELS: Record<string, string> = {
  cables: 'Cables',
  switch_gears: 'Switch Gears',
  solar_equipment: 'Solar Equipment',
  conduit_junction_boxes: 'Conduit & Junction Boxes',
  accessories: 'Accessories',
};

const LABOUR_CATEGORY_LABELS: Record<string, string> = {
  in_house: 'In-House Labour Costs',
  outsourced: 'Outsourced Labour Costs',
  machinery: 'Machinery',
};

@Component({
  selector: 'app-estimate-history-page',
  imports: [CommonModule, RouterLink, ButtonModule, Tooltip, ToastModule, ScrollToTopComponent, KLoadingComponent],
  templateUrl: './estimate-history-page.component.html',
  styleUrl: './estimate-history-page.component.scss',
  providers: [MessageService],
})
export class EstimateHistoryPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly estimateService = inject(EstimateService);
  private readonly customerService = inject(CustomerService);
  private readonly quotationPreview = inject(QuotationPreviewService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  detail: EstimateDetail | null = null;
  loading = true;
  notFound = false;
  exporting = false;

  // ใบนี้เป็น revision ของใบอื่น (detail.revisedFromId) — เลขที่ใบเสนอราคาเดิมไว้โชว์คู่กับ badge "REV" ใน Customer Information
  // โหลดแบบ background ไม่บล็อกหน้าหลัก (badge โผล่ทีหลังได้ ถ้าโหลดไม่ได้ก็ไม่แสดง ไม่ทำให้ทั้งหน้าใช้ไม่ได้)
  revisedFromQuotationNo: string | null = null;
  revisedFromVersionNo: number | null = null;

  // ตารางสรุปคำนวณครั้งเดียวตอนโหลด detail — ไม่ให้ template เรียก getter ซ้ำทุก change detection
  panelSummaryRows: SectionSummaryRow[] = [];
  inverterSummaryRows: SectionSummaryRow[] = [];
  batterySummaryRows: SectionSummaryRow[] = [];
  bosSummaryRows: SectionSummaryRow[] = [];
  installationSummaryRows: SectionSummaryRow[] = [];

  // ===== Section nav (เหมือน estimate-page) =====
  navItems: NavItem[] = [];
  activeSection = 'sec-3';
  mobileNavOpen = false;

  // ScrollSpy ข้าม id ที่ไม่มีใน DOM ได้ — section ที่ไม่มี item จะไม่ถูก render จึงไม่ต้องกรอง id ตรงนี้
  // ใส่ sec-1 ไว้ด้วยเพื่อให้บนสุดของหน้า (Customer Information) ไม่ไป highlight "Panels"
  private readonly scrollSpy = new ScrollSpy(
    ['sec-1', 'sec-3', 'sec-4', 'sec-5', 'sec-6', 'sec-7', 'sec-8', 'sec-9', 'sec-10', 'sec-11', 'sec-12', 'sec-13', 'sec-14'],
    (id) => (this.activeSection = id)
  );

  // ปุ่ม X: กลับไปหน้าลูกค้าเดิมเสมอ — ใช้ route param ตรงๆ กันกรณี detail ยังโหลดไม่เสร็จ/error
  get backLink(): string[] {
    const id = this.route.snapshot.paramMap.get('id');
    return id ? ['/detail', id] : ['/dashboard'];
  }

  ngOnInit(): void {
    const estimateId = this.route.snapshot.paramMap.get('estimateId');
    if (!estimateId) {
      this.notFound = true;
      this.loading = false;
      return;
    }

    this.estimateService.getOne(estimateId).subscribe({
      next: (detail) => {
        // draft ยังแก้ไขได้ — ไม่ใช่หน้าที่นี่ พากลับไปหน้า estimate แทน
        if (detail.status === 'draft') {
          this.router.navigate(['/estimate'], {
            queryParams: { customerId: detail.customerId, estimateId: detail.id },
          });
          return;
        }
        this.detail = detail;
        this.buildSummaries(detail);
        this.loading = false;

        if (detail.revisedFromId) {
          this.estimateService.getOne(detail.revisedFromId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (source) => {
                this.revisedFromQuotationNo = source.quotationNo;
                this.revisedFromVersionNo = source.versionNo;
              },
              error: (err) => console.error('[API] Failed to load original quotation for REV badge:', err),
            });
        }
      },
      error: (err) => {
        console.error('[API] Failed to load estimate:', err);
        this.notFound = true;
        this.loading = false;
      },
    });
  }

  ngAfterViewInit(): void {
    this.scrollSpy.start();
  }

  ngOnDestroy(): void {
    this.scrollSpy.stop();
  }

  scrollTo(id: string): void {
    const element = document.getElementById(id);
    if (!element) return;

    this.activeSection = id;
    // ระงับ scroll-spy ระหว่าง smooth-scroll กัน active section กระโดดผิดตัว
    this.scrollSpy.suppress(700);
    window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 40, behavior: 'smooth' });
  }

  // ===== Export to PDF =====
  // input: — (ใช้ this.detail) / output: navigate ไป /pdf-bos-preview พร้อม snapshot ใน QuotationPreviewService
  onExportPdf(): void {
    const detail = this.detail;
    if (!detail || this.exporting) return;

    this.exporting = true;
    // ชื่อผู้ติดต่อ + ที่อยู่ไม่ได้เก็บใน estimate — ดึงจาก customer ปัจจุบัน; ดึงไม่ได้ก็ export ต่อโดยเว้นว่าง ไม่ให้ทั้งใบล้มเพราะข้อมูลเสริม
    // Sales Rep = ชื่อที่กรอกไว้ตอน save; estimate เก่าที่ไม่มีค่า → fallback เป็นชื่อ account ของคนที่กด Export
    const salesRepName = detail.salesRepName?.trim() || salesRepNameOf(this.authService.currentProfile$.value);
    const customer$ = this.customerService
      .getOne(detail.customerId)
      .pipe(
        map((customer) => ({
          contactPersonName: this.contactPersonNameOf(customer.contacts),
          extras: {
            customerAddress: customer.fullAddress ?? '',
            projectLocation: customer.projectLocationName ?? detail.projectLocationName ?? '',
            salesRepName,
          } satisfies QuotationExtras,
        })),
        catchError((err) => {
          console.error('[API] Failed to load customer contact for PDF:', err);
          return of({
            contactPersonName: '',
            extras: {
              customerAddress: '',
              projectLocation: detail.projectLocationName ?? '',
              salesRepName,
            } satisfies QuotationExtras,
          });
        }),
      );

    // ใบนี้เป็น revision ของใบอื่น (Create Revision) — ต้องรู้วันที่ finalize ของใบต้นทางมาโชว์คู่กับ "REV." ในหัวเอกสาร
    // ดึงไม่ได้ก็ export ต่อโดยไม่มี REV. แทนที่จะทำให้ export ทั้งใบล้ม
    const originalIssuedDateIso$ = detail.revisedFromId
      ? this.estimateService.getOne(detail.revisedFromId).pipe(
          map((source) => source.finalizedAt),
          catchError((err) => {
            console.error('[API] Failed to load original quotation date for REV.:', err);
            return of(null as string | null);
          }),
        )
      : of(null as string | null);

    forkJoin({ customerData: customer$, originalIssuedDateIso: originalIssuedDateIso$ })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ customerData: { contactPersonName, extras }, originalIssuedDateIso }) => {
        this.exporting = false;
        try {
          const snapshot = buildQuotationSnapshot(detail, contactPersonName, extras, originalIssuedDateIso);
          if (!snapshot) {
            this.messageService.add({
              severity: 'warn',
              summary: 'Cannot Export',
              detail: 'No equipment in this estimate. Cannot create a quotation',
              life: 3000,
            });
            return;
          }
          this.quotationPreview.set(snapshot);
          this.router.navigate(['/pdf-bos-preview']);
        } catch (err) {
          console.error('[PDF] Failed to build quotation snapshot:', err);
          this.messageService.add({ severity: 'error', summary: 'Export Failed', detail: 'Could not build the quotation', life: 3000 });
        }
      });
  }

  // input: contacts ของลูกค้า / output: ชื่อ-นามสกุลของ primary contact (ตัวแรกถ้าไม่มี primary), '' ถ้าไม่มีเลย
  private contactPersonNameOf(contacts: ContactDetail[]): string {
    const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
    if (!contact) return '';
    return [contact.firstname, contact.lastname].filter((v): v is string => !!v).join(' ').trim();
  }

  bosCategoryLabel(category: string): string {
    return BOS_CATEGORY_LABELS[category] ?? category;
  }

  labourCategoryLabel(category: string): string {
    return LABOUR_CATEGORY_LABELS[category] ?? category;
  }

  labourItemsFor(category: string) {
    return this.detail?.labourItems.filter((i) => i.category === category) ?? [];
  }

  labourCategoryTotal(category: string): number {
    return this.labourItemsFor(category).reduce((sum, i) => sum + i.total, 0);
  }

  // input: items ของ panel/inverter/battery — output: เฉพาะ row หลัก (ตารางบน)
  mainItems<T extends EstimatePanelItemView>(items: T[]): T[] {
    return items.filter((i) => i.itemRole === 'main');
  }

  // input: items ของ panel/inverter/battery — output: เฉพาะ accessory (ตารางล่าง)
  accessoryItems<T extends EstimatePanelItemView>(items: T[]): T[] {
    return items.filter((i) => i.itemRole === 'accessory');
  }

  // profit ต่อหน่วย = sale − cost (ตรงกับ estimate-page ที่แสดง profit ต่อหน่วย ไม่ใช่ต่อ row)
  unitProfit(item: { costPrice: number; salePrice: number }): number {
    return item.salePrice - item.costPrice;
  }

  // panel: item.kw เก็บเป็น W → ผลรวมเป็น W; inverter/battery: เก็บเป็น kW/kWh ตามเดิม
  lineTotalKw(item: EstimatePanelItemView): number {
    return item.kw * item.quantity;
  }

  // Total kW ของ panel section = ผลรวม W หาร 1000
  panelSectionTotalKw(items: EstimatePanelItemView[]): number {
    return this.sectionTotalKw(items) / 1000;
  }

  // kW รวมเฉพาะ row หลัก เพราะ accessory ถูกบันทึกด้วย kw = 0 และไม่นับเป็นกำลังผลิต
  sectionTotalKw(items: EstimatePanelItemView[]): number {
    return this.mainItems(items).reduce((sum, i) => sum + this.lineTotalKw(i), 0);
  }

  sectionTotal(items: { total: number }[]): number {
    return items.reduce((sum, i) => sum + i.total, 0);
  }

  // ใช้กำลังรวม panel (W) เป็นฐานคำนวณ Cost / W — ตรงกับ systemWatts ใน estimate-page
  get systemWatts(): number {
    return this.detail ? this.sectionTotalKw(this.detail.panelItems) : 0;
  }

  // ยอดรวมตารางสรุป BOS = ผลรวม Total (ราคาที่บวก markup แล้ว) ของทุกหมวด
  get bosSummaryTotal(): number {
    return this.bosSummaryRows.reduce((sum, row) => sum + row.total, 0);
  }

  // สรุป racking แยกตาม roof type จาก snapshot (ไม่ผูก catalog ปัจจุบัน)
  get rackingRoofTypeTotals(): RackingRoofTypeTotal[] {
    if (!this.detail) return [];
    const byRoofType = new Map<string, RackingRoofTypeTotal>();
    for (const item of this.detail.rackingItems) {
      const row = byRoofType.get(item.roofTypeName) ?? {
        roofTypeName: item.roofTypeName,
        totalCost: 0,
        salePrice: 0,
        profit: 0,
        total: 0,
      };
      row.totalCost += item.costPrice * item.quantity;
      row.salePrice += item.salePrice * item.quantity;
      row.total += item.salePrice * item.quantity;
      row.profit = row.salePrice - row.totalCost;
      byRoofType.set(item.roofTypeName, row);
    }
    return [...byRoofType.values()];
  }

  // ===== การ์ดสรุปล่างสุด — รวม Cost/Sale/Profit ของทุก section (สูตรเดียวกับ grandTotal* ใน estimate-page) =====
  // Installation กับ Documentation ไม่มี markup (cost = sale) จึงใช้ sectionTotal(detail.xxxItems) ตรงๆ ทั้งสองฝั่ง
  get grandTotalCost(): number {
    if (!this.detail) return 0;
    const panelCost = this.panelSummaryRows[0]?.totalCost ?? 0;
    const inverterCost = this.inverterSummaryRows[0]?.totalCost ?? 0;
    const batteryCost = this.batterySummaryRows[0]?.totalCost ?? 0;
    const rackingCost = this.rackingRoofTypeTotals.reduce((sum, r) => sum + r.totalCost, 0);
    // BOS: sectionTotal(detail.bosItems) = cost×qty ล้วน (ไม่มี markup) ตรงกับ bosSectionTotal ใน estimate-page
    return panelCost + inverterCost + batteryCost + rackingCost
      + this.sectionTotal(this.detail.bosItems)
      + this.detail.labourItems.reduce((sum, i) => sum + i.costPrice * i.units, 0)
      + this.sectionTotal(this.detail.documentationItems);
  }

  get grandTotalSale(): number {
    if (!this.detail) return 0;
    return this.sectionTotal(this.detail.panelItems) + this.sectionTotal(this.detail.inverterItems)
      + this.sectionTotal(this.detail.batteryItems) + this.sectionTotal(this.detail.rackingItems)
      + this.bosSummaryTotal + this.sectionTotal(this.detail.labourItems) + this.sectionTotal(this.detail.documentationItems);
  }

  get grandTotalProfit(): number {
    return this.grandTotalSale - this.grandTotalCost;
  }

  // เลขหัวข้อคงที่ตาม estimate-page แม้บาง section จะถูกซ่อน (ไม่มี item) เพื่อให้ตรงกับหน้าที่ผู้ใช้คุ้นเคย
  private buildNavItems(detail: EstimateDetail): NavItem[] {
    const items: (NavItem & { visible: boolean })[] = [
      { id: 'sec-3', num: 1, label: 'Panels', visible: detail.panelItems.length > 0 },
      { id: 'sec-4', num: 2, label: 'Inverters', visible: detail.inverterItems.length > 0 },
      { id: 'sec-5', num: 3, label: 'Batteries', visible: detail.batteryItems.length > 0 },
      { id: 'sec-6', num: 4, label: 'Solar Racking', visible: detail.rackingItems.length > 0 },
      { id: 'sec-7', num: 5, label: 'Solar BOS', visible: detail.bosItems.length > 0 },
      { id: 'sec-8', num: 6, label: 'Installation', visible: detail.labourItems.length > 0 },
      { id: 'sec-9', num: 7, label: 'Documentation', visible: detail.documentationItems.length > 0 },
      { id: 'sec-10', num: 8, label: 'Summary', visible: true },
      { id: 'sec-11', num: 9, label: 'Energy Output', visible: true },
      { id: 'sec-12', num: 10, label: 'Cash Flow', visible: true },
      { id: 'sec-13', num: 11, label: 'Energy Demand', visible: true },
      { id: 'sec-14', num: 12, label: 'Cost Summary', visible: true },
    ];
    return items.filter((item) => item.visible);
  }

  private buildSummaries(detail: EstimateDetail): void {
    this.navItems = this.buildNavItems(detail);
    const panel = this.mainItems(detail.panelItems)[0];
    const inverter = this.mainItems(detail.inverterItems)[0];
    const battery = this.mainItems(detail.batteryItems)[0];

    // description รูปแบบเดียวกับ estimate-page (panel.kw เก็บเป็น W จึงต่อท้ายด้วย W)
    this.panelSummaryRows = this.buildEquipmentSummaryRows(
      panel ? `${panel.brand} ${panel.kw} W | ${panel.description}` : '—',
      detail.panelItems
    );
    this.inverterSummaryRows = this.buildEquipmentSummaryRows(
      inverter ? `${inverter.brand} ${inverter.kw} kW | ${inverter.description}` : '—',
      detail.inverterItems
    );
    this.batterySummaryRows = this.buildEquipmentSummaryRows(
      battery ? `${battery.brand} | ${battery.description}` : '—',
      detail.batteryItems
    );

    // BOS: 1 แถวต่อหมวด — Sale = ยอดขายที่ freeze ไว้ตอน save (sale_price × qty = item.total), Cost = cost_price × qty
    this.bosSummaryRows = Object.keys(BOS_CATEGORY_LABELS)
      .map((category) => detail.bosItems.filter((item) => item.category === category && item.quantity > 0))
      .filter((items) => items.length > 0)
      .map((items) => {
        const salePrice = this.sectionTotal(items);
        const totalCost = items.reduce((sum, item) => sum + item.costPrice * item.quantity, 0);
        return {
          description: BOS_CATEGORY_LABELS[items[0].category],
          totalCost,
          salePrice,
          profit: salePrice - totalCost,
          total: salePrice,
        };
      });

    // Installation: cost = Σ costPrice × units, sale = total ของแถว (salePrice × units) และข้ามหมวดที่ cost/sale เป็น 0 ทั้งคู่
    this.installationSummaryRows = Object.keys(LABOUR_CATEGORY_LABELS)
      .map((category) => {
        const totalCost = this.labourItemsFor(category).reduce((sum, i) => sum + i.costPrice * i.units, 0);
        const salePrice = this.labourCategoryTotal(category);
        return { description: LABOUR_CATEGORY_LABELS[category], totalCost, salePrice, profit: salePrice - totalCost, total: salePrice };
      })
      .filter((row) => row.totalCost > 0 || row.salePrice > 0);
  }

  // สรุป section เครื่องจักรเป็นแถวเดียว: cost = ผลรวม cost×qty ของ main + accessories, sale = ผลรวม total ของทุก row
  // output: [] ถ้า section ไม่มี item
  private buildEquipmentSummaryRows(description: string, items: EstimatePanelItemView[]): SectionSummaryRow[] {
    if (items.length === 0) return [];
    const totalCost = items.reduce((sum, item) => sum + item.costPrice * item.quantity, 0);
    const total = this.sectionTotal(items);
    return [{ description, totalCost, salePrice: total, profit: total - totalCost, total }];
  }
}
