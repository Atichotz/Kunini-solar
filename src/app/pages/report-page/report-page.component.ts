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
import { SelectChangeEvent, SelectModule } from 'primeng/select';
import { catchError, concatMap, forkJoin, from, map, of, toArray } from 'rxjs';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
import { CustomerService } from '../../services/customer.service';
import { EquipmentService, InverterItem, PanelItem } from '../../services/equipment.service';
import { InstallationReportService } from '../../services/installation-report.service';
import { PermissionService } from '../../services/permission.service';
import { REPORT_MAINTENANCE_HINT, REPORT_WARRANTY_TERMS } from './report-warranty';
import {
  INSTALLATION_PHOTO_SLOTS,
  type InstallationCheckGroup,
  type InstallationCheckItem,
  type InstallationComponentItem,
  type InstallationPhotoSlot,
  type InstallationReportDetail,
  type InstallationReportPhoto,
  type InstallationSerialGroup,
  type SaveInstallationReportPayload,
} from '../../dto/installation-report.dto';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

type PhotoSlot = InstallationPhotoSlot;
type SerialGroup = InstallationSerialGroup;

interface EquipmentItem {
  id: string;
  qty: string;
  name: string;
  detail: string;
}

interface SerialEntry {
  id: string;
  value: string;
}

interface DcStringRow {
  id: string;
  mppt: string;
  stringNo: string;
  panelsPerString: number | null;
  vocNominal: string;
  vdcReading: string;
  ampReading: string;
  time: string;
}

interface AcPhaseRow {
  id: string;
  phase: string;
  ampReading: string;
  voltageReading: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

// แถว checklist ที่มี checkbox + ช่องกรอกค่า (Permits / Backup Loads / Load) — label คือคำถามที่ช่างต้องเติมค่า
interface ValueCheckItem {
  id: string;
  label: string;
  checked: boolean;
  value: string;
}

type ProductCatalog = 'panel' | 'inverter';

// แถวที่เลือกค่าจาก catalog สินค้าแทนการพิมพ์เอง — brand เลือกก่อน แล้ว spec (description) filter ตาม brand ของ section เดียวกัน
interface ProductLookup {
  catalog: ProductCatalog;
  field: 'brand' | 'spec';
}

// แถวในตาราง Installer Comments — description fix ไว้ ช่างกรอกเฉพาะ value (text/select) หรือติ๊ก checked (check)
// options เก็บเป็น array ที่ reuse ได้ ไม่ใช้ getter ใน template (getter คืน array ใหม่ทุก CD → p-select วนไม่จบ)
interface InstallerRow {
  id: string;
  description: string;
  inputType: 'text' | 'check';
  lookup: ProductLookup | null;
  options: string[];
  value: string;
  checked: boolean;
}

interface InstallerSection {
  id: string;
  section: string;
  component: string;
  rows: InstallerRow[];
}

// รูปในฟอร์ม 2 แบบ: staged (มี file, previewUrl เป็น blob URL — อัปโหลดตอนกด Save) กับ saved (มี serverId, previewUrl เป็น signed URL)
interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string;
  file?: File;
  serverId?: string;
}

// โครงแถว Installer Comments ที่ seed ให้ฟอร์มใหม่ — ใช้ตอนโหลด report เดิมด้วย เพื่อใส่ lookup (brand/spec จาก catalog) กลับให้แถวที่ตรง section + description
// lookup ไม่ถูกเก็บใน DB เพราะเป็นพฤติกรรมของ UI ไม่ใช่ข้อมูลของ report
interface InstallerTemplateSection {
  section: string;
  component: string;
  descriptions: string[];
  inputType: InstallerRow['inputType'];
  lookups: Record<number, ProductLookup>;
}

const INSTALLER_TEMPLATE: InstallerTemplateSection[] = [
  {
    section: 'A',
    component: 'Solar PV Modules',
    descriptions: [
      'Solar PV Modules Brand',
      'Solar PV Modules Spec',
      'Number of Modules Installed',
      'Solar PV Racking Brand',
      'Solar PV Racking Spec',
      'Solar PV Racking Installed Capacity',
    ],
    inputType: 'text',
    lookups: { 0: { catalog: 'panel', field: 'brand' }, 1: { catalog: 'panel', field: 'spec' } },
  },
  {
    section: 'B',
    component: 'Solar PV Inverter',
    descriptions: ['Solar Inverter Brand', 'Solar Inverter Spec', 'Number of Inverters Installed'],
    inputType: 'text',
    lookups: { 0: { catalog: 'inverter', field: 'brand' }, 1: { catalog: 'inverter', field: 'spec' } },
  },
  {
    section: 'C',
    component: 'Solar PV Monitoring',
    descriptions: ['Monitoring Device / Smart Meter', 'Monitoring Device / Smart Meter Spec', 'Comms - WiFi or LAN'],
    inputType: 'text',
    lookups: {},
  },
  {
    section: 'D',
    component: 'Solar PV Combiner Boxes',
    descriptions: ['Solar PV Combiner Box Details'],
    inputType: 'text',
    lookups: {},
  },
  {
    section: 'E',
    component: 'Means of Isolation',
    descriptions: [
      'Details of Isolation Device (DC)',
      'Location of Isolation Device (DC)',
      'Details of Isolation Device (AC)',
      'Location of Isolation Device (AC)',
    ],
    inputType: 'text',
    lookups: {},
  },
  {
    section: 'F',
    component: 'Earthing of Solar PV System',
    descriptions: [
      'Check earthing cable conditions',
      'Check the physical earthing connection',
      'Check continuity of the cable to electrical earth',
    ],
    inputType: 'check',
    lookups: {},
  },
  {
    section: 'G',
    component: 'Bonding of the exposed metallic structure of the Solar PV System',
    descriptions: ['Check bonding cable condition', 'Check physical bonding connection'],
    inputType: 'check',
    lookups: {},
  },
];

const COMMISSIONING_LABELS = [
  'Visual Inspection of the System and PV Array',
  "Check CT's + All Cables (PV + Power)",
  'Check Phase Sequence',
  'Check Grounding',
  'Clean Solar Inverter, Combiner Box & Equipment',
  'Clean Solar Panels',
  'Test the Solar App + Internet Connection',
  'Test Backup Loads (Hybrid) - power off utility 10 mins',
  'Test ATS (Hybrid) - shut down solar inverter',
];

const PERMIT_LABELS = [
  'PEA/MEA Meter Rating (A) + 3P or 1P',
  'Main Cable Size + Type',
  'DB or CU + Number of Ways',
  'Main MCCB or MCB Rating (A)',
  'MCB/CB to Combiner - Rating (A), Cable Size + Type, Location in DB or CU',
];

const BACKUP_LOAD_LABELS = ['CU #Ways', 'Main MCB Rating', 'Main MCB 2P or 3P'];

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

@Component({
  selector: 'app-report-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    ConfirmDialogModule,
    DatePickerModule,
    ImageModule,
    SelectModule,
    KLoadingComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './report-page.component.html',
  styleUrl: './report-page.component.scss',
})
export class ReportPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customerService = inject(CustomerService);
  private readonly equipmentService = inject(EquipmentService);
  private readonly reportService = inject(InstallationReportService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly permission = inject(PermissionService);
  readonly canEditDocuments = this.permission.canEditDocuments;
  readonly warrantyTerms = REPORT_WARRANTY_TERMS;
  readonly maintenanceHint = REPORT_MAINTENANCE_HINT;

  private panels: PanelItem[] = [];
  private inverters: InverterItem[] = [];

  // customer id จาก query param — Report ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน sow-page)
  customerId: string | null = null;

  // report id จาก query param — ไม่มี = report ใหม่ (สร้างตอนกด Save ครั้งแรก แล้ว URL จะถูกเติม reportId)
  reportId: string | null = null;

  isLoadingCustomer = false;
  isLoadingReport = false;
  loadErrorMessage = '';

  // ===== สถานะการบันทึก =====
  isSaving = false;
  saveNotice = '';
  saveErrorMessage = '';
  // true เมื่อ PUT โดน 409 (มีคนอื่น save ไปก่อน) — โชว์ปุ่ม Reload latest
  isConflict = false;
  photoErrorMessage = '';
  // true ระหว่างที่กด Export แล้วรอ save จบ — finishSave จะพาไปหน้า PDF แทนการถามว่าจะกลับหน้า customer ไหม
  private exportAfterSave = false;
  // serverId ของรูปที่กำลังลบอยู่ — กันกดซ้ำและใช้ disable ปุ่มลบ
  removingPhotoId: string | null = null;

  // ===== meta จาก server =====
  // savedAt = token ส่งกลับเป็น expected_saved_at ตอน PUT (เปลี่ยนเฉพาะตอน save ฟอร์ม)
  // updatedAt/updatedBy = ใครแก้ล่าสุด รวมการแก้รูป — ใช้โชว์อย่างเดียว ห้ามเอาไปแทน savedAt
  private savedAt: string | null = null;
  createdAt: string | null = null;
  createdBy: string | null = null;
  updatedAt: string | null = null;
  updatedBy: string | null = null;

  customerName = '';
  address = '';
  completionDate: Date | null = null;
  technician = '';
  weatherConditions = '';

  systemType = '';
  totalDcCapacity = '';
  acOutput = '';

  arrayDetails: EquipmentItem[] = [];
  powerStorageItems: EquipmentItem[] = [];

  installerSections: InstallerSection[] = [];

  dcStrings: DcStringRow[] = [];
  totalPvPanels: number | null = null;
  dcFuseSpecs = '';
  dcSurgeSpecs = '';
  dcInputWatts = '';

  acPhases: AcPhaseRow[] = [];
  acSurgeSpecs = '';
  totalAmps = '';

  checklist: ChecklistItem[] = [];
  technicianNotes = '';

  permitChecklist: ValueCheckItem[] = [];
  backupLoadChecklist: ValueCheckItem[] = [];
  loadChecklist: ValueCheckItem[] = [];

  inverterSerials: SerialEntry[] = [];
  batterySerials: SerialEntry[] = [];
  panelSerials: SerialEntry[] = [];
  optimizerSerials: SerialEntry[] = [];

  sldPhotos: PhotoItem[] = [];
  roofPhotos: PhotoItem[] = [];
  equipmentPhotos: PhotoItem[] = [];

  nextMaintenanceDate: Date | null = null;

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

    this.loadProductCatalogs();

    if (this.reportId) {
      this.loadExistingReport(this.reportId);
      return;
    }

    this.loadCustomer(this.customerId);
    this.seedDefaults();
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

  private revokeAllStagedPreviews(): void {
    for (const photo of [...this.sldPhotos, ...this.roofPhotos, ...this.equipmentPhotos]) this.revokeIfStaged(photo);
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
        console.error('[API] Failed to load customer for Report:', err);
        // โหลด customer ไม่ได้ (เช่น id ผิด) — ยังเปิดหน้าได้ แค่ปล่อยชื่อ/ที่อยู่ให้กรอกเอง
        this.isLoadingCustomer = false;
      },
    });
  }

  private seedDefaults(): void {
    this.arrayDetails = [{ id: nextId('arr'), qty: '', name: '', detail: '' }];
    this.powerStorageItems = [{ id: nextId('pwr'), qty: '', name: '', detail: '' }];
    this.inverterSerials = [{ id: nextId('sn'), value: '' }];
    this.batterySerials = [{ id: nextId('sn'), value: '' }];
    this.panelSerials = [{ id: nextId('sn'), value: '' }];
    this.optimizerSerials = [{ id: nextId('sn'), value: '' }];
    this.installerSections = INSTALLER_TEMPLATE.map((t) => this.buildInstallerSection(t));
    this.dcStrings = [this.newDcStringRow(), this.newDcStringRow()];
    this.acPhases = [
      { id: nextId('ac'), phase: 'L1', ampReading: '', voltageReading: '' },
      { id: nextId('ac'), phase: 'L2', ampReading: '', voltageReading: '' },
      { id: nextId('ac'), phase: 'L3', ampReading: '', voltageReading: '' },
    ];
    this.checklist = COMMISSIONING_LABELS.map((label) => ({ id: nextId('chk'), label, checked: false }));
    this.permitChecklist = this.buildValueChecklist('permit', PERMIT_LABELS);
    this.backupLoadChecklist = this.buildValueChecklist('backup', BACKUP_LOAD_LABELS);
    this.loadChecklist = this.buildValueChecklist('load', ['Ct.1']);
  }

  // รับ: โครง section จาก INSTALLER_TEMPLATE
  // คืน: section ที่แถวยังว่างทั้งหมด (lookup ผูกตาม index แถวใน template)
  private buildInstallerSection(template: InstallerTemplateSection): InstallerSection {
    return {
      id: nextId('inst'),
      section: template.section,
      component: template.component,
      rows: template.descriptions.map((description, index) => ({
        id: nextId('instrow'),
        description,
        inputType: template.inputType,
        lookup: template.lookups[index] ?? null,
        options: [],
        value: '',
        checked: false,
      })),
    };
  }

  // ===== โหลด report เดิม =====

  // input: report UUID — report จะ override ทุก field ในฟอร์ม (รวมชื่อ/ที่อยู่ลูกค้าที่เป็น snapshot ตอน save) — ไม่โหลด customer ซ้ำ และไม่ seed ค่าเริ่มต้น
  private loadExistingReport(id: string): void {
    this.isLoadingReport = true;
    this.loadErrorMessage = '';

    this.reportService
      .getOne(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.applyReportToForm(report);
          this.isLoadingReport = false;
        },
        error: (err: HttpErrorResponse) => {
          console.error('[API] Failed to load installation report:', err);
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

  // input: report จาก server / output: เขียนทุก field ในฟอร์มทับ + รูป + meta
  // ใช้ตอนโหลดครั้งแรกและ reload เท่านั้น — ห้ามเรียกหลัง save เพราะจะทับสิ่งที่ผู้ใช้พิมพ์ต่อระหว่างอัปโหลดรูป
  private applyReportToForm(r: InstallationReportDetail): void {
    this.customerId = r.customerId;
    this.customerName = r.customerName ?? '';
    this.address = r.address ?? '';
    this.completionDate = parseDateOnly(r.completionDate);
    this.technician = r.technician ?? '';
    this.weatherConditions = r.weatherConditions ?? '';

    this.systemType = r.systemType ?? '';
    this.totalDcCapacity = r.totalDcCapacity ?? '';
    this.acOutput = r.acOutput ?? '';

    this.arrayDetails = r.arrayDetails.map((c) => this.toEquipmentItem('arr', c));
    this.powerStorageItems = r.powerStorageItems.map((c) => this.toEquipmentItem('pwr', c));
    this.installerSections = this.buildInstallerSectionsFromSaved(r.installerRows);

    this.dcStrings = r.dcStrings.map((s) => ({
      id: nextId('dc'),
      mppt: s.mppt ?? '',
      stringNo: s.stringNo ?? '',
      panelsPerString: s.panelsPerString,
      vocNominal: s.vocNominal ?? '',
      vdcReading: s.vdcReading ?? '',
      ampReading: s.ampReading ?? '',
      time: s.readingTime ?? '',
    }));
    this.totalPvPanels = r.totalPvPanels;
    this.dcFuseSpecs = r.dcFuseSpecs ?? '';
    this.dcSurgeSpecs = r.dcSurgeSpecs ?? '';
    this.dcInputWatts = r.dcInputWatts ?? '';

    this.acPhases = r.acPhases.map((p) => ({
      id: nextId('ac'),
      phase: p.phase ?? '',
      ampReading: p.ampReading ?? '',
      voltageReading: p.voltageReading ?? '',
    }));
    this.acSurgeSpecs = r.acSurgeSpecs ?? '';
    this.totalAmps = r.totalAmps ?? '';

    this.checklist = r.commissioningChecklist.map((c) => ({ id: nextId('chk'), label: c.label, checked: c.checked }));
    this.technicianNotes = r.technicianNotes ?? '';

    this.permitChecklist = this.toValueChecklist('permit', r.permitChecklist);
    this.backupLoadChecklist = this.toValueChecklist('backup', r.backupLoadChecklist);
    // Load ต้องมีอย่างน้อย 1 แถวเสมอ (ปุ่มลบซ่อนเมื่อเหลือแถวเดียว) — report เก่าที่ไม่มีแถวเลยให้เริ่มที่ Ct.1
    this.loadChecklist =
      r.loadChecklist.length > 0 ? this.toValueChecklist('load', r.loadChecklist) : this.buildValueChecklist('load', ['Ct.1']);

    this.inverterSerials = this.toSerialEntries(r.serials.inverter);
    this.batterySerials = this.toSerialEntries(r.serials.battery);
    this.panelSerials = this.toSerialEntries(r.serials.panel);
    this.optimizerSerials = this.toSerialEntries(r.serials.optimizer);

    this.revokeAllStagedPreviews();
    this.sldPhotos = r.photosBySlot.sld.map((p) => this.toSavedPhotoItem(p));
    this.roofPhotos = r.photosBySlot.roof.map((p) => this.toSavedPhotoItem(p));
    this.equipmentPhotos = r.photosBySlot.equipment.map((p) => this.toSavedPhotoItem(p));

    this.nextMaintenanceDate = parseDateOnly(r.nextMaintenanceDate);

    this.applyMeta(r);
    this.refreshLookupOptions();
  }

  private applyMeta(r: InstallationReportDetail): void {
    this.reportId = r.id;
    this.savedAt = r.savedAt;
    this.createdAt = r.createdAt;
    this.createdBy = r.createdBy;
    this.updatedAt = r.updatedAt;
    this.updatedBy = r.updatedBy;
  }

  private toEquipmentItem(prefix: string, c: InstallationComponentItem): EquipmentItem {
    return { id: nextId(prefix), qty: c.qty ?? '', name: c.name ?? '', detail: c.detail ?? '' };
  }

  private toValueChecklist(prefix: string, items: InstallationCheckItem[]): ValueCheckItem[] {
    return items.map((c) => ({ id: nextId(prefix), label: c.label, checked: c.checked, value: c.value ?? '' }));
  }

  // ช่อง SN: ไม่มีค่าที่บันทึกไว้ → โชว์ช่องว่าง 1 ช่องให้กรอก (เหมือนฟอร์มใหม่) — ช่องว่างไม่ถูกเก็บลง DB
  private toSerialEntries(values: string[]): SerialEntry[] {
    const entries = values.map((value) => ({ id: nextId('sn'), value }));
    return entries.length > 0 ? entries : [{ id: nextId('sn'), value: '' }];
  }

  // input: แถว Installer Comments ที่บันทึกไว้ (เรียงต่อกันทุก section) / output: section แยกตามตัวอักษร เรียงตามลำดับที่เจอ
  // ใช้ข้อความ section/component/description ที่บันทึกไว้เป็นหลัก — lookup (dropdown brand/spec) ใส่กลับเฉพาะแถวที่ตรงกับ template ทั้ง section + description
  // ทำไมไม่เติมแถวใหม่จาก template: report ที่บันทึกไว้ต้องแสดงตามที่บันทึกจริง ไม่งอกแถวที่ช่างไม่เคยเห็น
  private buildInstallerSectionsFromSaved(rows: InstallationReportDetail['installerRows']): InstallerSection[] {
    const sections: InstallerSection[] = [];
    for (const saved of rows) {
      let section = sections.find((s) => s.section === saved.section);
      if (!section) {
        section = { id: nextId('inst'), section: saved.section, component: saved.component, rows: [] };
        sections.push(section);
      }
      const template = INSTALLER_TEMPLATE.find((t) => t.section === saved.section);
      const templateIndex = template ? template.descriptions.indexOf(saved.description) : -1;
      section.rows.push({
        id: nextId('instrow'),
        description: saved.description,
        inputType: saved.inputType,
        lookup: template && templateIndex >= 0 ? (template.lookups[templateIndex] ?? null) : null,
        options: [],
        value: saved.value ?? '',
        checked: saved.checked,
      });
    }
    return sections;
  }

  // ===== Installer Comments — brand/spec จาก catalog สินค้า =====

  // ทำไม catchError → []: catalog โหลดไม่ได้ต้องไม่ทำให้ทั้งหน้าพัง dropdown แค่ว่าง (ช่างยังกรอกส่วนอื่นได้)
  private loadProductCatalogs(): void {
    forkJoin({
      panels: this.equipmentService.getPanels().pipe(
        catchError((err) => {
          console.error('[API] Failed to load panels for Report:', err);
          return of<PanelItem[]>([]);
        }),
      ),
      inverters: this.equipmentService.getInverters().pipe(
        catchError((err) => {
          console.error('[API] Failed to load inverters for Report:', err);
          return of<InverterItem[]>([]);
        }),
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ panels, inverters }) => {
        this.panels = panels;
        this.inverters = inverters;
        this.refreshLookupOptions();
      });
  }

  // brand เปลี่ยน → spec เดิมอาจไม่ใช่ของ brand ใหม่ ต้องล้างทิ้งก่อนคำนวณ options ใหม่
  onInstallerLookupChange(section: InstallerSection, row: InstallerRow, event: SelectChangeEvent): void {
    row.value = event.value ?? '';
    if (row.lookup?.field === 'brand') {
      const specRow = this.findLookupRow(section, row.lookup.catalog, 'spec');
      if (specRow) specRow.value = '';
    }
    this.refreshLookupOptions();
  }

  // spec ยังเลือกไม่ได้จนกว่าจะเลือก brand ของ section เดียวกัน
  isInstallerLookupDisabled(section: InstallerSection, row: InstallerRow): boolean {
    if (row.lookup?.field !== 'spec') return false;
    return !this.findLookupRow(section, row.lookup.catalog, 'brand')?.value;
  }

  private findLookupRow(
    section: InstallerSection,
    catalog: ProductCatalog,
    field: ProductLookup['field'],
  ): InstallerRow | undefined {
    return section.rows.find((r) => r.lookup?.catalog === catalog && r.lookup.field === field);
  }

  private catalogItems(catalog: ProductCatalog): { brand: string; description: string }[] {
    return catalog === 'panel' ? this.panels : this.inverters;
  }

  // สร้าง options ใหม่เป็น array ใหม่เฉพาะตอนข้อมูลเปลี่ยน (โหลด catalog / เปลี่ยน brand) — ไม่คำนวณใน template
  private refreshLookupOptions(): void {
    for (const section of this.installerSections) {
      for (const row of section.rows) {
        if (!row.lookup) continue;
        const items = this.catalogItems(row.lookup.catalog);
        if (row.lookup.field === 'brand') {
          row.options = Array.from(new Set(items.map((i) => i.brand))).sort();
        } else {
          const brand = this.findLookupRow(section, row.lookup.catalog, 'brand')?.value;
          row.options = brand
            ? Array.from(new Set(items.filter((i) => i.brand === brand).map((i) => i.description))).sort()
            : [];
        }
        // ค่าที่บันทึกไว้แต่ไม่อยู่ใน catalog แล้ว (สินค้าถูกลบ/เปลี่ยนชื่อ หรือ catalog โหลดไม่สำเร็จ) ต้องยังแสดง/ส่งกลับได้ ไม่งั้น p-select โชว์ว่างแล้ว save ทับค่าเดิมหาย
        if (row.value && !row.options.includes(row.value)) row.options = [...row.options, row.value];
      }
    }
  }

  // รับ: prefix สำหรับ id + รายการ label / คืน: แถว checklist ว่าง (ยังไม่ติ๊ก ยังไม่กรอกค่า)
  private buildValueChecklist(prefix: string, labels: string[]): ValueCheckItem[] {
    return labels.map((label) => ({ id: nextId(prefix), label, checked: false, value: '' }));
  }

  // ===== Load (Ct. rows) =====

  addLoadItem(): void {
    this.loadChecklist.push({
      id: nextId('load'),
      label: `Ct.${this.loadChecklist.length + 1}`,
      checked: false,
      value: '',
    });
  }

  // ลบแล้วรันเลข Ct. ใหม่ตามลำดับ กัน label ซ้ำ/ข้ามเลขตอนกด add ต่อ (เช่น ลบ Ct.2 จาก 3 แถว แล้ว add จะได้ Ct.3 ซ้ำ)
  removeLoadItem(item: ValueCheckItem): void {
    this.loadChecklist = this.loadChecklist
      .filter((i) => i.id !== item.id)
      .map((i, index) => ({ ...i, label: `Ct.${index + 1}` }));
  }

  // ===== System configuration (Solar Array / Power & Storage) =====

  addArrayItem(): void {
    this.arrayDetails.push({ id: nextId('arr'), qty: '', name: '', detail: '' });
  }

  removeArrayItem(item: EquipmentItem): void {
    this.arrayDetails = this.arrayDetails.filter((i) => i.id !== item.id);
  }

  addPowerStorageItem(): void {
    this.powerStorageItems.push({ id: nextId('pwr'), qty: '', name: '', detail: '' });
  }

  removePowerStorageItem(item: EquipmentItem): void {
    this.powerStorageItems = this.powerStorageItems.filter((i) => i.id !== item.id);
  }

  // ===== DC string measurements =====

  private newDcStringRow(): DcStringRow {
    return {
      id: nextId('dc'),
      mppt: '',
      stringNo: '',
      panelsPerString: null,
      vocNominal: '',
      vdcReading: '',
      ampReading: '',
      time: '',
    };
  }

  addDcString(): void {
    this.dcStrings.push(this.newDcStringRow());
  }

  removeDcString(row: DcStringRow): void {
    this.dcStrings = this.dcStrings.filter((r) => r.id !== row.id);
  }

  // ===== AC phase measurements =====

  addAcPhase(): void {
    this.acPhases.push({ id: nextId('ac'), phase: '', ampReading: '', voltageReading: '' });
  }

  removeAcPhase(row: AcPhaseRow): void {
    this.acPhases = this.acPhases.filter((r) => r.id !== row.id);
  }

  // ===== Serial numbers =====

  addSerial(group: SerialGroup): void {
    this.serialsFor(group).push({ id: nextId('sn'), value: '' });
  }

  removeSerial(group: SerialGroup, entry: SerialEntry): void {
    this.setSerialsFor(
      group,
      this.serialsFor(group).filter((e) => e.id !== entry.id),
    );
  }

  serialsFor(group: SerialGroup): SerialEntry[] {
    if (group === 'inverter') return this.inverterSerials;
    if (group === 'battery') return this.batterySerials;
    if (group === 'panel') return this.panelSerials;
    return this.optimizerSerials;
  }

  private setSerialsFor(group: SerialGroup, entries: SerialEntry[]): void {
    if (group === 'inverter') this.inverterSerials = entries;
    else if (group === 'battery') this.batterySerials = entries;
    else if (group === 'panel') this.panelSerials = entries;
    else this.optimizerSerials = entries;
  }

  // ===== Photos (slot-based: เลือกแล้วค้างไว้ก่อน อัปโหลดตอนกด Save) =====

  onPhotoFilesSelected(slot: PhotoSlot, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    this.stagePhotos(slot, files);
  }

  onPhotoDrop(slot: PhotoSlot, event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    this.stagePhotos(slot, files);
  }

  // ไฟล์ที่ไม่ใช่ JPEG/PNG/WebP หรือใหญ่เกิน 10MB ถูกข้าม (แจ้งชื่อไฟล์ที่ข้าม) — backend เช็คซ้ำอีกชั้น
  private stagePhotos(slot: PhotoSlot, files: File[]): void {
    if (this.isSaving || !this.canEditDocuments()) return;
    const target = this.photosFor(slot);
    const rejected: string[] = [];
    for (const file of files) {
      if (!PHOTO_ACCEPTED_TYPES.includes(file.type) || file.size > PHOTO_MAX_SIZE_BYTES) {
        rejected.push(file.name);
        continue;
      }
      target.push({ id: nextId('photo'), file, name: file.name, previewUrl: URL.createObjectURL(file) });
    }
    this.photoErrorMessage = rejected.length > 0 ? `Skipped (JPEG/PNG/WebP up to 10MB only): ${rejected.join(', ')}` : '';
  }

  // รูปที่ยังไม่อัปโหลด → ลบในเครื่องทันที / รูปที่ save แล้ว → ถามยืนยันก่อน แล้วลบที่ server ทันที (soft delete)
  removePhoto(slot: PhotoSlot, photo: PhotoItem): void {
    if (this.isSaving || !this.canEditDocuments()) return;

    if (!photo.serverId) {
      this.revokeIfStaged(photo);
      this.setPhotosFor(
        slot,
        this.photosFor(slot).filter((p) => p.id !== photo.id),
      );
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
              this.setPhotosFor(
                slot,
                this.photosFor(slot).filter((p) => p.serverId !== photoId),
              );
            },
            error: (err: HttpErrorResponse) => {
              this.removingPhotoId = null;
              // 404 = รูปถูกลบไปแล้ว (อีก tab/คนอื่น) — เอาออกจากหน้าจอเลย ไม่ต้องแจ้งว่าพลาด
              if (err.status === 404) {
                this.setPhotosFor(
                  slot,
                  this.photosFor(slot).filter((p) => p.serverId !== photoId),
                );
                return;
              }
              console.error('[API] Failed to delete installation report photo:', err);
              this.photoErrorMessage = 'Failed to delete the photo. Please try again';
            },
          });
      },
    });
  }

  isPhotoRemoving(photo: PhotoItem): boolean {
    return photo.serverId !== undefined && this.removingPhotoId === photo.serverId;
  }

  photosFor(slot: PhotoSlot): PhotoItem[] {
    if (slot === 'sld') return this.sldPhotos;
    if (slot === 'roof') return this.roofPhotos;
    return this.equipmentPhotos;
  }

  private setPhotosFor(slot: PhotoSlot, photos: PhotoItem[]): void {
    if (slot === 'sld') this.sldPhotos = photos;
    else if (slot === 'roof') this.roofPhotos = photos;
    else this.equipmentPhotos = photos;
  }

  private toSavedPhotoItem(photo: InstallationReportPhoto): PhotoItem {
    return { id: `saved-${photo.id}`, serverId: photo.id, name: photo.fileName, previewUrl: photo.url };
  }

  // ===== Save =====

  private clearStatusMessages(): void {
    this.saveNotice = '';
    this.saveErrorMessage = '';
    this.isConflict = false;
    this.photoErrorMessage = '';
  }

  // output: payload ที่ประกอบทีละ field — ไม่ spread object ฝั่ง client เพราะ backend (forbidNonWhitelisted) ปฏิเสธ field แปลกปลอม
  // สตริงว่าง → null เพื่อให้ตรงกับ "ยังไม่กรอก" และไม่ติด validator ของ field วันที่
  // ตารางลูก: แถวที่ไม่มีข้อมูลอะไรเลย (ช่างเพิ่มแถวแล้วไม่กรอก) ยังส่งไป ยกเว้น SN ที่ว่างเพราะ DB ไม่เก็บ SN ว่าง
  private buildPayload(customerId: string): SaveInstallationReportPayload {
    return {
      customer_id: customerId,
      ...(this.reportId && this.savedAt ? { expected_saved_at: this.savedAt } : {}),
      head: {
        customer_name: blankToNull(this.customerName),
        address: blankToNull(this.address),
        completion_date: formatDateOnly(this.completionDate),
        technician: blankToNull(this.technician),
        weather_conditions: blankToNull(this.weatherConditions),

        system_type: blankToNull(this.systemType),
        total_dc_capacity: blankToNull(this.totalDcCapacity),
        ac_output: blankToNull(this.acOutput),

        total_pv_panels: toNullableInt(this.totalPvPanels),
        dc_fuse_specs: blankToNull(this.dcFuseSpecs),
        dc_surge_specs: blankToNull(this.dcSurgeSpecs),
        dc_input_watts: blankToNull(this.dcInputWatts),
        ac_surge_specs: blankToNull(this.acSurgeSpecs),
        total_amps: blankToNull(this.totalAmps),
        technician_notes: blankToNull(this.technicianNotes),

        next_maintenance_date: formatDateOnly(this.nextMaintenanceDate),
      },
      components: [
        ...this.arrayDetails.map((i) => ({
          group_key: 'array' as const,
          qty: blankToNull(i.qty),
          name: blankToNull(i.name),
          detail: blankToNull(i.detail),
        })),
        ...this.powerStorageItems.map((i) => ({
          group_key: 'powerStorage' as const,
          qty: blankToNull(i.qty),
          name: blankToNull(i.name),
          detail: blankToNull(i.detail),
        })),
      ],
      installer_rows: this.installerSections.flatMap((section) =>
        section.rows.map((row) => ({
          section: section.section,
          component: section.component,
          description: row.description,
          input_type: row.inputType,
          value: blankToNull(row.value),
          checked: row.checked,
        })),
      ),
      dc_strings: this.dcStrings.map((row) => ({
        mppt: blankToNull(row.mppt),
        string_no: blankToNull(row.stringNo),
        // ช่อง type=number ที่ผู้ใช้ลบจนว่างจะได้ '' หรือ null ขึ้นกับ browser — ทั้งคู่ต้องเป็น null (backend ต้องการ int)
        panels_per_string: toNullableInt(row.panelsPerString),
        voc_nominal: blankToNull(row.vocNominal),
        vdc_reading: blankToNull(row.vdcReading),
        amp_reading: blankToNull(row.ampReading),
        reading_time: blankToNull(row.time),
      })),
      ac_phases: this.acPhases.map((row) => ({
        phase: blankToNull(row.phase),
        amp_reading: blankToNull(row.ampReading),
        voltage_reading: blankToNull(row.voltageReading),
      })),
      checks: [
        ...this.toCheckPayloads('commissioning', this.checklist),
        ...this.toCheckPayloads('permit', this.permitChecklist),
        ...this.toCheckPayloads('backup', this.backupLoadChecklist),
        ...this.toCheckPayloads('load', this.loadChecklist),
      ],
      serials: (['inverter', 'battery', 'panel', 'optimizer'] as const).flatMap((group) =>
        this.serialsFor(group).flatMap((entry) => {
          const value = blankToNull(entry.value);
          return value === null ? [] : [{ group_key: group, value }];
        }),
      ),
    };
  }

  private toCheckPayloads(group: InstallationCheckGroup, items: (ChecklistItem | ValueCheckItem)[]) {
    return items.map((item) => ({
      group_key: group,
      label: item.label,
      checked: item.checked,
      // Commissioning ไม่มีช่องค่า (ChecklistItem ไม่มี value)
      value: 'value' in item ? blankToNull(item.value) : null,
    }));
  }

  // กด Save: บันทึกฟอร์ม (POST ถ้ายังไม่มี report, ไม่งั้น PUT) → อัปโหลดรูปที่ค้างอยู่ทีละรูป
  saveReport(): void {
    if (!this.canEditDocuments()) return;
    if (this.isSaving || !this.customerId) return;

    this.clearStatusMessages();

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

  private onFormSaved(saved: InstallationReportDetail): void {
    const wasNew = !this.reportId;
    this.applyMeta(saved);
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
  private mergeSavedPhotos(saved: InstallationReportDetail): void {
    for (const slot of INSTALLATION_PHOTO_SLOTS) {
      const staged = this.photosFor(slot).filter((p) => p.file);
      this.setPhotosFor(slot, [...saved.photosBySlot[slot].map((p) => this.toSavedPhotoItem(p)), ...staged]);
    }
  }

  // อัปโหลดรูปที่ค้างอยู่ทีละรูป (ไม่ขนาน) — รูปไหนพลาดยังค้างไว้ให้กด Save ใหม่ ไม่ทำให้รูปอื่นหรือการบันทึกฟอร์มเสียไป
  private uploadStagedPhotos(reportId: string, wasNew: boolean): void {
    const tasks = INSTALLATION_PHOTO_SLOTS.flatMap((slot) =>
      this.photosFor(slot)
        .filter((p) => p.file)
        .map((photo) => ({ slot, photo })),
    );

    if (tasks.length === 0) {
      this.finishSave([], wasNew);
      return;
    }

    from(tasks)
      .pipe(
        concatMap(({ slot, photo }) =>
          this.reportService.uploadPhoto(reportId, photo.file as File, slot).pipe(
            map((result) => {
              this.revokeIfStaged(photo);
              const savedItem = this.toSavedPhotoItem(result.photo);
              this.setPhotosFor(
                slot,
                this.photosFor(slot).map((p) => (p.id === photo.id ? savedItem : p)),
              );
              // ใช้เฉพาะ updatedAt/updatedBy ของผลอัปโหลดโชว์ "แก้ล่าสุด" — ไม่แตะ savedAt
              this.updatedAt = result.updatedAt;
              this.updatedBy = result.updatedBy;
              return null;
            }),
            catchError((err: HttpErrorResponse) => {
              console.error('[API] Failed to upload installation report photo:', err);
              return of(photo.name);
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
  //         แก้ของเดิมสำเร็จ → ถามว่าจะอยู่ต่อหรือกลับหน้า customer (เหมือน survey-report)
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
      // report ใหม่: replaceUrl ให้ history ไม่เหลือฟอร์มเปล่า (ไม่มี reportId) ที่กด Back กลับมาแล้ว Save จะได้ report ซ้ำ
      this.openPdfPreview(this.reportId, wasNew);
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
    console.error('[API] Failed to save installation report:', err);

    if (err.status === 409) {
      this.isConflict = true;
      this.saveErrorMessage =
        'This report was saved by someone else after you opened it. Nothing was overwritten. Reload the latest version before saving again';
    } else if (err.status === 404) {
      this.saveErrorMessage = 'This report no longer exists. It may have been deleted by someone else';
    } else if (err.status === 400) {
      this.saveErrorMessage = `Some values are not valid: ${describeBadRequest(err)}`;
    } else {
      this.saveErrorMessage = 'Failed to save the report. Please try again';
    }
  }

  // PDF พรีวิวดึงจากรายงานที่ save แล้ว (ไม่ใช่สถานะฟอร์มสด) จึง save ก่อนทุกครั้ง เพื่อให้ PDF ตรงกับที่เห็นบนหน้าจอและรูป Pending ถูกอัปโหลดแล้ว
  // ผู้ใช้ read-only (purchasing/sales) save ไม่ได้ — saveReport() จะ return เงียบๆ ทำให้ flag ค้าง จึงข้ามไปพรีวิวรายงานที่มีอยู่แล้วตรงๆ
  exportToPdf(): void {
    if (this.isSaving || !this.customerId) return;
    if (!this.canEditDocuments()) {
      if (this.reportId) this.openPdfPreview(this.reportId, false);
      return;
    }
    this.exportAfterSave = true;
    this.saveReport();
  }

  private openPdfPreview(reportId: string, replaceUrl: boolean): void {
    void this.router.navigate(['/report-pdf'], { queryParams: { reportId }, replaceUrl });
  }
}

// input: สตริงจากช่องกรอก / output: null ถ้าว่างหรือเป็นช่องว่างล้วน ไม่งั้นข้อความเดิมตัดช่องว่างหัวท้าย
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

// input: ค่าจากช่อง type=number (number, null หรือ '' เมื่อผู้ใช้ลบจนว่าง) / output: จำนวนเต็มหรือ null — ทศนิยมปัดลง กัน backend ปฏิเสธ (@IsInt)
function toNullableInt(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
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
