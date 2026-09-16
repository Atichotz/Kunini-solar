import { Component, OnInit, AfterViewInit, OnDestroy, DestroyRef, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
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
import { EquipmentService, PanelItem, InverterItem, BatteryItem, AccessoryItem, RoofTypeItem, SolarRackingItem, BOSItem } from '../../services/equipment.service';
import { CustomerService } from '../../services/customer.service';
import { EstimateService } from '../../services/estimate.service';
import { QuotationPreviewService } from '../../services/quotation-preview.service';
import { QUOTATION_HARDCODE } from '../pdf-bos-preview/quotation-hardcode';
import type { QuotationLineRow, QuotationSnapshot } from '../../dto/quotation.dto';
import type { CustomerDetail, ContactDetail } from '../../dto/customer.dto';
import type {
  EstimateDetail,
  EstimateItemsPayload,
  EstimateLabourItemView,
  SaveEstimatePayload,
  SaveEstimateResult,
} from '../../dto/estimate.dto';

interface SelectOption {
  label: string;
  value: string;
}

interface LabourCostRow {
  description: string;
  unitRate: number | null;
  units: number | null;
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
}

@Component({
  selector: 'app-estimate-page',
  imports: [FormsModule, SelectModule, SelectButtonModule, RouterLink, ButtonModule, NgClass, NgFor, NgIf, DecimalPipe, Tooltip, AccordionModule, ToastModule, ConfirmDialogModule, SolarBOSDialogComponent],
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
  private readonly destroyRef = inject(DestroyRef);

  // customer id ที่มาจากหน้า Customer Detail (ผ่าน query param) — ใช้พาผู้ใช้กลับไปหน้าลูกค้าคนเดิมตอนกด X / Save Draft
  customerId: string | null = null;
  customer: CustomerDetail | null = null;

  // estimate id — มีตอนเปิด draft เดิมกลับมาแก้ (?estimateId=) หรือหลังจากเจอ draft ค้างของลูกค้าตอนเปิดหน้าเปล่าๆ
  estimateId: string | null = null;
  saving = signal(false);

  // ปุ่ม X / Save Draft: กลับไปหน้าลูกค้าเดิมถ้ามี customerId, ถ้าไม่มี (เข้ามาตรงๆ ไม่ผ่าน customer detail) ให้กลับ dashboard แทน
  get backLink(): string[] {
    return this.customerId ? ['/detail', this.customerId] : ['/dashboard'];
  }

  get primaryContact(): ContactDetail | null {
    if (!this.customer || this.customer.contacts.length === 0) return null;
    return this.customer.contacts.find((c) => c.isPrimary) ?? this.customer.contacts[0];
  }

  get contactReference(): string {
    const contact = this.primaryContact;
    if (!contact) return '—';
    const parts = [contact.tel, contact.email].filter((v): v is string => !!v);
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

    this.loadCatalogs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((catalogs) => {
        this.applyCatalogs(catalogs);
        this.loadEstimateForPrefill();
      });
  }

  // output: Observable ของ catalog ทั้ง 13 เส้น — endpoint ไหนพังไม่ทำให้ทั้งหน้าว่าง (catchError คืน [] + toast เตือน)
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
    });
  }

  private catalogLoadFailed<T>(label: string): Observable<T[]> {
    console.error(`[API] Failed to load catalog: ${label}`);
    this.messageService.add({ severity: 'warn', summary: 'โหลดข้อมูลไม่ครบ', detail: `โหลด ${label} ไม่สำเร็จ`, life: 4000 });
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
  }

  // โหลด prefill เฉพาะตอนมี estimateId ชัดเจน (มาจาก History) — ไม่ auto เดา draft ล่าสุดของลูกค้า
  private loadEstimateForPrefill(): void {
    if (!this.estimateId) return;

    this.estimateService.getOne(this.estimateId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          if (detail.status === 'final') {
            // final แก้ไม่ได้แล้ว — พาไปหน้า history แทนที่จะเปิดฟอร์มแก้
            this.router.navigate(['/detail', detail.customerId, 'estimate', detail.id]);
            return;
          }
          this.prefill(detail);
        },
        error: (err) => console.error('[API] Failed to load estimate:', err),
      });
  }

  // เซ็ตค่ากลับเข้า state จาก source_id (ไม่ใช่ค่า freeze) — ราคาที่แสดงจึงเป็นราคาปัจจุบันจาก catalog เสมอ
  private prefill(detail: EstimateDetail): void {
    let skipped = 0;

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

    if (skipped > 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'มีบางรายการถูกข้าม',
        detail: `มีรายการที่ไม่มีในระบบแล้ว ${skipped} รายการ ถูกข้ามไป`,
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
          cost_price: item.costPrice, quantity: qty, sort_order: i,
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

    return { panel, inverter, battery, racking, bos, labour };
  }

  private buildPayload(finalize: boolean): SaveEstimatePayload {
    return {
      customer_id: this.customerId!,
      finalize,
      head: {
        customer_display_name: this.customer?.displayName ?? null,
        contact_reference: this.primaryContact ? this.contactReference : null,
        project_location_name: this.customer?.projectLocationName ?? null,
        type_of_system_name: this.customer?.typeOfSystemName ?? null,
      },
      items: this.buildItemsPayload(),
    };
  }

  // input: finalize flag + callback ตอนสำเร็จ — output: void, จัดการ validate/error/navigate ให้ทั้ง Save Draft และ Save
  private trySave(finalize: boolean, onSuccess: (result: SaveEstimateResult) => void): void {
    if (!this.customerId) {
      this.warnIncompleteSelection('ต้องเปิดหน้านี้จากหน้าลูกค้าก่อนถึงจะบันทึกได้');
      return;
    }
    if (this.saving()) return;

    const payload = this.buildPayload(finalize);
    const hasAnyItem = payload.items.panel.length || payload.items.inverter.length || payload.items.battery.length
      || payload.items.racking.length || payload.items.bos.length || payload.items.labour.length;
    if (!hasAnyItem) {
      this.warnIncompleteSelection('ยังไม่ได้เลือกอุปกรณ์หรือกรอกรายการใดๆ');
      return;
    }

    this.saving.set(true);
    this.estimateService.save(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          onSuccess(result);
          this.router.navigate(this.backLink);
        },
        error: (err) => {
          this.saving.set(false);
          console.error('[API] Failed to save estimate:', err);
          const detail = err?.status === 409
            ? 'Estimate นี้ถูกยืนยันไปแล้วจากที่อื่น กรุณาเปิดหน้าใหม่'
            : 'กรุณาลองใหม่อีกครั้ง';
          this.messageService.add({ severity: 'error', summary: 'บันทึกไม่สำเร็จ', detail, life: 4000 });
        },
      });
  }

  onSaveDraft(): void {
    this.trySave(false, () =>
      this.messageService.add({ severity: 'success', summary: 'บันทึก Draft แล้ว', life: 2000 }));
  }

  onSave(): void {
    if (!this.customerId) {
      this.warnIncompleteSelection('ต้องเปิดหน้านี้จากหน้าลูกค้าก่อนถึงจะบันทึกได้');
      return;
    }
    this.confirmationService.confirm({
      header: 'ยืนยัน Estimate',
      message: 'หลังยืนยันแล้วจะแก้ไข Estimate นี้ไม่ได้อีก ต้องการยืนยันหรือไม่?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'ยืนยัน',
      rejectLabel: 'ยกเลิก',
      accept: () => this.trySave(true, () =>
        this.messageService.add({ severity: 'success', summary: 'ยืนยัน Estimate แล้ว', life: 2000 })),
    });
  }

  // ===== Export to PDF — รวมยอดทุก section เป็น snapshot แล้วส่งต่อหน้า preview =====
  // preview เป็น renderer อย่างเดียว: aggregation ทั้งหมดเกิดที่นี่ (ราคาที่โชว์ลูกค้า = ราคาขาย, ยกเว้น BOS ที่ไม่มี sale price → ใช้ cost price)
  onExportPdf(): void {
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
      rows.push({ item: 'SOLAR RACKING', description: rackingDescription, unit: HC.unit.racking, quantity: 1, total: null });
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
    // จาก snapshot.documentationTotal / solarPvKitTotal / totalCost (ค่ายัง hardcode — ดู quotation-hardcode.ts)

    // กันสร้างใบเสนอราคาจากฟอร์มเปล่า — ไม่งั้นจะได้เอกสารที่คิดเงินลูกค้าจากค่า Documentation ที่ hardcode ไว้อย่างเดียว
    // (แนวเดียวกับ guard hasAnyItem ใน trySave)
    if (rows.length === 0) {
      this.warnIncompleteSelection('ยังไม่ได้เลือกอุปกรณ์ ยังสร้างใบเสนอราคาไม่ได้');
      return;
    }

    // ---- สรุปยอด: VAT คิดจาก SUBTOTAL แล้วปัด 2 ตำแหน่งก่อนบวก (กันคอลัมน์บวกไม่ลง) ----
    const solarPvKitTotal =
      this.panelSectionTotal + this.inverterSectionTotal + this.batterySectionTotal +
      this.rackingSectionTotal + this.bosSectionTotal + this.installationSectionTotal;
    const documentationTotal = HC.documentationTotal;
    const totalCost = solarPvKitTotal + documentationTotal;
    const vatAmount = Math.round(totalCost * HC.vatRate * 100) / 100;
    const grandTotal = totalCost + vatAmount;

    const contact = this.primaryContact;
    const contactPersonName = contact
      ? [contact.firstname, contact.lastname].filter((v): v is string => !!v).join(' ').trim()
      : '';

    const snapshot: QuotationSnapshot = {
      customerId: this.customerId,
      estimateId: this.estimateId,
      systemTitle,
      customerName: this.customer?.displayName ?? '',
      contactPersonName,
      issuedDateIso: new Date().toISOString(),
      rows,
      solarPvKitTotal,
      documentationTotal,
      totalCost,
      vatRate: HC.vatRate,
      vatAmount,
      grandTotal,
      panelBrand: this.selectedPanelBrand ?? this.selectedPanel?.brand ?? '',
    };

    this.quotationPreview.set(snapshot);
    this.router.navigate(['/pdf-bos-preview']);
  }

  activeSection = 'sec-1';
  navOpen = true;
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
      .map((p) => ({ label: `${p.kw} kW | ${p.description}`, value: String(p.id) }));
  }

  get selectedPanel(): PanelItem | undefined {
    return this.panels.find((p) => String(p.id) === this.selectedPanelId);
  }

  get panelKw(): number { return this.selectedPanel?.kw ?? 0; }
  get panelCostPrice(): number { return this.selectedPanel?.costPrice ?? 0; }
  get panelPriceMarkup(): number { return this.selectedPanel?.salePrice ?? 0; }
  get panelProfit(): number { return (this.selectedPanel?.salePrice ?? 0) - (this.selectedPanel?.costPrice ?? 0); }
  get panelTotal(): number { return this.panelPriceMarkup * (this.panelQuantity ?? 0); }
  get panelTotalKw(): number { return this.panelKw * (this.panelQuantity ?? 0); }

  // brand เปลี่ยน → description เดิมอาจไม่ตรง brand ใหม่ ต้อง reset (รวม qty เพราะ selection ไม่ครบแล้ว)
  onPanelBrandChange(): void {
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

  // ใช้ Total kW จาก section Panels (สัดส่วนกำลังผลิตของระบบ) แปลงเป็น W เพื่อคำนวณ Cost / W ต่อรายการ
  get systemWatts(): number { return this.panelTotalKw * 1000; }

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
}
