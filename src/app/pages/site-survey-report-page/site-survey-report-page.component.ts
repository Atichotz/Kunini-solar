import { Component, DestroyRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DatePickerModule } from 'primeng/datepicker';
import { ImageModule } from 'primeng/image';
import { SelectModule } from 'primeng/select';
import { catchError, concatMap, forkJoin, from, map, Observable, of, toArray } from 'rxjs';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
import { CustomerService } from '../../services/customer.service';
import { BatteryItem, EquipmentService, InverterItem } from '../../services/equipment.service';
import { SiteSurveyReportService } from '../../services/site-survey-report.service';
import {
  SITE_SURVEY_PHOTO_SLOTS,
  type SaveSiteSurveyReportPayload,
  type SiteSurveyLayoutPhotoKind,
  type SiteSurveyPhoto,
  type SiteSurveyPhotoSlot,
  type SiteSurveyPhotoTarget,
  type SiteSurveyReportDetail,
} from '../../dto/site-survey-report.dto';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

type PhotoSlot = SiteSurveyPhotoSlot;

// ชนิดรูปของ layout → ชื่อ field ใน LayoutOption ที่เก็บรูปชนิดนั้น (ใช้ให้ handler เดียวรองรับทั้ง Layout Sketch และ PV String Design)
const LAYOUT_PHOTO_LIST_BY_KIND = {
  sketch: 'sketchPhotos',
  stringDesign: 'stringDesignPhotos',
} as const satisfies Record<SiteSurveyLayoutPhotoKind, keyof LayoutOption>;

// รูปในฟอร์ม 2 แบบ: staged (มี file, previewUrl เป็น blob URL — อัปโหลดตอนกด Save) กับ saved (มี serverId, previewUrl เป็น signed URL)
interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string;
  file?: File;
  serverId?: string;
}

interface LayoutOption {
  // id ฝั่ง client ใช้ track ใน @for เท่านั้น — ห้ามส่งให้ backend
  id: string;
  // มีเมื่อ layout นี้ save แล้ว: ส่งเป็น id ตอน PUT (แก้ของเดิม) และใช้แนบรูป sketch
  serverId?: string;
  title: string;
  estimatedCapacity: string;
  orientation: string;
  designRationale: string;
  sketchPhotos: PhotoItem[];
  stringDesignPhotos: PhotoItem[];
}

interface SelectOption {
  label: string;
  value: string;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const ROOF_MATERIAL_OPTIONS = [
  'CPAC Monier (Concrete Tile)',
  'Metal Sheet (Klip-lok / PU)',
  'Flat Roof (Concrete Deck)',
  'Shingle Roof',
  'Ceramic / Excella',
  'Other',
];

const TARIFF_OPTIONS: SelectOption[] = [
  { label: 'Standard Residential', value: 'Standard Residential' },
  { label: 'TOU (Time of Use)', value: 'TOU (Time of Use)' },
  { label: 'Commercial', value: 'Commercial' },
];

const ELECTRICAL_PHASE_OPTIONS: SelectOption[] = [
  { label: '1-Phase (220V)', value: '1-Phase (220V)' },
  { label: '3-Phase (380V)', value: '3-Phase (380V)' },
];

// value ตรงกับ inverters.phase ใน DB ('1P'/'3P') เพื่อให้ auto-fill จาก catalog เลือกตัวเลือกถูกตัว
const INVERTER_PHASE_OPTIONS: SelectOption[] = [
  { label: '1 phase', value: '1P' },
  { label: '3 phase', value: '3P' },
];

// ตัวเลือก "Other" ใน dropdown brand/model — เลือกแล้วให้กรอก free text เอง
const OTHER_OPTION_VALUE = '__other__';
const OTHER_OPTION: SelectOption = { label: 'Other (type manually)', value: OTHER_OPTION_VALUE };

const OPTIMIZER_RATIO_OPTIONS: SelectOption[] = [
  { label: '1 ต่อ 1', value: '1 ต่อ 1' },
  { label: '1 ต่อ 2', value: '1 ต่อ 2' },
];

@Component({
  selector: 'app-site-survey-report-page',
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, ConfirmDialogModule, DatePickerModule, ImageModule, KLoadingComponent, SelectModule],
  providers: [ConfirmationService],
  templateUrl: './site-survey-report-page.component.html',
  styleUrl: './site-survey-report-page.component.scss',
})
export class SiteSurveyReportPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customerService = inject(CustomerService);
  private readonly equipmentService = inject(EquipmentService);
  private readonly reportService = inject(SiteSurveyReportService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // customer id จาก query param — Survey Report ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน report-page)
  customerId: string | null = null;

  // report id จาก query param — ไม่มี = report ใหม่ (สร้างตอนกด Save ครั้งแรก แล้ว URL จะถูกเติม reportId)
  reportId: string | null = null;

  isLoadingCustomer = false;
  isLoadingReport = false;
  loadErrorMessage = '';

  // ===== สถานะการบันทึก =====
  isSaving = false;
  // true เมื่อ save นี้ถูกเริ่มจากปุ่ม Export to PDF — save สำเร็จครบ (รวมรูป) แล้วค่อยไปหน้า preview; ล้มเหลวที่ไหนก็ล้างค่านี้ ไม่ให้ Save ครั้งหน้าเด้งไป preview เอง
  private exportAfterSave = false;
  saveNotice = '';
  saveErrorMessage = '';
  // true เมื่อ PUT โดน 409 (มีคนอื่น save ไปก่อน) — โชว์ปุ่ม Reload latest
  isConflict = false;
  photoErrorMessage = '';
  // serverId ของรูปที่กำลังลบอยู่ — กันกดซ้ำและใช้โชว์ spinner
  removingPhotoId: string | null = null;

  // ===== meta จาก server =====
  // savedAt = token ส่งกลับเป็น expected_saved_at ตอน PUT (เปลี่ยนเฉพาะตอน save ฟอร์ม)
  // updatedAt/updatedBy = ใครแก้ล่าสุด รวมการแก้รูป — ใช้โชว์อย่างเดียว ห้ามเอาไปแทน savedAt
  private savedAt: string | null = null;
  createdAt: string | null = null;
  createdBy: string | null = null;
  updatedAt: string | null = null;
  updatedBy: string | null = null;

  readonly tariffOptions = TARIFF_OPTIONS;
  readonly electricalPhaseOptions = ELECTRICAL_PHASE_OPTIONS;
  readonly roofMaterialOptions = ROOF_MATERIAL_OPTIONS;
  readonly inverterPhaseOptions = INVERTER_PHASE_OPTIONS;
  readonly optimizerRatioOptions = OPTIMIZER_RATIO_OPTIONS;
  readonly otherOptionValue = OTHER_OPTION_VALUE;

  // ===== 1. General Information & Electric Bill =====
  customerName = '';
  address = '';
  surveyDateTime: Date | null = null;
  surveyedBy = '';
  avgMonthlyBill = '';
  avgUsageKwh = '';
  tariffType: string | null = null;

  // ===== 2. Roof Findings & Structural Assessment =====
  roofMaterialType = ROOF_MATERIAL_OPTIONS[0];
  roofCondition = '';
  roofPitch = '';
  shadingIssues = '';

  // ===== 3. Electrical Room & System Layout =====
  electricalPhase: string | null = ELECTRICAL_PHASE_OPTIONS[1].value;
  mainBreakerSize = '';
  groundingCheck = '';
  inverterLocation = '';
  acCableRun = '';
  dcCableRun = '';

  photosBySlot: Record<PhotoSlot, PhotoItem[]> = this.emptyPhotosBySlot();

  // ===== 4. Inverter, Optimizer & Battery =====
  // catalog จาก DB — โหลดไม่ได้ก็ยังกรอก free text ได้ (dropdown เหลือแค่ "Other")
  private inverterCatalog: InverterItem[] = [];
  private batteryCatalog: BatteryItem[] = [];

  // อัปเดตเฉพาะตอนโหลด catalog / เปลี่ยน brand (ไม่ใช่ getter) เพราะ [options] ของ PrimeNG ต้องได้ array ตัวเดิมทุกรอบ CD
  inverterBrandOptions: SelectOption[] = [OTHER_OPTION];
  inverterModelOptions: SelectOption[] = [OTHER_OPTION];
  batteryBrandOptions: SelectOption[] = [OTHER_OPTION];
  batteryModelOptions: SelectOption[] = [OTHER_OPTION];

  // ค่าที่เลือกใน dropdown (ชื่อ brand / id ของ model / OTHER_OPTION_VALUE) แยกจากค่าที่จะบันทึกจริงด้านล่าง
  inverterBrandSelection: string | null = null;
  inverterModelSelection: string | null = null;
  batteryBrandSelection: string | null = null;
  batteryModelSelection: string | null = null;

  inverterBrand = '';
  inverterModel = '';
  inverterPhase: string | null = null;
  inverterPowerKw: number | null = null;
  inverterQuantity: number | null = null;
  inverterSize = '';

  // Optimizer/Battery ไม่ได้มีทุกไซต์ — ติ๊กแล้วซ่อนฟอร์ม เพื่อไม่บังคับกรอก
  hasOptimizer = true;
  optimizerBrand = '';
  optimizerModel = '';
  optimizerQuantity: number | null = null;
  optimizerRatio: string | null = null;

  hasBattery = true;
  batteryBrand = '';
  batteryModel = '';
  batteryCapacityKwh: number | null = null;
  batteryCount: number | null = null;
  batteryVoltageMin: number | null = null;
  batteryVoltageMax: number | null = null;
  batteryCurrentAh: number | null = null;
  batteryInstallDate: Date | null = null;

  // Output: ความจุรวมเป็น kWh (capacity × count) หรือ '' ถ้ากรอกยังไม่ครบ — ใช้แสดงผลอย่างเดียว ผู้ใช้แก้เองไม่ได้
  get totalBatteryCapacityKwh(): string {
    if (this.batteryCapacityKwh === null || this.batteryCount === null) return '';
    // ปัดทศนิยม กัน floating point เช่น 0.1 × 3 = 0.30000000000000004
    return String(Math.round(this.batteryCapacityKwh * this.batteryCount * 100) / 100);
  }

  // Output: true เมื่อกรอก voltage ทั้งสองช่องแล้ว min ไม่น้อยกว่า max — ใช้โชว์ข้อความเตือน
  get isBatteryVoltageRangeInvalid(): boolean {
    return (
      this.batteryVoltageMin !== null &&
      this.batteryVoltageMax !== null &&
      this.batteryVoltageMin >= this.batteryVoltageMax
    );
  }

  // ===== 5. PV Layout Suggestions =====
  layoutOptions: LayoutOption[] = [];

  // ===== 6. Notes & Remarks =====
  clientNotes = '';
  notesForCustomer = '';
  internalNotes = '';

  get backLink(): string[] {
    return this.customerId ? ['/detail', this.customerId] : ['/dashboard'];
  }

  ngOnInit(): void {
    this.customerId = this.route.snapshot.queryParamMap.get('customerId');
    this.reportId = this.route.snapshot.queryParamMap.get('reportId');

    if (!this.customerId) {
      this.loadErrorMessage = 'Customer not found. Please open this page from the customer detail page';
      return;
    }

    if (this.reportId) {
      this.loadExistingReport(this.reportId);
      return;
    }

    this.loadCustomer(this.customerId);
    this.loadCatalogs().subscribe((catalogs) => this.applyCatalogs(catalogs));
    this.layoutOptions = [this.newLayoutOption()];
  }

  // กันปิดแท็บ/รีเฟรชระหว่าง save — ถ้าหลุดกลางทางรูปที่ค้างอยู่จะไม่ถูกอัปโหลด
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.isSaving) event.preventDefault();
  }

  // ล้าง blob URL ของรูปที่ยังไม่อัปโหลดทั้งหมด กัน memory leak ตอนออกจากหน้า
  ngOnDestroy(): void {
    this.revokeAllStagedPreviews();
  }

  private emptyPhotosBySlot(): Record<PhotoSlot, PhotoItem[]> {
    return Object.fromEntries(SITE_SURVEY_PHOTO_SLOTS.map((slot) => [slot, []])) as unknown as Record<
      PhotoSlot,
      PhotoItem[]
    >;
  }

  private revokeAllStagedPreviews(): void {
    for (const photo of Object.values(this.photosBySlot).flat()) this.revokeIfStaged(photo);
    for (const option of this.layoutOptions) this.revokeLayoutOptionPreviews(option);
  }

  private revokeIfStaged(photo: PhotoItem): void {
    if (photo.file) URL.revokeObjectURL(photo.previewUrl);
  }

  private loadCustomer(id: string): void {
    this.isLoadingCustomer = true;
    this.customerService.getOne(id).subscribe({
      next: (customer) => {
        this.customerName = customer.displayName ?? '';
        this.address = customer.fullAddress ?? '';
        this.isLoadingCustomer = false;
      },
      error: (err) => {
        console.error('[API] Failed to load customer for Survey Report:', err);
        // โหลด customer ไม่ได้ (เช่น id ผิด) — ยังเปิดหน้าได้ แค่ปล่อยชื่อ/ที่อยู่ให้กรอกเอง
        this.isLoadingCustomer = false;
      },
    });
  }

  // ===== โหลด report เดิม =====

  // input: report UUID — โหลด report + catalog พร้อมกัน เพราะต้องมีทั้งคู่ถึงคืนค่า dropdown brand/model ได้ถูก
  // report จะ override ทุก field ในฟอร์ม (รวมชื่อ/ที่อยู่ลูกค้าที่เป็น snapshot ตอน save) — ไม่โหลด customer ซ้ำ
  private loadExistingReport(id: string): void {
    this.isLoadingReport = true;
    this.loadErrorMessage = '';

    forkJoin({
      report: this.reportService.getOne(id),
      catalogs: this.loadCatalogs(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ report, catalogs }) => {
          this.applyCatalogs(catalogs);
          this.applyReportToForm(report);
          this.isLoadingReport = false;
        },
        error: (err: HttpErrorResponse) => {
          console.error('[API] Failed to load site survey report:', err);
          this.isLoadingReport = false;
          this.loadErrorMessage =
            err.status === 404
              ? 'This report was not found. It may have been deleted'
              : 'Failed to load the report. Please try again';
        },
      });
  }

  // กด Reload latest หลังโดน 409 — ทิ้งสิ่งที่แก้ค้างอยู่ทั้งหมดแล้วโหลดของ server มาแทน
  confirmReloadLatest(): void {
    if (!this.reportId) return;
    const id = this.reportId;
    this.confirmationService.confirm({
      header: 'Reload latest version',
      message: 'Your unsaved changes and photos waiting to upload will be discarded. Continue?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Reload',
      rejectLabel: 'Cancel',
      accept: () => {
        this.revokeAllStagedPreviews();
        this.clearStatusMessages();
        this.loadExistingReport(id);
      },
    });
  }

  // input: report จาก server / output: เขียนทุก field ในฟอร์มทับ + คืนค่า dropdown + รูป + layout + meta
  // ใช้ตอนโหลดครั้งแรกและ reload เท่านั้น — ห้ามเรียกหลัง save เพราะจะทับสิ่งที่ผู้ใช้พิมพ์ต่อระหว่างอัปโหลดรูป
  private applyReportToForm(r: SiteSurveyReportDetail): void {
    this.customerId = r.customerId;
    this.customerName = r.customerName ?? '';
    this.address = r.address ?? '';
    this.surveyDateTime = r.surveyDateTime ? new Date(r.surveyDateTime) : null;
    this.surveyedBy = r.surveyedBy ?? '';
    this.avgMonthlyBill = r.avgMonthlyBill ?? '';
    this.avgUsageKwh = r.avgUsageKwh ?? '';
    this.tariffType = r.tariffType;

    this.roofMaterialType = r.roofMaterialType ?? ROOF_MATERIAL_OPTIONS[0];
    this.roofCondition = r.roofCondition ?? '';
    this.roofPitch = r.roofPitch ?? '';
    this.shadingIssues = r.shadingIssues ?? '';

    this.electricalPhase = r.electricalPhase;
    this.mainBreakerSize = r.mainBreakerSize ?? '';
    this.groundingCheck = r.groundingCheck ?? '';
    this.inverterLocation = r.inverterLocation ?? '';
    this.acCableRun = r.acCableRun ?? '';
    this.dcCableRun = r.dcCableRun ?? '';

    this.inverterBrand = r.inverterBrand ?? '';
    this.inverterModel = r.inverterModel ?? '';
    this.inverterPhase = r.inverterPhase;
    this.inverterPowerKw = r.inverterPowerKw;
    this.inverterQuantity = r.inverterQuantity;
    this.inverterSize = r.inverterSize ?? '';

    this.hasOptimizer = r.hasOptimizer;
    this.optimizerBrand = r.optimizerBrand ?? '';
    this.optimizerModel = r.optimizerModel ?? '';
    this.optimizerQuantity = r.optimizerQuantity;
    this.optimizerRatio = r.optimizerRatio;

    this.hasBattery = r.hasBattery;
    this.batteryBrand = r.batteryBrand ?? '';
    this.batteryModel = r.batteryModel ?? '';
    this.batteryCapacityKwh = r.batteryCapacityKwh;
    this.batteryCount = r.batteryCount;
    this.batteryVoltageMin = r.batteryVoltageMin;
    this.batteryVoltageMax = r.batteryVoltageMax;
    this.batteryCurrentAh = r.batteryCurrentAh;
    this.batteryInstallDate = parseDateOnly(r.batteryInstallDate);

    this.clientNotes = r.clientNotes ?? '';
    this.notesForCustomer = r.notesForCustomer ?? '';
    this.internalNotes = r.internalNotes ?? '';

    this.restoreEquipmentSelections();

    this.photosBySlot = this.emptyPhotosBySlot();
    for (const slot of SITE_SURVEY_PHOTO_SLOTS) {
      this.photosBySlot[slot] = r.photosBySlot[slot].map((p) => this.toSavedPhotoItem(p));
    }
    this.layoutOptions = r.layoutOptions.map((l) => ({
      id: nextId('layout'),
      serverId: l.id,
      title: l.title,
      estimatedCapacity: l.estimatedCapacity ?? '',
      orientation: l.orientation ?? '',
      designRationale: l.designRationale ?? '',
      sketchPhotos: l.sketchPhotos.map((p) => this.toSavedPhotoItem(p)),
      stringDesignPhotos: l.stringDesignPhotos.map((p) => this.toSavedPhotoItem(p)),
    }));
    // report ที่ไม่มี layout เลย (เช่น ลบหมดแล้ว save) ยังต้องมีกล่องให้กรอกหนึ่งอัน เหมือนตอนเปิด report ใหม่
    if (this.layoutOptions.length === 0) this.layoutOptions = [this.newLayoutOption()];

    this.applyMeta(r);
  }

  private applyMeta(r: SiteSurveyReportDetail): void {
    this.reportId = r.id;
    this.savedAt = r.savedAt;
    this.createdAt = r.createdAt;
    this.createdBy = r.createdBy;
    this.updatedAt = r.updatedAt;
    this.updatedBy = r.updatedBy;
  }

  private toSavedPhotoItem(photo: SiteSurveyPhoto): PhotoItem {
    return { id: `saved-${photo.id}`, serverId: photo.id, name: photo.fileName, previewUrl: photo.url };
  }

  // ===== Inverter / Battery catalog (dropdown จาก DB, เลือก Other เพื่อกรอกเอง) =====

  // โหลด catalog แยกทีละเส้น — เส้นไหนพังคืน [] (ผู้ใช้ยังกรอก free text ได้) ไม่ให้ทั้งหน้าพัง
  private loadCatalogs(): Observable<{ inverters: InverterItem[]; batteries: BatteryItem[] }> {
    return forkJoin({
      inverters: this.equipmentService.getInverters().pipe(catchError(() => this.catalogLoadFailed<InverterItem>('inverters'))),
      batteries: this.equipmentService.getBatteries().pipe(catchError(() => this.catalogLoadFailed<BatteryItem>('batteries'))),
    });
  }

  private applyCatalogs({ inverters, batteries }: { inverters: InverterItem[]; batteries: BatteryItem[] }): void {
    this.inverterCatalog = inverters;
    this.batteryCatalog = batteries;
    this.inverterBrandOptions = this.buildBrandOptions(inverters);
    this.batteryBrandOptions = this.buildBrandOptions(batteries);
  }

  private catalogLoadFailed<T>(label: string): Observable<T[]> {
    console.error(`[API] Failed to load ${label} catalog for Survey Report`);
    return of([]);
  }

  // input: รายการ catalog / output: brand ที่ไม่ซ้ำเรียงตามตัวอักษร + "Other" ท้ายสุด
  private buildBrandOptions(items: { brand: string }[]): SelectOption[] {
    const brands = [...new Set(items.map((item) => item.brand))].sort((a, b) => a.localeCompare(b));
    return [...brands.map((brand) => ({ label: brand, value: brand })), OTHER_OPTION];
  }

  // input: catalog + brand ที่เลือก / output: model ของ brand นั้นเรียงตาม kW + "Other" (value = id เป็น string)
  private buildModelOptions(items: { id: number; brand: string; description: string; kw: number }[], brand: string): SelectOption[] {
    const models = items
      .filter((item) => item.brand === brand)
      .sort((a, b) => Number(a.kw) - Number(b.kw) || a.description.localeCompare(b.description))
      .map((item) => ({ label: item.description, value: String(item.id) }));
    return [...models, OTHER_OPTION];
  }

  // input: catalog + brand/model ที่บันทึกไว้ (ข้อความ) / output: ค่า dropdown ที่ตรงกับข้อความนั้น
  // brand ใน catalog → เลือก brand นั้น, model ตรงชื่อ → เลือก model นั้น ไม่ตรง → "Other" ให้เห็นข้อความที่เคยกรอก
  // brand ไม่อยู่ใน catalog (เช่นเคยกรอกเอง) → "Other" ทั้งคู่ / ว่าง → ไม่เลือกอะไร
  // ไม่เรียก onXxxChange เพราะ handler เหล่านั้นล้าง model/phase/kW ที่เพิ่งโหลดมา
  private resolveSelection(
    catalog: { id: number; brand: string; description: string; kw: number }[],
    brand: string,
    model: string,
  ): { brandSelection: string | null; modelSelection: string | null; modelOptions: SelectOption[] } {
    if (!brand) return { brandSelection: null, modelSelection: null, modelOptions: [OTHER_OPTION] };

    if (!catalog.some((item) => item.brand === brand)) {
      return { brandSelection: OTHER_OPTION_VALUE, modelSelection: null, modelOptions: [OTHER_OPTION] };
    }

    const match = catalog.find((item) => item.brand === brand && item.description === model);
    const modelSelection = match ? String(match.id) : model ? OTHER_OPTION_VALUE : null;
    return { brandSelection: brand, modelSelection, modelOptions: this.buildModelOptions(catalog, brand) };
  }

  private restoreEquipmentSelections(): void {
    const inverter = this.resolveSelection(this.inverterCatalog, this.inverterBrand, this.inverterModel);
    this.inverterBrandSelection = inverter.brandSelection;
    this.inverterModelSelection = inverter.modelSelection;
    this.inverterModelOptions = inverter.modelOptions;

    const battery = this.resolveSelection(this.batteryCatalog, this.batteryBrand, this.batteryModel);
    this.batteryBrandSelection = battery.brandSelection;
    this.batteryModelSelection = battery.modelSelection;
    this.batteryModelOptions = battery.modelOptions;
  }

  // เปลี่ยน brand → ล้าง model และค่าที่เคย auto-fill ไว้ กันค้างของ brand เก่า
  onInverterBrandChange(selection: string | null): void {
    this.inverterBrandSelection = selection;
    this.inverterModelSelection = null;
    this.inverterModel = '';
    this.inverterPhase = null;
    this.inverterPowerKw = null;

    const isCatalogBrand = selection !== null && selection !== OTHER_OPTION_VALUE;
    this.inverterBrand = isCatalogBrand ? selection : '';
    this.inverterModelOptions = isCatalogBrand ? this.buildModelOptions(this.inverterCatalog, selection) : [OTHER_OPTION];
  }

  // เลือก model จาก catalog → auto-fill phase/power (ยังแก้ได้) ส่วน Other → ล้างแล้วให้กรอกเอง
  onInverterModelChange(selection: string | null): void {
    this.inverterModelSelection = selection;
    this.inverterModel = '';
    this.inverterPhase = null;
    this.inverterPowerKw = null;
    if (selection === null || selection === OTHER_OPTION_VALUE) return;

    const item = this.inverterCatalog.find((candidate) => String(candidate.id) === selection);
    if (!item) return;
    this.inverterModel = item.description;
    this.inverterPhase = item.phase;
    this.inverterPowerKw = Number(item.kw);
  }

  onBatteryBrandChange(selection: string | null): void {
    this.batteryBrandSelection = selection;
    this.batteryModelSelection = null;
    this.batteryModel = '';
    this.batteryCapacityKwh = null;

    const isCatalogBrand = selection !== null && selection !== OTHER_OPTION_VALUE;
    this.batteryBrand = isCatalogBrand ? selection : '';
    this.batteryModelOptions = isCatalogBrand ? this.buildModelOptions(this.batteryCatalog, selection) : [OTHER_OPTION];
  }

  // batteries.kw ใน DB เป็นค่า kWh ต่อ unit (ปัดเป็นเลขกลม เช่น 6.9kWh เก็บเป็น 7) — ผู้ใช้แก้ได้ถ้าหน้างานต่างออกไป
  onBatteryModelChange(selection: string | null): void {
    this.batteryModelSelection = selection;
    this.batteryModel = '';
    this.batteryCapacityKwh = null;
    if (selection === null || selection === OTHER_OPTION_VALUE) return;

    const item = this.batteryCatalog.find((candidate) => String(candidate.id) === selection);
    if (!item) return;
    this.batteryModel = item.description;
    this.batteryCapacityKwh = Number(item.kw);
  }

  // ===== Photos (slot-based: เลือกแล้วค้างไว้ก่อน อัปโหลดตอนกด Save) =====

  onPhotoFilesSelected(slot: PhotoSlot, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    this.stagePhotos(this.photosBySlot[slot], files);
  }

  onPhotoDrop(slot: PhotoSlot, event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    this.stagePhotos(this.photosBySlot[slot], files);
  }

  removePhoto(slot: PhotoSlot, photo: PhotoItem): void {
    this.removePhotoItem(photo, () => {
      this.photosBySlot[slot] = this.photosBySlot[slot].filter((p) => p.id !== photo.id);
    });
  }

  // true ระหว่างรอ server ลบรูปนี้ — ใช้ disable ปุ่มลบ
  isPhotoRemoving(photo: PhotoItem): boolean {
    return photo.serverId !== undefined && this.removingPhotoId === photo.serverId;
  }

  // รูปที่ยังไม่อัปโหลด → ลบในเครื่องทันที / รูปที่ save แล้ว → ถามยืนยันก่อน แล้วลบที่ server ทันที (soft delete)
  // input: รูป + callback เอารูปออกจากลิสต์ที่แสดง (เรียกหลังลบสำเร็จ)
  private removePhotoItem(photo: PhotoItem, removeFromView: () => void): void {
    if (this.isSaving) return;

    if (!photo.serverId) {
      this.revokeIfStaged(photo);
      removeFromView();
      return;
    }

    const photoId = photo.serverId;
    const reportId = this.reportId;
    if (!reportId || this.removingPhotoId) return;

    this.confirmationService.confirm({
      header: 'Delete photo',
      message: `Delete "${photo.name}"? This is saved immediately.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.removingPhotoId = photoId;
        this.photoErrorMessage = '';
        this.reportService
          .removePhoto(reportId, photoId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (touch) => {
              this.removingPhotoId = null;
              this.updatedAt = touch.updatedAt;
              this.updatedBy = touch.updatedBy;
              removeFromView();
            },
            error: (err: HttpErrorResponse) => {
              this.removingPhotoId = null;
              // 404 = รูปนี้ถูกลบไปแล้ว (เช่นจากอีก tab) — เอาออกจากหน้าจอให้ตรงกับความจริง
              if (err.status === 404) {
                removeFromView();
                return;
              }
              console.error('[API] Failed to delete site survey photo:', err);
              this.photoErrorMessage = 'Failed to delete the photo. Please try again';
            },
          });
      },
    });
  }

  // input: ลิสต์ปลายทาง + ไฟล์ที่ผู้ใช้เลือก / output: เพิ่มเฉพาะไฟล์ที่ผ่านเงื่อนไข และแจ้งชื่อไฟล์ที่ถูกข้าม (เดิมข้ามเงียบๆ)
  private stagePhotos(target: PhotoItem[], files: File[]): void {
    if (this.isSaving) return;

    const rejected: string[] = [];
    for (const file of files) {
      if (!PHOTO_ACCEPTED_TYPES.includes(file.type)) {
        rejected.push(`${file.name} (only JPEG, PNG, WebP)`);
        continue;
      }
      if (file.size > PHOTO_MAX_SIZE_BYTES) {
        rejected.push(`${file.name} (over 10 MB)`);
        continue;
      }
      target.push({ id: nextId('photo'), file, name: file.name, previewUrl: URL.createObjectURL(file) });
    }
    this.photoErrorMessage = rejected.length > 0 ? `Skipped: ${rejected.join(', ')}` : '';
  }

  // ===== PV Layout Suggestions =====

  private newLayoutOption(): LayoutOption {
    const optionNumber = this.layoutOptions.length + 1;
    return {
      id: nextId('layout'),
      title: optionNumber === 1 ? 'Option 1 (Primary Recommendation)' : `Option ${optionNumber}`,
      estimatedCapacity: '',
      orientation: '',
      designRationale: '',
      sketchPhotos: [],
      stringDesignPhotos: [],
    };
  }

  addLayoutOption(): void {
    if (this.isSaving) return;
    this.layoutOptions.push(this.newLayoutOption());
  }

  // ลบ layout = ลบรูป sketch ของมันด้วยตอนกด Save (backend soft delete ให้) — รูปที่ยังไม่อัปโหลดแค่ล้าง blob
  removeLayoutOption(option: LayoutOption): void {
    if (this.isSaving) return;
    this.revokeLayoutOptionPreviews(option);
    this.layoutOptions = this.layoutOptions.filter((o) => o.id !== option.id);
  }

  private revokeLayoutOptionPreviews(option: LayoutOption): void {
    option.sketchPhotos.forEach((p) => this.revokeIfStaged(p));
    option.stringDesignPhotos.forEach((p) => this.revokeIfStaged(p));
  }

  // kind = ชนิดรูปของ layout ('sketch' = Layout Sketch, 'stringDesign' = PV String Design)
  onLayoutPhotoFilesSelected(option: LayoutOption, kind: SiteSurveyLayoutPhotoKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    this.stagePhotos(option[LAYOUT_PHOTO_LIST_BY_KIND[kind]], files);
  }

  onLayoutPhotoDrop(option: LayoutOption, kind: SiteSurveyLayoutPhotoKind, event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    this.stagePhotos(option[LAYOUT_PHOTO_LIST_BY_KIND[kind]], files);
  }

  removeLayoutPhoto(option: LayoutOption, kind: SiteSurveyLayoutPhotoKind, photo: PhotoItem): void {
    const listKey = LAYOUT_PHOTO_LIST_BY_KIND[kind];
    this.removePhotoItem(photo, () => {
      option[listKey] = option[listKey].filter((p) => p.id !== photo.id);
    });
  }

  // ===== Save =====

  private clearStatusMessages(): void {
    this.saveNotice = '';
    this.saveErrorMessage = '';
    this.isConflict = false;
    this.photoErrorMessage = '';
  }

  // input: ข้อความที่ผู้ใช้กรอกในฟอร์ม / output: ข้อความ error ถ้ามีค่าที่ backend จะปฏิเสธแน่ๆ, null ถ้าผ่าน
  private validateBeforeSave(): string | null {
    const wholeNumbers: [string, number | null][] = [
      ['Inverter quantity', this.inverterQuantity],
      ['Optimizer quantity', this.optimizerQuantity],
      ['Number of battery', this.batteryCount],
    ];
    for (const [label, value] of wholeNumbers) {
      if (value !== null && !Number.isInteger(value)) return `${label} must be a whole number`;
    }

    const nonNegatives: [string, number | null][] = [
      ['Inverter power', this.inverterPowerKw],
      ['Inverter quantity', this.inverterQuantity],
      ['Optimizer quantity', this.optimizerQuantity],
      ['Battery capacity', this.batteryCapacityKwh],
      ['Number of battery', this.batteryCount],
      ['Battery voltage min', this.batteryVoltageMin],
      ['Battery voltage max', this.batteryVoltageMax],
      ['Battery current', this.batteryCurrentAh],
    ];
    for (const [label, value] of nonNegatives) {
      if (value !== null && value < 0) return `${label} cannot be negative`;
    }
    return null;
  }

  // output: payload ที่ประกอบทีละ field — ไม่ spread object ฝั่ง client เพราะ backend (forbidNonWhitelisted) ปฏิเสธ field แปลกปลอม
  // สตริงว่าง → null เพื่อให้ตรงกับ "ยังไม่กรอก" และไม่ติด validator ของ field วันที่
  private buildPayload(customerId: string): SaveSiteSurveyReportPayload {
    return {
      customer_id: customerId,
      ...(this.reportId && this.savedAt ? { expected_saved_at: this.savedAt } : {}),
      head: {
        customer_name: blankToNull(this.customerName),
        address: blankToNull(this.address),
        survey_date_time: this.surveyDateTime ? this.surveyDateTime.toISOString() : null,
        surveyed_by: blankToNull(this.surveyedBy),
        avg_monthly_bill: blankToNull(this.avgMonthlyBill),
        avg_usage_kwh: blankToNull(this.avgUsageKwh),
        tariff_type: this.tariffType,

        roof_material_type: blankToNull(this.roofMaterialType),
        roof_condition: blankToNull(this.roofCondition),
        roof_pitch: blankToNull(this.roofPitch),
        shading_issues: blankToNull(this.shadingIssues),

        electrical_phase: this.electricalPhase,
        main_breaker_size: blankToNull(this.mainBreakerSize),
        grounding_check: blankToNull(this.groundingCheck),
        inverter_location: blankToNull(this.inverterLocation),
        ac_cable_run: blankToNull(this.acCableRun),
        dc_cable_run: blankToNull(this.dcCableRun),

        inverter_brand: blankToNull(this.inverterBrand),
        inverter_model: blankToNull(this.inverterModel),
        inverter_phase: this.inverterPhase,
        inverter_power_kw: this.inverterPowerKw,
        inverter_quantity: this.inverterQuantity,
        inverter_size: blankToNull(this.inverterSize),

        has_optimizer: this.hasOptimizer,
        optimizer_brand: blankToNull(this.optimizerBrand),
        optimizer_model: blankToNull(this.optimizerModel),
        optimizer_quantity: this.optimizerQuantity,
        optimizer_ratio: this.optimizerRatio,

        has_battery: this.hasBattery,
        battery_brand: blankToNull(this.batteryBrand),
        battery_model: blankToNull(this.batteryModel),
        battery_capacity_kwh: this.batteryCapacityKwh,
        battery_count: this.batteryCount,
        battery_voltage_min: this.batteryVoltageMin,
        battery_voltage_max: this.batteryVoltageMax,
        battery_current_ah: this.batteryCurrentAh,
        battery_install_date: formatDateOnly(this.batteryInstallDate),

        client_notes: blankToNull(this.clientNotes),
        notes_for_customer: blankToNull(this.notesForCustomer),
        internal_notes: blankToNull(this.internalNotes),
      },
      // sort_order = ลำดับใน array เสมอ — ตอนบันทึกเสร็จใช้ index จับคู่ layout ฝั่งนี้กับ id จริงจาก server
      layout_options: this.layoutOptions.map((option, index) => ({
        ...(option.serverId ? { id: option.serverId } : {}),
        title: option.title,
        estimated_capacity: blankToNull(option.estimatedCapacity),
        orientation: blankToNull(option.orientation),
        design_rationale: blankToNull(option.designRationale),
        sort_order: index,
      })),
    };
  }

  // กด Save: บันทึกฟอร์ม (POST ถ้ายังไม่มี report, ไม่งั้น PUT) → จับคู่ id ของ layout → อัปโหลดรูปที่ค้างอยู่ทีละรูป
  saveReport(): void {
    if (this.isSaving || !this.customerId) return;

    this.clearStatusMessages();
    const validationError = this.validateBeforeSave();
    if (validationError) {
      this.exportAfterSave = false;
      this.saveErrorMessage = validationError;
      return;
    }

    this.isSaving = true;
    const payload = this.buildPayload(this.customerId);
    const request$ = this.reportId
      ? this.reportService.update(this.reportId, payload)
      : this.reportService.create(payload);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => this.onFormSaved(saved),
      error: (err: HttpErrorResponse) => this.onSaveFailed(err),
    });
  }

  private onFormSaved(saved: SiteSurveyReportDetail): void {
    const wasNew = !this.reportId;
    this.applyMeta(saved);

    // layout ที่ server คืนมาเรียงตาม sort_order = ลำดับที่ส่งไป ถ้าจำนวนไม่เท่ากันแปลว่าเกิดอะไรผิดปกติ — หยุดก่อนแนบรูปผิดที่
    if (saved.layoutOptions.length !== this.layoutOptions.length) {
      this.isSaving = false;
      this.exportAfterSave = false;
      this.saveErrorMessage = 'Saved, but the layout options did not match the server. Reload the page before adding photos';
      return;
    }
    this.layoutOptions.forEach((option, index) => {
      option.serverId = saved.layoutOptions[index].id;
    });
    this.mergeSavedPhotos(saved);

    // สร้างใหม่ครั้งแรก: ใส่ reportId ใน URL เพื่อให้ refresh แล้วเปิด report เดิม (ไม่ใช่ฟอร์มว่างที่ save แล้วได้ report ซ้ำ)
    if (wasNew) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { reportId: saved.id },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    this.uploadStagedPhotos(saved.id, wasNew);
  }

  // หลัง save: แทนรูปที่ save แล้วด้วยชุดสดจาก server (signed URL ใหม่ + สะท้อนรูปที่ถูกลบจากที่อื่น) แต่คงรูปที่ยังไม่อัปโหลดไว้
  private mergeSavedPhotos(saved: SiteSurveyReportDetail): void {
    for (const slot of SITE_SURVEY_PHOTO_SLOTS) {
      const staged = this.photosBySlot[slot].filter((p) => p.file);
      this.photosBySlot[slot] = [...saved.photosBySlot[slot].map((p) => this.toSavedPhotoItem(p)), ...staged];
    }
    this.layoutOptions.forEach((option, index) => {
      for (const kind of Object.keys(LAYOUT_PHOTO_LIST_BY_KIND) as SiteSurveyLayoutPhotoKind[]) {
        const listKey = LAYOUT_PHOTO_LIST_BY_KIND[kind];
        const staged = option[listKey].filter((p) => p.file);
        option[listKey] = [...saved.layoutOptions[index][listKey].map((p) => this.toSavedPhotoItem(p)), ...staged];
      }
    });
  }

  // อัปโหลดรูปที่ค้างอยู่ทีละรูป (ไม่ขนาน) — รูปไหนพลาดยังค้างไว้ให้กด Save ใหม่ ไม่ทำให้รูปอื่นหรือการบันทึกฟอร์มเสียไป
  private uploadStagedPhotos(reportId: string, wasNew: boolean): void {
    interface UploadTask {
      photo: PhotoItem;
      target: SiteSurveyPhotoTarget;
      replaceWith: (saved: PhotoItem) => void;
    }
    const tasks: UploadTask[] = [];

    for (const slot of SITE_SURVEY_PHOTO_SLOTS) {
      for (const photo of this.photosBySlot[slot].filter((p) => p.file)) {
        tasks.push({
          photo,
          target: { slot },
          replaceWith: (savedItem) => {
            this.photosBySlot[slot] = this.photosBySlot[slot].map((p) => (p.id === photo.id ? savedItem : p));
          },
        });
      }
    }
    for (const option of this.layoutOptions) {
      if (!option.serverId) continue;
      const layoutOptionId = option.serverId;
      for (const layoutPhotoKind of Object.keys(LAYOUT_PHOTO_LIST_BY_KIND) as SiteSurveyLayoutPhotoKind[]) {
        const listKey = LAYOUT_PHOTO_LIST_BY_KIND[layoutPhotoKind];
        for (const photo of option[listKey].filter((p) => p.file)) {
          tasks.push({
            photo,
            target: { layoutOptionId, layoutPhotoKind },
            replaceWith: (savedItem) => {
              option[listKey] = option[listKey].map((p) => (p.id === photo.id ? savedItem : p));
            },
          });
        }
      }
    }

    if (tasks.length === 0) {
      this.finishSave([], wasNew);
      return;
    }

    from(tasks)
      .pipe(
        concatMap((task) =>
          this.reportService.uploadPhoto(reportId, task.photo.file as File, task.target).pipe(
            map((result) => {
              this.revokeIfStaged(task.photo);
              task.replaceWith(this.toSavedPhotoItem(result.photo));
              // ใช้เฉพาะ updatedAt/updatedBy ของผลอัปโหลดโชว์ "แก้ล่าสุด" — ไม่แตะ savedAt
              this.updatedAt = result.updatedAt;
              this.updatedBy = result.updatedBy;
              return null;
            }),
            catchError((err: HttpErrorResponse) => {
              console.error('[API] Failed to upload site survey photo:', err);
              return of(task.photo.name);
            }),
          ),
        ),
        toArray(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) =>
        this.finishSave(
          results.filter((name): name is string => name !== null),
          wasNew,
        ),
      );
  }

  // input: ชื่อรูปที่อัปโหลดพลาด + wasNew (save ครั้งแรกของ report นี้หรือไม่)
  // output: พลาด → อยู่หน้าเดิมให้กด Save ซ้ำ / กด Export → ไปหน้า PDF / save ครั้งแรกสำเร็จ → กลับหน้า customer /
  //         แก้ของเดิมสำเร็จ → ถามว่าจะอยู่ต่อหรือกลับหน้า customer (เหมือน estimate-page)
  private finishSave(failedPhotoNames: string[], wasNew: boolean): void {
    this.isSaving = false;
    if (failedPhotoNames.length > 0) {
      // รูปที่อัปโหลดไม่ผ่านจะหายจาก PDF — หยุดอยู่หน้าฟอร์มให้ผู้ใช้กด Save ซ้ำก่อน
      this.exportAfterSave = false;
      this.saveErrorMessage = `Report saved, but ${failedPhotoNames.length} photo(s) failed to upload: ${failedPhotoNames.join(', ')}. Press Save to retry`;
      return;
    }
    this.saveNotice = 'Saved';

    if (this.exportAfterSave && this.reportId) {
      this.exportAfterSave = false;
      void this.router.navigate(['/survey-report-pdf'], { queryParams: { reportId: this.reportId } });
      return;
    }

    if (wasNew) {
      void this.router.navigate(this.backLink);
      return;
    }

    this.confirmationService.confirm({
      header: 'Report Saved',
      message: 'Your report has been saved. Go back to the customer page, or stay here?',
      icon: 'pi pi-check-circle',
      acceptLabel: 'Back to Customer',
      rejectLabel: 'Stay',
      // reject (รวมกด Esc / คลิกนอก dialog) = อยู่หน้าเดิม — ปลอดภัยกว่าพาออกเองโดยผู้ใช้ไม่ได้เลือก
      accept: () => void this.router.navigate(this.backLink),
    });
  }

  private onSaveFailed(err: HttpErrorResponse): void {
    this.isSaving = false;
    this.exportAfterSave = false;
    console.error('[API] Failed to save site survey report:', err);

    if (err.status === 409) {
      this.isConflict = true;
      this.saveErrorMessage =
        'This report was saved by someone else after you opened it. Nothing was overwritten. Reload the latest version before saving again';
    } else if (err.status === 404) {
      this.saveErrorMessage = 'This report (or one of its layouts) no longer exists. It may have been deleted by someone else';
    } else if (err.status === 400) {
      this.saveErrorMessage = `Some values are not valid: ${describeBadRequest(err)}`;
    } else {
      this.saveErrorMessage = 'Failed to save the report. Please try again';
    }
  }

  // PDF พรีวิวดึงจากรายงานที่ save แล้ว (ไม่ใช่สถานะฟอร์มสด) จึง save ก่อนทุกครั้ง เพื่อให้ PDF ตรงกับที่เห็นบนหน้าจอและรูป Pending ถูกอัปโหลดแล้ว
  exportToPdf(): void {
    if (this.isSaving || !this.customerId) return;
    this.exportAfterSave = true;
    this.saveReport();
  }
}

// input: สตริงจากช่องกรอก / output: null ถ้าว่างหรือเป็นช่องว่างล้วน ไม่งั้นข้อความเดิมตัดช่องว่างหัวท้าย
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

// input: Date จาก date picker / output: 'YYYY-MM-DD' ตามเวลาท้องถิ่น (ไม่ใช้ toISOString เพราะแปลงเป็น UTC แล้ววันที่อาจเลื่อน 1 วัน)
function formatDateOnly(date: Date | null): string | null {
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// input: 'YYYY-MM-DD' (หรือ ISO ที่ขึ้นต้นด้วยวันที่) / output: Date เที่ยงคืนตามเวลาท้องถิ่น กันเลื่อนวันเหมือน new Date('YYYY-MM-DD') ที่ตีเป็น UTC
function parseDateOnly(value: string | null): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// input: 400 จาก backend (class-validator คืน message เป็น string[]) / output: ข้อความสั้นๆ ให้ผู้ใช้อ่านรู้เรื่อง
function describeBadRequest(err: HttpErrorResponse): string {
  const message: unknown = err.error?.message;
  if (Array.isArray(message)) return message.slice(0, 3).join('; ');
  return typeof message === 'string' ? message : 'please check the form';
}
