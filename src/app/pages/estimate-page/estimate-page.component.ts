import { Component, OnInit, AfterViewInit, OnDestroy, DestroyRef, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ActivatedRoute, Router } from "@angular/router";
import { ButtonModule } from 'primeng/button';
import { ScrollSpy } from '../../scroll-spy.util';
import { DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Tooltip } from 'primeng/tooltip';
import { AccordionModule } from 'primeng/accordion';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import { forkJoin, of, Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { SolarBOSDialogComponent } from './solar-bos-dialog/solar-bos-dialog.component';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
import { EquipmentService, PanelItem, InverterItem, BatteryItem, AccessoryItem, RoofTypeItem, SolarRackingItem, BOSItem, DocumentationTypeItem } from '../../services/equipment.service';
import { CustomerService } from '../../services/customer.service';
import { EstimateService } from '../../services/estimate.service';
import { QuotationPreviewService } from '../../services/quotation-preview.service';
import { AuthService } from '../../services/auth.service';
import { salesRepNameOf, splitRemarkLines } from '../../quotation-snapshot.util';
import { QUOTATION_HARDCODE } from '../pdf-bos-preview/quotation-hardcode';
import type { QuotationLineRow, QuotationSnapshot } from '../../dto/quotation.dto';
import type { CustomerDetail, ContactDetail } from '../../dto/customer.dto';
import type {
  EstimateDetail,
  EstimateDocumentationItemView,
  EstimateItemsPayload,
  EstimateLabourItemView,
  SaveEstimatePayload,
  SaveEstimateResult,
} from '../../dto/estimate.dto';

interface SelectOption {
  label: string;
  value: string;
}

// แถวตารางสรุปของ section 1-3 (Panels / Inverters / Batteries)
interface SectionSummaryRow {
  description: string;
  totalCost: number;
  salePrice: number;
  profit: number;
  total: number;
}

interface LabourCostRow {
  description: string;
  unitRate: number | null;
  units: number | null;
}

interface DocumentationRow {
  typeId: number | null;
  quantity: number | null;
}

interface EnergyPattern {
  value: string;
  icon: string;
  label: string;
  desc: string;
}

type BosCategory = 'cables' | 'switch_gears' | 'solar_equipment' | 'conduit_junction_boxes' | 'accessories';
type LabourCategory = 'in_house' | 'outsourced' | 'machinery';

interface CatalogBundle {
  panels: PanelItem[];
  inverters: InverterItem[];
  batteries: BatteryItem[];
  panelAccessories: AccessoryItem[];
  inverterAccessories: AccessoryItem[];
  batteryAccessories: AccessoryItem[];
  roofTypes: RoofTypeItem[];
  rackingItems: SolarRackingItem[];
  cables: BOSItem[];
  switchGears: BOSItem[];
  solarEquipment: BOSItem[];
  conduitJunctionBoxes: BOSItem[];
  bosAccessories: BOSItem[];
  documentationTypes: DocumentationTypeItem[];
}

@Component({
  selector: 'app-estimate-page',
  imports: [FormsModule, SelectModule, SelectButtonModule, ButtonModule, NgClass, NgFor, NgIf, DecimalPipe, Tooltip, AccordionModule, ToastModule, ConfirmDialogModule, SolarBOSDialogComponent, KLoadingComponent],
  templateUrl: './estimate-page.component.html',
  styleUrl: './estimate-page.component.scss',
  providers: [MessageService, ConfirmationService]
})
export class EstimatePageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly equipmentService = inject(EquipmentService);
  private readonly estimateService = inject(EstimateService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customerService = inject(CustomerService);
  private readonly quotationPreview = inject(QuotationPreviewService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // customer id ที่มาจากหน้า Customer Detail (ผ่าน query param) — ใช้พาผู้ใช้กลับไปหน้าลูกค้าคนเดิมตอนกด X / Save Draft
  customerId: string | null = null;
  customer: CustomerDetail | null = null;

  // estimate id — มีตอนเปิด draft เดิมกลับมาแก้ (?estimateId=) หรือหลังจากเจอ draft ค้างของลูกค้าตอนเปิดหน้าเปล่าๆ
  estimateId: string | null = null;
  saving = signal(false);
  // กำลัง save แบบ finalize (ปุ่ม Save) หรือ draft — ใช้ให้ spinner ขึ้นที่ปุ่มที่ผู้ใช้กดจริง
  finalizing = signal(false);
  // true จนกว่า catalog ทั้ง 14 เส้น (และ draft ที่ต้อง prefill ถ้ามี) จะโหลดเสร็จ
  pageLoading = signal(true);

  // หมายเหตุสำหรับ PDF (1 บรรทัด = 1 ข้อ) — save ลง estimates.pdf_remarks
  pdfRemarks = '';

  // ชื่อ Sales Rep บน PDF — เติมชื่อ account ให้ก่อน (แก้ได้) เพราะบางคนใช้ account ร่วมกัน; save ลง estimates.sales_rep_name
  salesRepName = '';
  // ผู้ใช้เคยพิมพ์/ลบเองแล้ว → ห้ามให้ profile ที่โหลดมาทีหลังเขียนทับ
  private salesRepEdited = false;

  onSalesRepInput(): void {
    this.salesRepEdited = true;
  }

  // ปุ่ม X / Save Draft: กลับไปหน้าลูกค้าเดิมถ้ามี customerId, ถ้าไม่มี (เข้ามาตรงๆ ไม่ผ่าน customer detail) ให้กลับ dashboard แทน
  get backLink(): string[] {
    return this.customerId ? ['/detail', this.customerId] : ['/dashboard'];
  }

  // state ของฟอร์มตอนโหลด/prefill เสร็จ — ใช้เทียบตอนกด X ว่ามีข้อมูลที่ยังไม่ได้ save หรือไม่ (null = ยังโหลดไม่เสร็จ)
  private loadedStateKey: string | null = null;

  // ฟอร์มพร้อมใช้ (catalog + prefill เสร็จ) — เปิดหน้าจอและถ่าย baseline ไว้เทียบ
  private finishLoading(): void {
    this.pageLoading.set(false);
    this.loadedStateKey = this.currentStateKey();
  }

  // output: string ที่แทน state ที่ผู้ใช้กรอกทั้งหมด — เทียบก่อน/หลังเพื่อรู้ว่ามีการแก้ไขหรือไม่
  // ทำไมใช้ state ดิบแทน buildPayload: payload ตัดแถวที่ไม่ครบทิ้ง (เช่น เลือก brand แต่ยังไม่กรอก qty, Labour ไม่มี description)
  // และมี field ที่โหลด async (ชื่อลูกค้า) ทำให้เทียบแล้วเพี้ยน — salesRepName ก็ไม่รวม เพราะ auto-fill จาก profile ทีหลัง
  private currentStateKey(): string {
    return JSON.stringify({
      panel: [this.selectedPanelBrand, this.selectedPanelId, this.panelQuantity, this.panelAccessoryQty],
      inverter: [this.selectedInverterBrand, this.selectedInverterPhase, this.selectedInverterId, this.inverterQuantity, this.inverterAccessoryQty],
      battery: [this.selectedBatteryBrand, this.selectedBatteryId, this.batteryQuantity, this.batteryAccessoryQty],
      racking: [this.selectedRoofTypeId, this.rackingQtyMap],
      bos: [this.cableQty, this.switchGearQty, this.solarEquipmentQty, this.conduitJunctionBoxQty, this.bosAccessoryQty],
      labour: [this.inHouseLabourRows, this.outsourcedLabourRows, this.machineryRows],
      documentation: this.documentationRows,
      pdfRemarks: this.pdfRemarks,
    });
  }

  // ปุ่ม X: ไม่มีอะไรเปลี่ยน (หรือหน้ายังโหลดไม่เสร็จ) → ออกเลย, มีการแก้ไข → ถามก่อน
  onClose(): void {
    const hasUnsavedChanges = this.loadedStateKey !== null && this.currentStateKey() !== this.loadedStateKey;
    if (!hasUnsavedChanges) {
      this.router.navigate(this.backLink);
      return;
    }
    this.confirmationService.confirm({
      header: 'Unsaved Changes',
      message: 'You have unsaved changes that will be lost. Leave without saving?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Leave',
      rejectLabel: 'Stay',
      accept: () => this.router.navigate(this.backLink),
    });
  }

  get primaryContact(): ContactDetail | null {
    if (!this.customer || this.customer.contacts.length === 0) return null;
    return this.customer.contacts.find((c) => c.isPrimary) ?? this.customer.contacts[0];
  }

  // คืน "firstname lastname" ของ primary contact, ถ้าไม่มีชื่อหรือไม่มี contact คืน ''
  get contactPersonName(): string {
    const contact = this.primaryContact;
    if (!contact) return '';
    return [contact.firstname, contact.lastname].filter((v): v is string => !!v).join(' ').trim();
  }

  // คืน "ชื่อ | tel | email" (ตัดส่วนที่ว่างออก) — ใช้ทั้งแสดงหน้าจอและ save ลง contact_reference
  get contactReference(): string {
    const contact = this.primaryContact;
    if (!contact) return '—';
    const parts = [this.contactPersonName, contact.tel, contact.email].filter((v): v is string => !!v);
    return parts.length > 0 ? parts.join(' | ') : '—';
  }

  // แจ้งเตือนเมื่อผู้ใช้คลิก Qty ที่ยัง readonly อยู่ (เลือกสินค้าไม่ครบ) — บอกเจาะจงว่าต้องเลือกอะไรก่อน
  private warnIncompleteSelection(detail: string): void {
    this.messageService.add({ severity: 'warn', summary: 'Incomplete Selection', detail, life: 3000 });
  }

  onPanelQtyClick(): void {
    if (this.selectedPanel) return;
    if (!this.selectedPanelBrand) this.warnIncompleteSelection('Please select Brand first');
    else this.warnIncompleteSelection('Please select Description first');
  }

  onInverterQtyClick(): void {
    if (this.selectedInverter) return;
    if (!this.selectedInverterBrand) this.warnIncompleteSelection('Please select Brand first');
    else if (!this.selectedInverterPhase) this.warnIncompleteSelection('Please select Phase first');
    else this.warnIncompleteSelection('Please select Model first');
  }

  onBatteryQtyClick(): void {
    if (this.selectedBattery) return;
    if (!this.selectedBatteryBrand) this.warnIncompleteSelection('Please select Brand first');
    else this.warnIncompleteSelection('Please select Description first');
  }

  ngOnInit(): void {
    this.customerId = this.route.snapshot.queryParamMap.get('customerId');
    this.estimateId = this.route.snapshot.queryParamMap.get('estimateId');

    if (this.customerId) {
      this.customerService.getOne(this.customerId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (data) => (this.customer = data),
          error: (err) => console.error('[API] Failed to load customer:', err),
        });
    }

    // profile โหลดแบบ async — เติมเป็นค่าเริ่มต้นเฉพาะตอนผู้ใช้ยังไม่แตะช่อง Sales Rep
    this.authService.currentProfile$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((profile) => {
        if (!this.salesRepEdited && !this.salesRepName) this.salesRepName = salesRepNameOf(profile);
      });

    this.loadCatalogs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((catalogs) => {
        this.applyCatalogs(catalogs);
        this.loadEstimateForPrefill();
      });
  }

  // output: Observable ของ catalog ทั้ง 14 เส้น — endpoint ไหนพังไม่ทำให้ทั้งหน้าว่าง (catchError คืน [] + toast เตือน)
  private loadCatalogs(): Observable<CatalogBundle> {
    return forkJoin({
      panels: this.equipmentService.getPanels().pipe(catchError(() => this.catalogLoadFailed<PanelItem>('Panels'))),
      inverters: this.equipmentService.getInverters().pipe(catchError(() => this.catalogLoadFailed<InverterItem>('Inverters'))),
      batteries: this.equipmentService.getBatteries().pipe(catchError(() => this.catalogLoadFailed<BatteryItem>('Batteries'))),
      panelAccessories: this.equipmentService.getPanelAccessories().pipe(catchError(() => this.catalogLoadFailed<AccessoryItem>('Panel Accessories'))),
      inverterAccessories: this.equipmentService.getInverterAccessories().pipe(catchError(() => this.catalogLoadFailed<AccessoryItem>('Inverter Accessories'))),
      batteryAccessories: this.equipmentService.getBatteryAccessories().pipe(catchError(() => this.catalogLoadFailed<AccessoryItem>('Battery Accessories'))),
      roofTypes: this.equipmentService.getRoofTypes().pipe(catchError(() => this.catalogLoadFailed<RoofTypeItem>('Roof Types'))),
      rackingItems: this.equipmentService.getSolarRacking().pipe(catchError(() => this.catalogLoadFailed<SolarRackingItem>('Solar Racking'))),
      cables: this.equipmentService.getCables().pipe(catchError(() => this.catalogLoadFailed<BOSItem>('Cables'))),
      switchGears: this.equipmentService.getSwitchGears().pipe(catchError(() => this.catalogLoadFailed<BOSItem>('Switch Gears'))),
      solarEquipment: this.equipmentService.getSolarEquipment().pipe(catchError(() => this.catalogLoadFailed<BOSItem>('Solar Equipment'))),
      conduitJunctionBoxes: this.equipmentService.getConduitJunctionBoxes().pipe(catchError(() => this.catalogLoadFailed<BOSItem>('Conduit & Junction Boxes'))),
      bosAccessories: this.equipmentService.getBosAccessories().pipe(catchError(() => this.catalogLoadFailed<BOSItem>('BOS Accessories'))),
      documentationTypes: this.equipmentService.getDocumentationTypes().pipe(catchError(() => this.catalogLoadFailed<DocumentationTypeItem>('Documentation Types'))),
    });
  }

  private catalogLoadFailed<T>(label: string): Observable<T[]> {
    console.error(`[API] Failed to load catalog: ${label}`);
    this.messageService.add({ severity: 'warn', summary: 'Incomplete data', detail: `Failed to load ${label}`, life: 4000 });
    return of([]);
  }

  private applyCatalogs(catalogs: CatalogBundle): void {
    this.panels = catalogs.panels;
    this.inverters = catalogs.inverters;
    this.batteries = catalogs.batteries;

    this.panelAccessories = catalogs.panelAccessories;
    this.panelAccessoryQty = new Array(catalogs.panelAccessories.length).fill(null);
    this.inverterAccessories = catalogs.inverterAccessories;
    this.inverterAccessoryQty = new Array(catalogs.inverterAccessories.length).fill(null);
    this.batteryAccessories = catalogs.batteryAccessories;
    this.batteryAccessoryQty = new Array(catalogs.batteryAccessories.length).fill(null);

    this.roofTypes = catalogs.roofTypes;
    this.rackingItems = catalogs.rackingItems;

    this.cables = catalogs.cables;
    this.cableQty = new Array(catalogs.cables.length).fill(null);
    this.switchGears = catalogs.switchGears;
    this.switchGearQty = new Array(catalogs.switchGears.length).fill(null);
    this.solarEquipment = catalogs.solarEquipment;
    this.solarEquipmentQty = new Array(catalogs.solarEquipment.length).fill(null);
    this.conduitJunctionBoxes = catalogs.conduitJunctionBoxes;
    this.conduitJunctionBoxQty = new Array(catalogs.conduitJunctionBoxes.length).fill(null);
    this.bosAccessories = catalogs.bosAccessories;
    this.bosAccessoryQty = new Array(catalogs.bosAccessories.length).fill(null);

    this.documentationTypes = catalogs.documentationTypes;
    this.documentationTypeOptions = catalogs.documentationTypes.map((t) => ({ label: t.name, value: t.id }));
  }

  // โหลด prefill เฉพาะตอนมี estimateId ชัดเจน (มาจาก History) — ไม่ auto เดา draft ล่าสุดของลูกค้า
  private loadEstimateForPrefill(): void {
    if (!this.estimateId) {
      this.finishLoading();
      return;
    }

    this.estimateService.getOne(this.estimateId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          if (detail.status === 'final') {
            // final แก้ไม่ได้แล้ว — พาไปหน้า history แทนที่จะเปิดฟอร์มแก้ (คง loading ไว้ระหว่าง navigate ไม่ให้ฟอร์มแวบขึ้นมา)
            this.router.navigate(['/detail', detail.customerId, 'estimate', detail.id]);
            return;
          }
          this.prefill(detail);
          this.finishLoading();
        },
        error: (err) => {
          console.error('[API] Failed to load estimate:', err);
          this.finishLoading();
          this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'Failed to load the saved estimate. Please reopen the page', life: 4000 });
        },
      });
  }

  // เซ็ตค่ากลับเข้า state จาก source_id (ไม่ใช่ค่า freeze) — ราคาที่แสดงจึงเป็นราคาปัจจุบันจาก catalog เสมอ
  private prefill(detail: EstimateDetail): void {
    let skipped = 0;
    this.pdfRemarks = detail.pdfRemarks ?? '';
    if (detail.salesRepName) {
      this.salesRepName = detail.salesRepName;
      this.salesRepEdited = true;
    }

    for (const item of detail.panelItems) {
      if (item.itemRole === 'main') {
        const match = this.panels.find((p) => p.id === item.sourceId);
        if (!match) { skipped++; continue; }
        this.selectedPanelBrand = match.brand;
        this.selectedPanelId = String(match.id);
        this.panelQuantity = item.quantity;
      } else {
        const index = this.panelAccessories.findIndex((a) => a.id === item.sourceId);
        if (index === -1) { skipped++; continue; }
        this.panelAccessoryQty[index] = item.quantity;
      }
    }

    for (const item of detail.inverterItems) {
      if (item.itemRole === 'main') {
        const match = this.inverters.find((i) => i.id === item.sourceId);
        if (!match) { skipped++; continue; }
        this.selectedInverterBrand = match.brand;
        this.selectedInverterPhase = match.phase;
        this.selectedInverterId = String(match.id);
        this.inverterQuantity = item.quantity;
      } else {
        const index = this.inverterAccessories.findIndex((a) => a.id === item.sourceId);
        if (index === -1) { skipped++; continue; }
        this.inverterAccessoryQty[index] = item.quantity;
      }
    }

    for (const item of detail.batteryItems) {
      if (item.itemRole === 'main') {
        const match = this.batteries.find((b) => b.id === item.sourceId);
        if (!match) { skipped++; continue; }
        this.selectedBatteryBrand = match.brand;
        this.selectedBatteryId = String(match.id);
        this.batteryQuantity = item.quantity;
      } else {
        const index = this.batteryAccessories.findIndex((a) => a.id === item.sourceId);
        if (index === -1) { skipped++; continue; }
        this.batteryAccessoryQty[index] = item.quantity;
      }
    }

    for (const item of detail.rackingItems) {
      const match = this.rackingItems.find((r) => r.id === item.sourceId);
      if (!match) { skipped++; continue; }
      this.rackingQtyMap[match.id] = item.quantity;
      if (!this.selectedRoofTypeId) this.selectedRoofTypeId = String(match.roofTypeId);
    }

    for (const item of detail.bosItems) {
      const arrays = this.bosArraysFor(item.category as BosCategory);
      if (!arrays) { skipped++; continue; }
      const index = arrays.items.findIndex((i) => i.id === item.sourceId);
      if (index === -1) { skipped++; continue; }
      arrays.qty[index] = item.quantity;
    }

    this.inHouseLabourRows = this.labourRowsFor(detail.labourItems, 'in_house');
    this.outsourcedLabourRows = this.labourRowsFor(detail.labourItems, 'outsourced');
    this.machineryRows = this.labourRowsFor(detail.labourItems, 'machinery');

    const documentationResult = this.documentationRowsFor(detail.documentationItems);
    this.documentationRows = documentationResult.rows;
    skipped += documentationResult.skipped;

    if (skipped > 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Some items skipped',
        detail: `${skipped} item(s) no longer exist in the system and were skipped`,
        life: 5000,
      });
    }
  }

  private labourRowsFor(items: EstimateLabourItemView[], category: LabourCategory): LabourCostRow[] {
    const rows = items
      .filter((i) => i.category === category)
      .map((i) => ({ description: i.description, unitRate: i.unitRate, units: i.units }));
    return rows.length > 0 ? rows : [this.newLabourRow()];
  }

  // input: documentation items ที่ save ไว้ — output: แถวสำหรับตาราง section 7 + จำนวนแถวที่ type ถูกลบจาก catalog ไปแล้ว (ข้าม เหมือน section อื่น)
  // rate ที่แสดงมาจาก catalog ปัจจุบันเสมอ (ไม่ใช่ค่า snapshot) — snapshot ใช้แสดงในหน้า history ของใบที่ finalize แล้วเท่านั้น
  private documentationRowsFor(items: EstimateDocumentationItemView[]): { rows: DocumentationRow[]; skipped: number } {
    const rows: DocumentationRow[] = [];
    let skipped = 0;
    for (const item of items) {
      const match = this.documentationTypes.find((t) => t.id === item.sourceId);
      if (!match) { skipped++; continue; }
      rows.push({ typeId: match.id, quantity: item.quantity });
    }
    return { rows: rows.length > 0 ? rows : [this.newDocumentationRow()], skipped };
  }

  // BOS มี 5 หมวด ผูกกับ catalog array + qty array คนละคู่ — ใช้ทั้ง prefill และตอน build payload
  private bosArraysFor(category: BosCategory): { items: BOSItem[]; qty: (number | null)[] } | null {
    switch (category) {
      case 'cables': return { items: this.cables, qty: this.cableQty };
      case 'switch_gears': return { items: this.switchGears, qty: this.switchGearQty };
      case 'solar_equipment': return { items: this.solarEquipment, qty: this.solarEquipmentQty };
      case 'conduit_junction_boxes': return { items: this.conduitJunctionBoxes, qty: this.conduitJunctionBoxQty };
      case 'accessories': return { items: this.bosAccessories, qty: this.bosAccessoryQty };
      default: return null;
    }
  }

  private readonly bosCategoryMeta: Array<{ category: BosCategory; sourceTable: string }> = [
    { category: 'cables', sourceTable: 'cables' },
    { category: 'switch_gears', sourceTable: 'switch_gears' },
    { category: 'solar_equipment', sourceTable: 'solar_equipment' },
    { category: 'conduit_junction_boxes', sourceTable: 'conduit_junction_boxes' },
    { category: 'accessories', sourceTable: 'bos_accessories' },
  ];

  // input: state ปัจจุบันของทุก section — output: payload สำหรับ POST /estimates (กรอง qty null/0 และแถว labour ว่างทิ้ง)
  private buildItemsPayload(): EstimateItemsPayload {
    const panel: EstimateItemsPayload['panel'] = [];
    if (this.selectedPanel && (this.panelQuantity ?? 0) > 0) {
      panel.push({
        item_role: 'main', source_table: 'panels', source_id: this.selectedPanel.id,
        brand: this.selectedPanel.brand, description: this.selectedPanel.description,
        kw: this.selectedPanel.kw, cost_price: this.selectedPanel.costPrice, sale_price: this.selectedPanel.salePrice,
        quantity: this.panelQuantity!, sort_order: 0,
      });
    }
    this.panelAccessories.forEach((acc, i) => {
      const qty = this.panelAccessoryQty[i];
      if (!qty) return;
      panel.push({
        item_role: 'accessory', source_table: 'panel_accessories', source_id: acc.id,
        brand: acc.brand, description: acc.description, kw: 0,
        cost_price: acc.costPrice, sale_price: acc.salePrice, quantity: qty, sort_order: i + 1,
      });
    });

    const inverter: EstimateItemsPayload['inverter'] = [];
    if (this.selectedInverter && (this.inverterQuantity ?? 0) > 0) {
      inverter.push({
        item_role: 'main', source_table: 'inverters', source_id: this.selectedInverter.id,
        brand: this.selectedInverter.brand, phase: this.selectedInverter.phase, description: this.selectedInverter.description,
        kw: this.selectedInverter.kw, cost_price: this.selectedInverter.costPrice, sale_price: this.selectedInverter.salePrice,
        quantity: this.inverterQuantity!, sort_order: 0,
      });
    }
    this.inverterAccessories.forEach((acc, i) => {
      const qty = this.inverterAccessoryQty[i];
      if (!qty) return;
      inverter.push({
        item_role: 'accessory', source_table: 'inverter_accessories', source_id: acc.id, phase: '',
        brand: acc.brand, description: acc.description, kw: 0,
        cost_price: acc.costPrice, sale_price: acc.salePrice, quantity: qty, sort_order: i + 1,
      });
    });

    const battery: EstimateItemsPayload['battery'] = [];
    if (this.selectedBattery && (this.batteryQuantity ?? 0) > 0) {
      battery.push({
        item_role: 'main', source_table: 'batteries', source_id: this.selectedBattery.id,
        brand: this.selectedBattery.brand, description: this.selectedBattery.description,
        kw: this.selectedBattery.kw, cost_price: this.selectedBattery.costPrice, sale_price: this.selectedBattery.salePrice,
        quantity: this.batteryQuantity!, sort_order: 0,
      });
    }
    this.batteryAccessories.forEach((acc, i) => {
      const qty = this.batteryAccessoryQty[i];
      if (!qty) return;
      battery.push({
        item_role: 'accessory', source_table: 'battery_accessories', source_id: acc.id,
        brand: acc.brand, description: acc.description, kw: 0,
        cost_price: acc.costPrice, sale_price: acc.salePrice, quantity: qty, sort_order: i + 1,
      });
    });

    const racking: EstimateItemsPayload['racking'] = [];
    this.rackingItems.forEach((item, i) => {
      const qty = this.rackingQtyMap[item.id];
      if (!qty) return;
      const roofType = this.roofTypes.find((r) => r.id === item.roofTypeId);
      racking.push({
        source_table: 'solar_racking', source_id: item.id,
        roof_type_id: item.roofTypeId, roof_type_name: roofType?.name ?? '',
        part: item.part, description: item.description,
        cost_price: item.costPrice, sale_price: item.salePrice, quantity: qty, sort_order: i,
      });
    });

    const bos: EstimateItemsPayload['bos'] = [];
    for (const meta of this.bosCategoryMeta) {
      const arrays = this.bosArraysFor(meta.category);
      if (!arrays) continue;
      arrays.items.forEach((item, i) => {
        const qty = arrays.qty[i];
        if (!qty) return;
        bos.push({
          category: meta.category, source_table: meta.sourceTable, source_id: item.id,
          item: String(item.item), description: item.description, size: item.size,
          cost_price: item.costPrice, sale_price: this.bosSalePriceOf(item.costPrice), quantity: qty, sort_order: i,
        });
      });
    }

    const labour: EstimateItemsPayload['labour'] = [];
    const pushLabourRows = (rows: LabourCostRow[], category: LabourCategory) => {
      rows.forEach((row, i) => {
        const description = row.description?.trim();
        if (!description) return;
        labour.push({ category, description, unit_rate: row.unitRate ?? 0, units: row.units ?? 0, sort_order: i });
      });
    };
    pushLabourRows(this.inHouseLabourRows, 'in_house');
    pushLabourRows(this.outsourcedLabourRows, 'outsourced');
    pushLabourRows(this.machineryRows, 'machinery');

    // แถวที่ยังไม่เลือก type หรือ qty ว่าง/0 ไม่ save (เหมือน section อื่น) — freeze ชื่อ+rate ณ ตอน save
    const documentation: EstimateItemsPayload['documentation'] = [];
    this.documentationRows.forEach((row, i) => {
      const type = this.documentationTypeOf(row);
      if (!type || !row.quantity || row.quantity <= 0) return;
      documentation.push({
        source_table: 'documentation_types', source_id: type.id,
        documentation_type_name: type.name, unit_rate: type.unitRate, quantity: row.quantity, sort_order: i,
      });
    });

    return { panel, inverter, battery, racking, bos, labour, documentation };
  }

  private buildPayload(finalize: boolean): SaveEstimatePayload {
    return {
      customer_id: this.customerId!,
      finalize,
      head: {
        customer_display_name: this.customer?.displayName ?? null,
        contact_reference: this.primaryContact ? this.contactReference : null,
        project_location_name: this.customer?.projectLocationName ?? null,
        project_google_maps_link: this.customer?.googleMapsLink ?? null,
        type_of_system_name: this.customer?.typeOfSystemName ?? null,
        // ว่าง/มีแต่ช่องว่าง → null (ไม่เก็บค่าขยะลง DB)
        pdf_remarks: this.pdfRemarks.trim() || null,
        sales_rep_name: this.salesRepName.trim() || null,
      },
      items: this.buildItemsPayload(),
    };
  }

  // input: finalize flag + callback ตอนสำเร็จ — output: void, จัดการ validate/error/navigate ให้ทั้ง Save Draft และ Save
  private trySave(finalize: boolean, onSuccess: (result: SaveEstimateResult) => void): void {
    if (!this.customerId) {
      this.warnIncompleteSelection('Open this page from a customer page before saving');
      return;
    }
    if (this.saving()) return;
    if (!this.ensureLabourRowsHaveDescription()) return;

    const payload = this.buildPayload(finalize);
    const hasAnyItem = payload.items.panel.length || payload.items.inverter.length || payload.items.battery.length
      || payload.items.racking.length || payload.items.bos.length || payload.items.labour.length
      || payload.items.documentation.length;
    if (!hasAnyItem) {
      this.warnIncompleteSelection('No equipment selected and no items filled in');
      return;
    }

    this.saving.set(true);
    this.finalizing.set(finalize);
    this.estimateService.save(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.finalizing.set(false);
          onSuccess(result);
          this.router.navigate(this.backLink);
        },
        error: (err) => {
          this.saving.set(false);
          this.finalizing.set(false);
          console.error('[API] Failed to save estimate:', err);
          const detail = err?.status === 409
            ? 'This estimate was already finalized elsewhere. Please reopen the page'
            : 'Please try again';
          this.messageService.add({ severity: 'error', summary: 'Save Failed', detail, life: 4000 });
        },
      });
  }

  onSaveDraft(): void {
    this.trySave(false, () =>
      this.messageService.add({ severity: 'success', summary: 'Draft Saved', life: 2000 }));
  }

  onSave(): void {
    if (!this.customerId) {
      this.warnIncompleteSelection('Open this page from a customer page before saving');
      return;
    }
    this.confirmationService.confirm({
      header: 'Finalize Estimate',
      message: 'Once finalized, this estimate can no longer be edited. Continue?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Finalize',
      rejectLabel: 'Cancel',
      accept: () => this.trySave(true, () =>
        this.messageService.add({ severity: 'success', summary: 'Estimate Finalized', life: 2000 })),
    });
  }

  // ===== Export to PDF — รวมยอดทุก section เป็น snapshot แล้วส่งต่อหน้า preview =====
  // preview เป็น renderer อย่างเดียว: aggregation ทั้งหมดเกิดที่นี่ (ราคาที่โชว์ลูกค้า = ราคาขาย; BOS ไม่มี sale price ใน catalog จึงใช้ cost + bosMarkupRate)
  onExportPdf(): void {
    if (!this.ensureLabourRowsHaveDescription()) return;

    const HC = QUOTATION_HARDCODE;

    // แผงกำลัง 10.32 kW → หัวเรื่องใช้จำนวนเต็ม "10kW" (ปัดเศษ)
    const titleKw = (kw: number): string => String(Math.round(kw));

    const hasInverter = !!this.selectedInverter && (this.inverterQuantity ?? 0) > 0;
    const hasBattery = !!this.selectedBattery && (this.batteryQuantity ?? 0) > 0;
    const hasPanel = !!this.selectedPanel && (this.panelQuantity ?? 0) > 0;

    // ---- ชื่อระบบอัตโนมัติ: "<brand> <kW>kW Solar Hybrid Inverter with <kWh>kWh Storage + <kW>kW of Solar PV" ----
    let systemTitle = hasInverter
      ? `${this.selectedInverter!.brand} ${titleKw(this.inverterTotalKw)}kW ${HC.systemTitle.inverterSuffix}`
      : 'Solar PV System';
    if (hasBattery) {
      systemTitle += ' ' + HC.systemTitle.batteryTemplate.replace('{kwh}', titleKw(this.batterySectionTotalKw));
    }
    if (hasPanel) {
      systemTitle += ' + ' + HC.systemTitle.panelTemplate.replace('{kw}', titleKw(this.panelTotalKw));
    }

    // ---- คำบรรยาย Racking: group ตาม roof type จริง (คนละ roof type ก็รวมมาหมด ไม่ใช่แค่ roof type ที่เลือกอยู่ตอนนี้) ----
    // เดิมใช้ panel kW / systemWatts เป็น unit/quantity ของแถวนี้ (ตามรูปต้นแบบ) แต่นั่นคือค่าของแผง ไม่เกี่ยวกับ racking ที่เลือกจริงเลย — เปลี่ยนมาสะท้อนของจริงแทน
    const rackingGroups = this.roofTypes
      .map((rt) => {
        const lines = this.rackingItems
          .filter((item) => item.roofTypeId === rt.id && (this.rackingQtyMap[item.id] ?? 0) > 0)
          .map((item) => item.description);
        return { name: rt.name, lines };
      })
      .filter((g) => g.lines.length > 0);
    const selectedRoofTypeName =
      this.roofTypes.find((r) => String(r.id) === this.selectedRoofTypeId)?.name ?? '';
    const rackingDescription =
      rackingGroups.length > 0
        ? rackingGroups.map((g) => `${g.name}: ${g.lines.join(', ')}`).join(' | ')
        : selectedRoofTypeName;

    // ---- คำบรรยาย Installation: ใช้ description ที่กรอกจริงในตาราง Labour (ทั้ง 3 หมวด) ถ้ามี ----
    // ไม่มีเลย (ฟอร์มว่าง) ค่อย fallback เป็นข้อความมาตรฐาน — ดู quotation-hardcode.ts
    const labourDescriptions = Array.from(
      new Set(
        [...this.inHouseLabourRows, ...this.outsourcedLabourRows, ...this.machineryRows]
          .map((row) => row.description?.trim())
          .filter((desc): desc is string => !!desc)
      )
    );
    const installationDescription =
      labourDescriptions.length > 0 ? labourDescriptions.join(', ') : HC.rowDescription.installation;

    // ---- แถวในตาราง: แถวหลักแต่ละ section มาจาก data (Installation = fallback ถ้าไม่มีข้อความกรอกจริง), BOS/Documentation ใช้ข้อความมาตรฐาน ----
    // accessories ที่กรอก qty > 0 ของแต่ละ section ต่อท้าย description ของแถวหลักด้วย comma (ไม่แยกแถว)
    const rows: QuotationLineRow[] = [];

    // ต่อท้าย description หลักด้วยรายการ accessories (คั่น comma) — ว่างถ้าไม่มี accessory ที่กรอก qty
    const appendAccessories = (base: string, accessories: { acc: { brand: string; description: string } }[]): string => {
      const text = accessories.map((a) => `${a.acc.brand} - ${a.acc.description}`).join(', ');
      return text ? `${base}, ${text}` : base;
    };

    if (hasInverter) {
      // brand + phase ไม่ได้อยู่ใน description ของ catalog เสมอไป (เช่น "SUN2000-5K-LB0 (10Y)") — เติมนำหน้าให้เห็นครบ
      const inverterDescription = appendAccessories(
        `${this.selectedInverter!.brand} ${this.selectedInverter!.phase} - ${this.selectedInverter!.description}`,
        this.selectedInverterAccessories
      );
      rows.push({ item: 'SOLAR INVERTER', description: inverterDescription, unit: HC.unit.inverter, quantity: this.inverterQuantity!, total: null });
    }

    if (hasBattery) {
      // brand ไม่ได้อยู่ใน description ของ catalog เสมอไป — เติมนำหน้าเหมือน Inverter
      const batteryDescription = appendAccessories(
        `${this.selectedBattery!.brand} - ${this.selectedBattery!.description} Total ${titleKw(this.batterySectionTotalKw)}kWh`,
        this.selectedBatteryAccessories
      );
      rows.push({ item: 'SOLAR BATTERY', description: batteryDescription, unit: HC.unit.battery, quantity: this.batteryQuantity!, total: null });
    }

    if (hasPanel) {
      // ไม่มี phase เหมือน Inverter — เติมแค่ brand นำหน้า
      const panelDescription = appendAccessories(
        `${this.selectedPanel!.brand} - ${this.selectedPanel!.description}`,
        this.selectedPanelAccessories
      );
      rows.push({ item: 'SOLAR PANELS', description: panelDescription, unit: HC.unit.panels, quantity: this.panelQuantity!, total: null });
    }

    if (this.rackingSectionTotal > 0) {
      // unit/quantity ของแถวนี้ = กำลังรวมของ Panels ("10.3kW" / 10320 W) ตามรูปต้นแบบ — ไม่มีแผงเลยค่อย fallback "LOT" × 1
      rows.push({
        item: 'SOLAR RACKING',
        description: rackingDescription,
        unit: hasPanel ? `${this.panelTotalKw.toFixed(1)}kW` : HC.unit.racking,
        quantity: hasPanel ? this.systemWatts : 1,
        total: null,
      });
    }
    if (this.bosSectionTotal > 0) {
      // คำบรรยาย BOS: list ทุกรายการที่กรอก qty จริงจากทั้ง 4 หมวด (Cables/Switch Gears/Solar Equipment/Conduit) + Accessories
      // รวมเป็น list เดียว ไม่ group ตามหมวด (ต่างจาก Racking ที่ group ตาม roof type)
      const bosLines = (items: BOSItem[], qty: (number | null)[]): string[] =>
        items
          .map((item, i) => ({ item, qty: qty[i] ?? 0 }))
          .filter((row) => row.qty > 0)
          .map((row) => `${row.item.description}${row.item.size ? ` (${row.item.size})` : ''}`);

      const bosAllLines = [
        ...bosLines(this.cables, this.cableQty),
        ...bosLines(this.switchGears, this.switchGearQty),
        ...bosLines(this.solarEquipment, this.solarEquipmentQty),
        ...bosLines(this.conduitJunctionBoxes, this.conduitJunctionBoxQty),
        ...this.selectedBosAccessories.map((row) => `${row.item.description}${row.item.size ? ` (${row.item.size})` : ''}`),
      ];
      // fallback ข้อความมาตรฐาน — ไม่ควรเกิดจริงเพราะ guard bosSectionTotal > 0 บนแล้ว แต่กันไว้เผื่อ edge case
      const bosDescription = bosAllLines.length > 0 ? bosAllLines.join(', ') : HC.rowDescription.bos;
      rows.push({ item: 'SOLAR BOS', description: bosDescription, unit: HC.unit.bos, quantity: 1, total: null });
    }
    if (this.installationSectionTotal > 0) {
      rows.push({ item: 'INSTALLATION', description: installationDescription, unit: HC.unit.installation, quantity: 1, total: null });
    }
    // หมายเหตุ: แถว DOCUMENTATION + "Solar PV Kit" + "TOTAL COST" หน้า preview เป็นคน render เอง
    // จาก snapshot.documentationTotal (คิดจาก section 7) / solarPvKitTotal / totalCost

    // กันสร้างใบเสนอราคาจากฟอร์มเปล่า — ไม่งั้นจะได้เอกสารที่มีแต่ยอด Documentation (ไม่มีรายการอุปกรณ์เลย)
    // (แนวเดียวกับ guard hasAnyItem ใน trySave)
    if (rows.length === 0) {
      this.warnIncompleteSelection('No equipment selected. Cannot create a quotation yet');
      return;
    }

    // ---- สรุปยอด: VAT คิดจาก SUBTOTAL แล้วปัด 2 ตำแหน่งก่อนบวก (กันคอลัมน์บวกไม่ลง) ----
    // BOS ใช้ bosSummaryTotal (cost + markup) ให้ตรงกับยอดที่โชว์บนหน้า Estimate — ไม่ใช่ bosSectionTotal ที่เป็น cost ล้วน
    // ปัด 2 ตำแหน่งกัน float error จาก markup (เช่น 38 × 1.4 = 53.199999...)
    const solarPvKitTotal = Math.round((
      this.panelSectionTotal + this.inverterSectionTotal + this.batterySectionTotal +
      this.rackingSectionTotal + this.bosSummaryTotal + this.installationSectionTotal
    ) * 100) / 100;
    const documentationTotal = this.documentationSectionTotal;
    // ใช้เงื่อนไขเดียวกับตอน save (เลือก type + qty > 0) — type ที่ rate = 0 (เช่น FIT) ก็ยังแสดงในเอกสาร แม้ยอดเป็น 0
    const documentationDescription = Array.from(
      new Set(
        this.documentationRows
          .filter((row) => (row.quantity ?? 0) > 0)
          .map((row) => this.documentationTypeOf(row)?.name)
          .filter((name): name is string => !!name)
      )
    ).join(', ');
    const totalCost = solarPvKitTotal + documentationTotal;
    const vatAmount = Math.round(totalCost * HC.vatRate * 100) / 100;
    const grandTotal = totalCost + vatAmount;

    const contactPersonName = this.contactPersonName;

    const snapshot: QuotationSnapshot = {
      customerId: this.customerId,
      estimateId: this.estimateId,
      systemTitle,
      customerName: this.customer?.displayName ?? '',
      contactPersonName,
      issuedDateIso: new Date().toISOString(),
      customerAddress: this.customer?.fullAddress ?? '',
      projectLocation: this.customer?.projectLocationName ?? '',
      salesRepName: this.salesRepName.trim(),
      rows,
      solarPvKitTotal,
      documentationTotal,
      documentationDescription,
      totalCost,
      vatRate: HC.vatRate,
      vatAmount,
      grandTotal,
      panelBrand: this.selectedPanelBrand ?? this.selectedPanel?.brand ?? '',
      remarkLines: splitRemarkLines(this.pdfRemarks),
    };

    this.quotationPreview.set(snapshot);
    this.router.navigate(['/pdf-bos-preview']);
  }

  activeSection = 'sec-1';
  mobileNavOpen = false;
  showSolarBOSDialog = signal(false);

  private readonly scrollSpy = new ScrollSpy(
    ['sec-1', 'sec-3', 'sec-4', 'sec-5', 'sec-6', 'sec-7', 'sec-8', 'sec-9', 'sec-10', 'sec-11', 'sec-12', 'sec-13'],
    (id) => (this.activeSection = id)
  );

  ngAfterViewInit() {
    this.scrollSpy.start();
  }

  ngOnDestroy() {
    this.scrollSpy.stop();
  }

  scrollTo(id: string) {
    const element = document.getElementById(id);
    if (element) {
      const top = element.getBoundingClientRect().top + window.scrollY - 40;

      this.activeSection = id;
      this.scrollSpy.suppress(700);

      window.scrollTo({
        top,
        behavior: 'smooth'
      });
    }
    // document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openSolarBOSDialog(): void {
    this.showSolarBOSDialog.set(true);
  }

  readonly energyPatterns: EnergyPattern[] = [
    { value: 'daytime', icon: '☀️', label: 'Mostly Daytime', desc: '80% day / 20% night' },
    { value: 'balanced', icon: '⚡🌙', label: 'Balanced', desc: '60% day / 40% night' },
    { value: 'nighttime', icon: '🌙', label: 'Mostly Nighttime', desc: '40% day / 60% night' },
    { value: 'heavy-night', icon: '🌙🌙', label: 'Heavy Nighttime', desc: '20% day / 80% night' }
  ];

  // ===== 1. Panels — เลือก Brand ก่อน แล้ว Description ที่ filter ตาม brand จะระบุแถวจริงใน DB =====
  panels: PanelItem[] = [];
  selectedPanelBrand: string | null = null;
  selectedPanelId: string | null = null;
  panelQuantity: number | null = null;

  get panelBrandOptions(): SelectOption[] {
    const brands = Array.from(new Set(this.panels.map((p) => p.brand))).sort();
    return brands.map((b) => ({ label: b, value: b }));
  }

  get panelDescriptionOptions(): SelectOption[] {
    if (!this.selectedPanelBrand) return [];
    return this.panels
      .filter((p) => p.brand === this.selectedPanelBrand)
      .map((p) => ({ label: `${p.kw} W | ${p.description}`, value: String(p.id) }));
  }

  get selectedPanel(): PanelItem | undefined {
    return this.panels.find((p) => String(p.id) === this.selectedPanelId);
  }

  // panels.kw เก็บค่าเป็น W จริง (เช่น 645) แม้ชื่อ field จะเป็น kw — จึงตั้งชื่อ getter ตามหน่วยจริง
  get panelWatts(): number { return this.selectedPanel?.kw ?? 0; }
  get panelCostPrice(): number { return this.selectedPanel?.costPrice ?? 0; }
  get panelPriceMarkup(): number { return this.selectedPanel?.salePrice ?? 0; }
  get panelProfit(): number { return (this.selectedPanel?.salePrice ?? 0) - (this.selectedPanel?.costPrice ?? 0); }
  get panelTotal(): number { return this.panelPriceMarkup * (this.panelQuantity ?? 0); }
  get panelTotalWatts(): number { return this.panelWatts * (this.panelQuantity ?? 0); }
  get panelTotalKw(): number { return this.panelTotalWatts / 1000; }

  // brand เปลี่ยน → description เดิมอาจไม่ตรง brand ใหม่ ต้อง reset (รวม qty เพราะ selection ไม่ครบแล้ว)
  onPanelBrandChange(): void {
    this.selectedPanelId = null;
    this.panelQuantity = null;
  }

  // ปุ่มถังขยะแถว Panels: ล้าง brand + description + qty กลับเป็นแถวว่าง
  // ทำไมไม่ใช้ onPanelBrandChange: ตั้งค่าจากโค้ดไม่ยิง (onChange) ของ p-select และต้องล้างตัว brand เองด้วย
  // accessories อยู่ตารางแยก ไม่ล้าง
  clearPanelRow(): void {
    this.selectedPanelBrand = null;
    this.selectedPanelId = null;
    this.panelQuantity = null;
  }

  // accessories ทั้งหมดจาก catalog — แสดงเป็นตาราง กรอกได้แค่ qty
  panelAccessories: AccessoryItem[] = [];
  panelAccessoryQty: (number | null)[] = [];

  // สรุปเฉพาะ accessories ที่กรอก qty > 0 — ใช้แสดงตารางสรุปนอก accordion
  get selectedPanelAccessories(): { acc: AccessoryItem; qty: number; profit: number; total: number }[] {
    return this.panelAccessories
      .map((acc, i) => ({
        acc,
        qty: this.panelAccessoryQty[i] ?? 0,
        profit: acc.salePrice - acc.costPrice,
        total: acc.salePrice * (this.panelAccessoryQty[i] ?? 0),
      }))
      .filter((item) => item.qty > 0);
  }

  // รวม Total เฉพาะ accessories ที่เลือก — ใช้เป็น footer ของตารางสรุป
  get panelAccessoriesTotal(): number {
    return this.selectedPanelAccessories.reduce((sum, item) => sum + item.total, 0);
  }

  // รวม Total ของ section 1.1 = panel หลัก + accessories ที่กรอก qty (kW รวมเฉพาะ panel หลัก เพราะ accessories ไม่มี kW)
  get panelSectionTotal(): number {
    const accessoriesTotal = this.panelAccessories.reduce(
      (sum, acc, i) => sum + acc.salePrice * (this.panelAccessoryQty[i] ?? 0), 0
    );
    return this.panelTotal + accessoriesTotal;
  }
  get panelSectionTotalKw(): number { return this.panelTotalKw; }

  // สรุป section 1 เป็นแถวเดียว: รวมแผงหลัก + accessories ที่กรอก qty > 0, description = แผงที่เลือก
  get panelSummaryRows(): SectionSummaryRow[] {
    const panel = this.selectedPanel;
    const qty = this.panelQuantity ?? 0;
    return this.buildSectionSummaryRows({
      description: panel ? `${panel.brand} ${panel.kw} W | ${panel.description}` : '—',
      mainCost: panel && qty > 0 ? panel.costPrice * qty : 0,
      hasMain: !!panel && qty > 0,
      accessories: this.selectedPanelAccessories,
      sectionTotal: this.panelSectionTotal,
    });
  }

  // สรุปเป็นแถวเดียวต่อ section — input: ข้อมูลของ item หลัก + accessories ที่กรอก qty แล้ว + ยอดรวมของ section
  // output: [] ถ้ายังไม่มีอะไรให้สรุป, ไม่งั้น 1 แถว โดย total = salePrice (เหมือน roofTypeTotals ของ section 4)
  private buildSectionSummaryRows(input: {
    description: string;
    mainCost: number;
    hasMain: boolean;
    accessories: { acc: AccessoryItem; qty: number }[];
    sectionTotal: number;
  }): SectionSummaryRow[] {
    if (!input.hasMain && input.accessories.length === 0) return [];

    const accessoriesCost = input.accessories.reduce((sum, item) => sum + item.acc.costPrice * item.qty, 0);
    const totalCost = input.mainCost + accessoriesCost;

    return [{
      description: input.description,
      totalCost,
      salePrice: input.sectionTotal,
      profit: input.sectionTotal - totalCost,
      total: input.sectionTotal,
    }];
  }

  // ===== 2. Inverters — Brand → Phase → รุ่น (brand+phase+kW ซ้ำกันได้ ต้องผูก value เป็น id) =====
  inverters: InverterItem[] = [];
  selectedInverterBrand: string | null = null;
  selectedInverterPhase: string | null = null;
  selectedInverterId: string | null = null;
  inverterQuantity: number | null = null;

  get inverterBrandOptions(): SelectOption[] {
    const brands = Array.from(new Set(this.inverters.map((i) => i.brand))).sort();
    return brands.map((b) => ({ label: b, value: b }));
  }

  get inverterPhaseOptions(): SelectOption[] {
    if (!this.selectedInverterBrand) return [];
    const phases = Array.from(
      new Set(this.inverters.filter((i) => i.brand === this.selectedInverterBrand).map((i) => i.phase))
    ).sort();
    return phases.map((p) => ({ label: p, value: p }));
  }

  get inverterModelOptions(): SelectOption[] {
    if (!this.selectedInverterBrand || !this.selectedInverterPhase) return [];
    return this.inverters
      .filter((i) => i.brand === this.selectedInverterBrand && i.phase === this.selectedInverterPhase)
      .map((i) => ({ label: `${i.kw} kW | ${i.description}`, value: String(i.id) }));
  }

  get selectedInverter(): InverterItem | undefined {
    return this.inverters.find((i) => String(i.id) === this.selectedInverterId);
  }

  get inverterKw(): number { return this.selectedInverter?.kw ?? 0; }
  get inverterCostPrice(): number { return this.selectedInverter?.costPrice ?? 0; }
  get inverterPriceMarkup(): number { return this.selectedInverter?.salePrice ?? 0; }
  get inverterProfit(): number { return (this.selectedInverter?.salePrice ?? 0) - (this.selectedInverter?.costPrice ?? 0); }
  get inverterTotal(): number { return this.inverterPriceMarkup * (this.inverterQuantity ?? 0); }
  get inverterTotalKw(): number { return this.inverterKw * (this.inverterQuantity ?? 0); }

  onInverterBrandChange(): void {
    this.selectedInverterPhase = null;
    this.selectedInverterId = null;
    this.inverterQuantity = null;
  }

  onInverterPhaseChange(): void {
    this.selectedInverterId = null;
    this.inverterQuantity = null;
  }

  // ปุ่มถังขยะแถว Inverters: ล้าง brand + phase + รุ่น + qty (ต้องล้าง phase ด้วย ไม่งั้น dropdown รุ่นค้างตัวเลือกของ brand เดิม)
  clearInverterRow(): void {
    this.selectedInverterBrand = null;
    this.selectedInverterPhase = null;
    this.selectedInverterId = null;
    this.inverterQuantity = null;
  }

  inverterAccessories: AccessoryItem[] = [];
  inverterAccessoryQty: (number | null)[] = [];

  // สรุปเฉพาะ accessories ที่กรอก qty > 0 — ใช้แสดงตารางสรุปนอก accordion
  get selectedInverterAccessories(): { acc: AccessoryItem; qty: number; profit: number; total: number }[] {
    return this.inverterAccessories
      .map((acc, i) => ({
        acc,
        qty: this.inverterAccessoryQty[i] ?? 0,
        profit: acc.salePrice - acc.costPrice,
        total: acc.salePrice * (this.inverterAccessoryQty[i] ?? 0),
      }))
      .filter((item) => item.qty > 0);
  }

  // รวม Total เฉพาะ accessories ที่เลือก — ใช้เป็น footer ของตารางสรุป
  get inverterAccessoriesTotal(): number {
    return this.selectedInverterAccessories.reduce((sum, item) => sum + item.total, 0);
  }

  get inverterSectionTotal(): number {
    const accessoriesTotal = this.inverterAccessories.reduce(
      (sum, acc, i) => sum + acc.salePrice * (this.inverterAccessoryQty[i] ?? 0), 0
    );
    return this.inverterTotal + accessoriesTotal;
  }
  get inverterSectionTotalKw(): number { return this.inverterTotalKw; }

  // สรุป section 2 เป็นแถวเดียว: รวม inverter หลัก + accessories ที่กรอก qty > 0, description = รุ่นที่เลือก
  get inverterSummaryRows(): SectionSummaryRow[] {
    const inverter = this.selectedInverter;
    const qty = this.inverterQuantity ?? 0;
    return this.buildSectionSummaryRows({
      description: inverter ? `${inverter.brand} ${inverter.kw} kW | ${inverter.description}` : '—',
      mainCost: inverter && qty > 0 ? inverter.costPrice * qty : 0,
      hasMain: !!inverter && qty > 0,
      accessories: this.selectedInverterAccessories,
      sectionTotal: this.inverterSectionTotal,
    });
  }

  // ===== 3. Batteries — เลือก Brand ก่อน แล้ว Description ที่ filter ตาม brand จะระบุแถวจริงใน DB =====
  batteries: BatteryItem[] = [];
  selectedBatteryBrand: string | null = null;
  selectedBatteryId: string | null = null;
  batteryQuantity: number | null = null;

  get batteryBrandOptions(): SelectOption[] {
    const brands = Array.from(new Set(this.batteries.map((b) => b.brand))).sort();
    return brands.map((b) => ({ label: b, value: b }));
  }

  get batteryDescriptionOptions(): SelectOption[] {
    if (!this.selectedBatteryBrand) return [];
    return this.batteries
      .filter((b) => b.brand === this.selectedBatteryBrand)
      .map((b) => ({ label: b.description, value: String(b.id) }));
  }

  get selectedBattery(): BatteryItem | undefined {
    return this.batteries.find((b) => String(b.id) === this.selectedBatteryId);
  }

  get batteryKw(): number { return this.selectedBattery?.kw ?? 0; }
  get batteryCostPrice(): number { return this.selectedBattery?.costPrice ?? 0; }
  get batteryPriceMarkup(): number { return this.selectedBattery?.salePrice ?? 0; }
  get batteryProfit(): number { return (this.selectedBattery?.salePrice ?? 0) - (this.selectedBattery?.costPrice ?? 0); }
  get batteryTotal(): number { return this.batteryPriceMarkup * (this.batteryQuantity ?? 0); }
  get batteryTotalKw(): number { return this.batteryKw * (this.batteryQuantity ?? 0); }

  onBatteryBrandChange(): void {
    this.selectedBatteryId = null;
    this.batteryQuantity = null;
  }

  // ปุ่มถังขยะแถว Batteries: ล้าง brand + description + qty กลับเป็นแถวว่าง (accessories แยกตาราง ไม่ล้าง)
  clearBatteryRow(): void {
    this.selectedBatteryBrand = null;
    this.selectedBatteryId = null;
    this.batteryQuantity = null;
  }

  batteryAccessories: AccessoryItem[] = [];
  batteryAccessoryQty: (number | null)[] = [];

  // สรุปเฉพาะ accessories ที่กรอก qty > 0 — ใช้แสดงตารางสรุปนอก accordion
  get selectedBatteryAccessories(): { acc: AccessoryItem; qty: number; profit: number; total: number }[] {
    return this.batteryAccessories
      .map((acc, i) => ({
        acc,
        qty: this.batteryAccessoryQty[i] ?? 0,
        profit: acc.salePrice - acc.costPrice,
        total: acc.salePrice * (this.batteryAccessoryQty[i] ?? 0),
      }))
      .filter((item) => item.qty > 0);
  }

  // รวม Total เฉพาะ accessories ที่เลือก — ใช้เป็น footer ของตารางสรุป
  get batteryAccessoriesTotal(): number {
    return this.selectedBatteryAccessories.reduce((sum, item) => sum + item.total, 0);
  }

  get batterySectionTotal(): number {
    const accessoriesTotal = this.batteryAccessories.reduce(
      (sum, acc, i) => sum + acc.salePrice * (this.batteryAccessoryQty[i] ?? 0), 0
    );
    return this.batteryTotal + accessoriesTotal;
  }
  get batterySectionTotalKw(): number { return this.batteryTotalKw; }

  // สรุป section 3 เป็นแถวเดียว: รวมแบตหลัก + accessories ที่กรอก qty > 0, description = รุ่นที่เลือก
  get batterySummaryRows(): SectionSummaryRow[] {
    const battery = this.selectedBattery;
    const qty = this.batteryQuantity ?? 0;
    return this.buildSectionSummaryRows({
      description: battery ? `${battery.brand} | ${battery.description}` : '—',
      mainCost: battery && qty > 0 ? battery.costPrice * qty : 0,
      hasMain: !!battery && qty > 0,
      accessories: this.selectedBatteryAccessories,
      sectionTotal: this.batterySectionTotal,
    });
  }

  // ===== 4. Solar Racking — เลือก Roof Type ได้ทีละอัน (คลิกแล้วสลับตารางทันทีเหมือน Section 5) =====
  roofTypes: RoofTypeItem[] = [];
  rackingItems: SolarRackingItem[] = [];
  selectedRoofTypeId: string | null = null;
  // เก็บ qty ด้วย item.id แทน index array — กัน qty หายตอนสลับไป roof type อื่นแล้วย้อนกลับมา
  rackingQtyMap: Record<number, number | null> = {};

  get roofTypeOptions(): SelectOption[] {
    return this.roofTypes.map((r) => ({ label: r.name, value: String(r.id) }));
  }

  get filteredRackingItems(): SolarRackingItem[] {
    if (!this.selectedRoofTypeId) return [];
    return this.rackingItems.filter((r) => String(r.roofTypeId) === this.selectedRoofTypeId);
  }

  // ใช้กำลังรวมของ section Panels (W) เป็นฐานคำนวณ Cost / W ต่อรายการ
  get systemWatts(): number { return this.panelTotalWatts; }

  // รวม Total ของ "ทุก" roof type ที่เคยกรอก qty ไว้ (ไม่ใช่แค่ตัวที่กำลังดูอยู่) เพราะเป็นยอดรวมจริงของ section นี้
  get rackingSectionTotal(): number {
    return this.rackingItems.reduce(
      (sum, item) => sum + item.salePrice * (this.rackingQtyMap[item.id] ?? 0), 0
    );
  }

  // สรุปแยกตาม roof type ที่ "มี qty กรอกไว้จริง" เท่านั้น (ไม่ต้องเลือกไว้ตอนนี้ก็ได้ ถ้าเคยกรอก qty แล้วจะยังโชว์)
  // ทุกคอลัมน์คำนวณจาก qty ที่กรอกจริงเท่านั้น (คูณ qty แล้ว) ไม่ใช่รวมราคาของทุก item ในรายการเฉยๆ
  get roofTypeTotals(): {
    roofTypeId: string;
    roofTypeName: string;
    totalCost: number;
    salePrice: number;
    quantity: number;
    profit: number;
    total: number;
  }[] {
    return this.roofTypes
      .map((r) => {
        const items = this.rackingItems.filter((item) => item.roofTypeId === r.id);
        const quantity = items.reduce((sum, item) => sum + (this.rackingQtyMap[item.id] ?? 0), 0);
        return { r, items, quantity };
      })
      .filter(({ quantity }) => quantity > 0)
      .map(({ r, items, quantity }) => {
        const totalCost = items.reduce((sum, item) => sum + item.costPrice * (this.rackingQtyMap[item.id] ?? 0), 0);
        const salePrice = items.reduce((sum, item) => sum + item.salePrice * (this.rackingQtyMap[item.id] ?? 0), 0);
        return {
          roofTypeId: String(r.id),
          roofTypeName: r.name,
          totalCost,
          salePrice,
          quantity,
          profit: salePrice - totalCost,
          total: salePrice,
        };
      });
  }

  // ===== 5. Solar BOS — 4 catalog ที่ไม่มี sale_price (แสดงเฉพาะ Cost Price/Total) + accessories =====
  // tab เลือกดูตารางไหน — สลับ tab แค่ซ่อน/แสดง ไม่ reset qty ของ tab อื่น (data อยู่ที่ array ของ component ไม่ใช่ DOM)
  selectedBosCategory = 'cables';
  readonly bosCategoryOptions: SelectOption[] = [
    { label: 'Cables', value: 'cables' },
    { label: 'Switch Gears', value: 'switch_gears' },
    { label: 'Solar Equipment', value: 'solar_equipment' },
    { label: 'Conduit & Junction Boxes', value: 'conduit_junction_boxes' },
  ];

  cables: BOSItem[] = [];
  cableQty: (number | null)[] = [];
  get cablesTotal(): number {
    return this.cables.reduce((sum, item, i) => sum + item.costPrice * (this.cableQty[i] ?? 0), 0);
  }

  switchGears: BOSItem[] = [];
  switchGearQty: (number | null)[] = [];
  get switchGearsTotal(): number {
    return this.switchGears.reduce((sum, item, i) => sum + item.costPrice * (this.switchGearQty[i] ?? 0), 0);
  }

  solarEquipment: BOSItem[] = [];
  solarEquipmentQty: (number | null)[] = [];
  get solarEquipmentTotal(): number {
    return this.solarEquipment.reduce((sum, item, i) => sum + item.costPrice * (this.solarEquipmentQty[i] ?? 0), 0);
  }

  conduitJunctionBoxes: BOSItem[] = [];
  conduitJunctionBoxQty: (number | null)[] = [];
  get conduitJunctionBoxesTotal(): number {
    return this.conduitJunctionBoxes.reduce((sum, item, i) => sum + item.costPrice * (this.conduitJunctionBoxQty[i] ?? 0), 0);
  }

  bosAccessories: BOSItem[] = [];
  bosAccessoryQty: (number | null)[] = [];
  get bosAccessoriesTotal(): number {
    return this.bosAccessories.reduce((sum, item, i) => sum + item.costPrice * (this.bosAccessoryQty[i] ?? 0), 0);
  }

  // สรุปเฉพาะ accessories ที่กรอก qty > 0 — ใช้แสดงตารางสรุปนอก accordion (BOSItem ไม่มี salePrice/profit)
  get selectedBosAccessories(): { item: BOSItem; qty: number; total: number }[] {
    return this.bosAccessories
      .map((item, i) => ({
        item,
        qty: this.bosAccessoryQty[i] ?? 0,
        total: item.costPrice * (this.bosAccessoryQty[i] ?? 0),
      }))
      .filter((row) => row.qty > 0);
  }

  // รวม Total ของ Section 1.5: Solar BOS ทั้ง 4 ตาราง + accessories
  get bosSectionTotal(): number {
    return this.cablesTotal + this.switchGearsTotal + this.solarEquipmentTotal
      + this.conduitJunctionBoxesTotal + this.bosAccessoriesTotal;
  }

  // BOS catalog ไม่มี sale_price — คิด Sale Price = Cost + 40% (ตามที่ตกลงกับ user) เปลี่ยนสัดส่วนได้ที่ค่านี้ที่เดียว
  private readonly bosMarkupRate = 0.4;

  // input: cost ต่อหน่วยของ BOS item — output: ราคาขายต่อหน่วย ปัด 2 ตำแหน่ง
  // ปัดต่อหน่วยเพราะค่านี้ถูก freeze ลง DB (estimate_bos_items.sale_price) และ DB คิด total = sale_price × qty — ตารางสรุป/PDF ต้องรวมจากค่าเดียวกันจึงจะตรงกับ DB
  private bosSalePriceOf(costPrice: number): number {
    return Math.round(costPrice * (1 + this.bosMarkupRate) * 100) / 100;
  }

  private bosSaleTotalOf(items: BOSItem[], qtys: (number | null)[]): number {
    return items.reduce((sum, item, i) => sum + this.bosSalePriceOf(item.costPrice) * (qtys[i] ?? 0), 0);
  }

  // สรุป section 5 เป็นแถวเดียวต่อหมวดที่กรอก qty > 0 (Cables / Switch Gears / Solar Equipment / Conduit & JB / Accessories)
  // output: totalCost = ยอด cost ของหมวด, salePrice = ยอดขายของหมวด (รวมจากราคาขายต่อหน่วยที่ปัดแล้ว), total = salePrice
  get bosSummaryRows(): SectionSummaryRow[] {
    const categories: { name: string; items: BOSItem[]; qtys: (number | null)[]; totalCost: number }[] = [
      { name: 'Cables', items: this.cables, qtys: this.cableQty, totalCost: this.cablesTotal },
      { name: 'Switch Gears', items: this.switchGears, qtys: this.switchGearQty, totalCost: this.switchGearsTotal },
      { name: 'Solar Equipment', items: this.solarEquipment, qtys: this.solarEquipmentQty, totalCost: this.solarEquipmentTotal },
      { name: 'Conduit & Junction Boxes', items: this.conduitJunctionBoxes, qtys: this.conduitJunctionBoxQty, totalCost: this.conduitJunctionBoxesTotal },
      { name: 'Accessories', items: this.bosAccessories, qtys: this.bosAccessoryQty, totalCost: this.bosAccessoriesTotal },
    ];

    return categories
      .filter((category) => category.qtys.some((qty) => (qty ?? 0) > 0))
      .map((category) => {
        const salePrice = this.bosSaleTotalOf(category.items, category.qtys);
        return {
          description: category.name,
          totalCost: category.totalCost,
          salePrice,
          profit: salePrice - category.totalCost,
          total: salePrice,
        };
      });
  }

  get bosSummaryTotal(): number {
    return this.bosSummaryRows.reduce((sum, row) => sum + row.total, 0);
  }

  readonly bosOptions: SelectOption[] = [
    { label: 'DC Cabling Set', value: 'dc-cabling' },
    { label: 'AC Cabling Set', value: 'ac-cabling' },
    { label: 'Conduit & Trunking', value: 'conduit' },
    { label: 'Junction Box Set', value: 'junction-box' },
    { label: 'Surge Protection Device', value: 'spd' },
  ];
  selectedBOS: string | null = null;

  // ===== 6. Installation — 3 ตาราง labour/machinery คีย์เองทั้งหมด (add row ได้ไม่จำกัด) =====
  private newLabourRow(): LabourCostRow {
    return { description: '', unitRate: null, units: null };
  }

  inHouseLabourRows: LabourCostRow[] = [this.newLabourRow()];
  outsourcedLabourRows: LabourCostRow[] = [this.newLabourRow()];
  machineryRows: LabourCostRow[] = [this.newLabourRow()];

  addLabourRow(rows: LabourCostRow[]): void {
    rows.push(this.newLabourRow());
  }

  removeLabourRow(rows: LabourCostRow[], index: number): void {
    rows.splice(index, 1);
  }

  rowTotal(row: LabourCostRow): number {
    return (row.unitRate ?? 0) * (row.units ?? 0);
  }

  private rowsTotal(rows: LabourCostRow[]): number {
    return rows.reduce((sum, row) => sum + this.rowTotal(row), 0);
  }

  get inHouseLabourTotal(): number { return this.rowsTotal(this.inHouseLabourRows); }
  get outsourcedLabourTotal(): number { return this.rowsTotal(this.outsourcedLabourRows); }
  get machineryTotal(): number { return this.rowsTotal(this.machineryRows); }

  get installationSectionTotal(): number {
    return this.inHouseLabourTotal + this.outsourcedLabourTotal + this.machineryTotal;
  }

  // output: จำนวนแถว Labour/Machinery ที่มียอด (unitRate × units > 0) แต่ Description ว่าง
  // ทำไม: แถวพวกนี้ถูกนับในยอดรวม แต่ buildItemsPayload ข้ามแถวที่ไม่มี description → ยอดที่ save ไม่ตรงกับหน้าจอ/PDF
  get labourRowsMissingDescription(): number {
    return [...this.inHouseLabourRows, ...this.outsourcedLabourRows, ...this.machineryRows]
      .filter((row) => this.rowTotal(row) > 0 && !row.description?.trim())
      .length;
  }

  // ใช้ร่วมกันทั้ง save และ export PDF — true = ผ่าน, false = แจ้งเตือนแล้ว ต้องหยุดทำงานต่อ
  private ensureLabourRowsHaveDescription(): boolean {
    if (this.labourRowsMissingDescription === 0) return true;
    this.warnIncompleteSelection('Please enter a description for every labour/machinery row that has a cost');
    return false;
  }

  // สรุป section 6 เป็นแถวเดียวต่อหมวด 6.1/6.2/6.3 ที่มียอด > 0
  // ไม่มี markup (ตามที่ตกลงกับ user): salePrice = totalCost จึง profit = 0
  get installationSummaryRows(): SectionSummaryRow[] {
    const categories: { name: string; totalCost: number }[] = [
      { name: 'In-House Labour Costs', totalCost: this.inHouseLabourTotal },
      { name: 'Outsourced Labour Costs', totalCost: this.outsourcedLabourTotal },
      { name: 'Machinery', totalCost: this.machineryTotal },
    ];

    return categories
      .filter((category) => category.totalCost > 0)
      .map((category) => ({
        description: category.name,
        totalCost: category.totalCost,
        salePrice: category.totalCost,
        profit: 0,
        total: category.totalCost,
      }));
  }

  // ===== 7. Documentation — เลือก Type จาก catalog (ตั้งค่าที่ Settings > Products > Documentation), unit rate มาจาก type =====
  documentationTypes: DocumentationTypeItem[] = [];
  documentationTypeOptions: Array<{ label: string; value: number }> = [];

  private newDocumentationRow(): DocumentationRow {
    return { typeId: null, quantity: null };
  }

  documentationRows: DocumentationRow[] = [this.newDocumentationRow()];

  private documentationTypeOf(row: DocumentationRow): DocumentationTypeItem | null {
    return this.documentationTypes.find((t) => t.id === row.typeId) ?? null;
  }

  addDocumentationRow(): void {
    this.documentationRows.push(this.newDocumentationRow());
  }

  removeDocumentationRow(index: number): void {
    this.documentationRows.splice(index, 1);
    // ลบจนหมดแล้วต้องเหลือแถวว่างไว้ให้กรอกต่อ (เหมือน labour rows ตอน prefill)
    if (this.documentationRows.length === 0) this.documentationRows.push(this.newDocumentationRow());
  }

  // เลือก type แล้ว qty ยังว่าง → ใส่ 1 ให้เลย (เอกสารส่วนใหญ่ยื่นครั้งละ 1 ชุด) ผู้ใช้แก้ได้
  onDocumentationTypeChange(row: DocumentationRow): void {
    if (row.typeId !== null && row.quantity === null) row.quantity = 1;
  }

  // ยังไม่เลือก type → null (template แสดง "—"), rate = 0 → template แสดง "฿ —" (เช่น PEA / MEA FIT ที่ยังไม่มีราคา)
  documentationRowRate(row: DocumentationRow): number | null {
    return this.documentationTypeOf(row)?.unitRate ?? null;
  }

  documentationRowTotal(row: DocumentationRow): number {
    return (this.documentationRowRate(row) ?? 0) * (row.quantity ?? 0);
  }

  get documentationSectionTotal(): number {
    return this.documentationRows.reduce((sum, row) => sum + this.documentationRowTotal(row), 0);
  }
}
