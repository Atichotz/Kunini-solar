import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MenuModule } from 'primeng/menu';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { forkJoin, of, map, distinctUntilChanged, takeUntil, skip } from 'rxjs';
import { CustomerService } from '../../services/customer.service';
import { EstimateService } from '../../services/estimate.service';
import { SurveyService } from '../../services/survey.service';
import { PermissionService } from '../../services/permission.service';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
import { TodoBoardComponent } from '../../todo-board/todo-board.component';
import { ScrollToTopComponent } from '../../scroll-to-top/scroll-to-top.component';
import { LinkifyPipe } from '../../pipes/linkify.pipe';
import type { CustomerDetail, ElectricBillDetail, NoteDetail, NoteCommentDetail, StatusOption, UpsertContactPayload } from '../../dto/customer.dto';
import type { EstimateDetail, EstimateSummary } from '../../dto/estimate.dto';
import type { SurveyHistoryItem } from '../../dto/survey.dto';

interface Contact {
  id: string;
  firstname: string;
  lastname: string;
  phone: string;
  email: string;
  type: 'Primary' | 'Secondary' | 'Other';
  isEditing: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  editSnapshot?: { firstname: string; lastname: string; phone: string; email: string };
}

type Note = NoteDetail;

interface SelectOption {
  label: string;
  value: string;
}

interface ElectricBillForm {
  billName: string;
  billAmount: number | null;
  caRefNo: string;
  installationNo: string;
  electricityUsageType: string | null;
  kwhPerMonth: number | null;
}

// ต้องตรงกับ NOTE_MAX_LENGTH / CUSTOMER_NAME_MAX_LENGTH ใน backend (dto/note.dto.ts, dto/update-customer-name.dto.ts)
const NOTE_MAX_LENGTH = 2000;
// ต้องตรงกับ NOTE_COMMENT_MAX_LENGTH ใน backend (dto/note-comment.dto.ts)
const NOTE_COMMENT_MAX_LENGTH = 2000;
const CUSTOMER_NAME_MAX_LENGTH = 100;
const CUSTOMER_NUMBER_MAX_LENGTH = 50;
const CUSTOMER_ADDRESS_MAX_LENGTH = 500;
const GOOGLE_MAPS_LINK_MAX_LENGTH = 2000;

// ค่าชุดเดียวกับที่ backend (UpdateCustomerDetailsDto) อนุญาต
const LOCATION_OPTIONS = ['Pattaya', 'Huahin', 'Bangkok', 'Up Country'] as const;
const PROJECT_TYPE_OPTIONS = ['Residential', 'Commercial', 'Upgrade'] as const;
const SYSTEM_TYPE_OPTIONS = ['On-Grid', 'Off-Grid', 'Hybrid'] as const;

// draft ของ Client Information — ฟิลด์ tag เป็น null ได้ (ลูกค้าเก่าที่ยังไม่เคยมีค่า) แต่ต้องเลือกก่อนบันทึก
interface CustomerInfoDraft {
  fullAddress: string;
  googleMapsLink: string;
  projectLocationName: string | null;
  typeOfCustomerName: string | null;
  typeOfSystemName: string | null;
}

const ELECTRIC_BILL_ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ELECTRIC_BILL_MAX_SIZE_BYTES = 10 * 1024 * 1024;

// ต้องตรงกับ NOTE_COMMENT_MAX_IMAGES / NOTE_COMMENT_IMAGE_ALLOWED_MIME_TYPES / NOTE_COMMENT_IMAGE_MAX_SIZE_BYTES ใน backend (customers.service.ts, dto/note-comment.dto.ts)
const NOTE_COMMENT_MAX_IMAGES = 5;
const NOTE_COMMENT_IMAGE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const NOTE_COMMENT_IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;

interface EstimateHistoryRow {
  id: string;
  title: string;
  badgeLabel: string;
  isDraft: boolean;
  dateIso: string;
  author: string;
  grandTotal: number | null;
}

interface SurveyHistoryRow {
  id: string;
  dateIso: string;
  author: string;
  photoCount: number;
  noteCount: number;
  wasUpdated: boolean;
}

// เพิ่ม field `kind` ให้ template แยกประเภทด้วย @if ได้โดยไม่ต้อง cast
type HistoryTimelineRow =
  | ({ kind: 'estimate' } & EstimateHistoryRow)
  | ({ kind: 'survey' } & SurveyHistoryRow);

// in: ISO date string → out: epoch ms (parse ไม่ได้คืน 0 เพราะ NaN ทำให้ sort ได้ลำดับไม่คงที่)
function toTimestamp(iso: string): number {
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

// สรุปตัวเลข "ระบบ" ของ estimate ใบเดียว หรือผลรวมของหลายใบ (0 → null เพื่อให้ template โชว์ "—" แทน "0 kWh")
interface SystemFigures {
  kwp: number | null;
  inverterKw: number | null;
  batteryKwh: number | null;
  systemPrice: number | null;
  typeOfSystemName: string | null;
}

@Component({
  selector: 'app-customer-detail-page',
  imports: [CommonModule, FormsModule, FloatLabelModule, InputTextModule, SelectModule, ConfirmDialogModule, MenuModule, RouterLink, KLoadingComponent, TodoBoardComponent, ScrollToTopComponent, LinkifyPipe],
  providers: [ConfirmationService],
  templateUrl: './customer-detail-page.component.html',
  styleUrl: './customer-detail-page.component.scss'
})
export class CustomerDetailPageComponent implements OnInit, OnDestroy {
  private readonly confirmationService = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly customerService = inject(CustomerService);
  private readonly estimateService = inject(EstimateService);
  private readonly surveyService = inject(SurveyService);
  // ใช้ซ่อนปุ่ม/ข้อมูลตาม role เพื่อ UX เท่านั้น — สิทธิ์จริงบังคับที่ backend
  private readonly permission = inject(PermissionService);
  readonly canManage = this.permission.canManage;
  readonly canCreateQuotation = this.permission.canCreateQuotation;
  readonly canSeePrice = this.permission.canSeePrice;
  readonly isCeo = this.permission.isCeo;
  private readonly destroyRef = inject(DestroyRef);

  // เมนูของปุ่ม Report — แยกไปหน้า Install report เดิม กับ Survey Report ใหม่
  // ต้องเป็น field ธรรมดา ไม่ใช่ getter — ถ้าเป็น getter จะสร้าง array ใหม่ทุกรอบ change detection
  // แล้ว [model] ของ p-menu เห็นว่า input เปลี่ยน reference ตลอด ทำให้วน re-process จนหน้าค้าง
  reportMenuItems: MenuItem[] = [];

  setReportMenuItems(): void {
    const customerId = this.customer?.id;
    this.reportMenuItems = [
      { label: 'Installation Report', icon: 'fa-solid fa-file-lines', routerLink: '/report', queryParams: { customerId } },
      { label: 'Site Survey Report', icon: 'fa-solid fa-people-roof', routerLink: '/survey-report', queryParams: { customerId } },
    ];
  }

  // emit ทุกครั้งที่ id ใน route เปลี่ยน (รวมถึงตอน Angular reuse component instance เดิมข้ามหน้า detail คนละคน)
  // ใช้เป็นทั้ง trigger โหลดข้อมูลใหม่ และ cancel-signal (takeUntil) ให้ request ของ id เก่าที่ยังค้างอยู่ไม่มาเขียนทับข้อมูลของ id ใหม่
  private readonly customerId$ = this.route.paramMap.pipe(
    map((params) => params.get('id')),
    distinctUntilChanged(),
  );

  // customerId$ replay ค่าปัจจุบันทันทีทุกครั้งที่ subscribe ใหม่ (route.paramMap เป็น BehaviorSubject)
  // ถ้าเอา customerId$ ไปใช้เป็น takeUntil ตรงๆ จะโดน cancel ตัวเองทันทีตั้งแต่ subscribe เพราะเห็น replay เป็น "id เปลี่ยน"
  // ต้อง skip(1) ค่า replay นั้นทิ้งก่อน ให้เหลือแต่ emission ตอน id เปลี่ยนจริงในอนาคต
  private readonly customerIdChanged$ = this.customerId$.pipe(skip(1));

  customer: CustomerDetail | null = null;
  // true จนกว่า customer หลักโหลดเสร็จ — ทั้งหน้า (contacts, ฟอร์มค่าไฟ, ปุ่ม) พึ่งข้อมูลนี้ จึงยังไม่ render ระหว่างรอ
  isLoading = true;
  customerLoadError = '';

  // list ย่อยโหลดแยกกันและเสร็จไม่พร้อมกัน — ใช้แสดง Loading… แทนข้อความ "No … yet" ที่จะโผล่ผิดจังหวะ
  isLoadingEstimates = true;
  isLoadingSurveys = true;
  isLoadingNotes = true;

  estimates: EstimateSummary[] = [];

  // System Details card — currentSystem = ผลรวมของ final ทุกใบ (ระบบสะสมของลูกค้า), pendingSystem = ผลรวมของ draft ทุกใบ (ยังไม่บวกเข้า current)
  currentSystem: SystemFigures | null = null;
  pendingSystem: SystemFigures | null = null;
  finalizedEstimateCount = 0;
  isLoadingSystem = true;
  systemErrorMessage = '';

  // id ของ estimate ที่กำลังกด Final หรือ Cancel Finalization อยู่ — กันกดซ้ำระหว่างรอ backend ตอบ
  finalizingEstimateId: string | null = null;
  estimateActionErrorMessage = '';

  get estimateHistoryRows(): EstimateHistoryRow[] {
    return this.estimates.map((e) => ({
      id: e.id,
      title: e.status === 'final' ? `Quotation v${e.versionNo}` : 'Quotation (Draft)',
      badgeLabel: e.status === 'final' ? 'Final' : 'Draft',
      isDraft: e.status === 'draft',
      dateIso: (e.status === 'final' ? e.finalizedAt : e.updatedAt) ?? e.createdAt,
      author: (e.status === 'final' ? e.finalizedBy : e.createdBy) ?? '—',
      grandTotal: e.grandTotal,
    }));
  }

  surveys: SurveyHistoryItem[] = [];
  surveyHistoryErrorMessage = '';

  get surveyHistoryRows(): SurveyHistoryRow[] {
    return this.surveys.map((s) => ({
      id: s.id,
      dateIso: s.updatedAt !== s.createdAt ? s.updatedAt : s.createdAt,
      author: s.createdBy ?? '—',
      photoCount: s.photoCount,
      noteCount: s.noteCount,
      wasUpdated: s.updatedAt !== s.createdAt,
    }));
  }

  // รวม estimate + survey เป็น timeline เดียว เรียงใหม่→เก่า (in: estimateHistoryRows, surveyHistoryRows / out: HistoryTimelineRow[])
  get historyTimelineRows(): HistoryTimelineRow[] {
    const estimateRows = this.estimateHistoryRows.map((row) => ({ kind: 'estimate' as const, ...row }));
    const surveyRows = this.surveyHistoryRows.map((row) => ({ kind: 'survey' as const, ...row }));
    return [...estimateRows, ...surveyRows].sort((a, b) => toTimestamp(b.dateIso) - toTimestamp(a.dateIso));
  }

  get isLoadingHistory(): boolean {
    return this.isLoadingEstimates || this.isLoadingSurveys;
  }

  contacts: Contact[] = [];
  contactErrorMessage = '';
  statusList: StatusOption[] = [];
  statusSelected: number | null = null;
  // ค่าที่ backend บันทึกล่าสุด — ใช้ rollback dropdown ถ้าบันทึกไม่สำเร็จ
  private savedStatusId: number | null = null;
  isSavingStatus = false;
  statusErrorMessage = '';

  private nextTempId = 0;

  readonly noteMaxLength = NOTE_MAX_LENGTH;
  readonly customerNameMaxLength = CUSTOMER_NAME_MAX_LENGTH;

  notes: Note[] = [];
  showNoteForm = false;
  newNoteText = '';
  isSavingNote = false;
  deletingNoteId: string | null = null;
  noteErrorMessage = '';

  readonly noteCommentMaxLength = NOTE_COMMENT_MAX_LENGTH;
  expandedNoteCommentIds = new Set<string>();
  commentsByNoteId: Partial<Record<string, NoteCommentDetail[]>> = {};
  isLoadingCommentsForNoteId: Partial<Record<string, boolean>> = {};
  commentDraftByNoteId: Partial<Record<string, string>> = {};
  isSavingCommentForNoteId: Partial<Record<string, boolean>> = {};
  deletingCommentId: string | null = null;
  commentErrorByNoteId: Partial<Record<string, string>> = {};

  readonly noteCommentMaxImages = NOTE_COMMENT_MAX_IMAGES;
  // รูปที่เลือกไว้แต่ยังไม่ส่ง — เก็บคู่กับ object URL ไว้ preview, ต้อง revoke ทิ้งเองตอนลบ/ส่งสำเร็จ/เปลี่ยนลูกค้า กัน memory leak
  commentImageDraftByNoteId: Partial<Record<string, { file: File; previewUrl: string }[]>> = {};

  isEditingName = false;
  isSavingName = false;
  nameDraft = '';
  nameErrorMessage = '';

  readonly customerNumberMaxLength = CUSTOMER_NUMBER_MAX_LENGTH;
  isEditingCustomerNumber = false;
  isSavingCustomerNumber = false;
  customerNumberDraft = '';
  customerNumberErrorMessage = '';

  readonly customerAddressMaxLength = CUSTOMER_ADDRESS_MAX_LENGTH;
  readonly googleMapsLinkMaxLength = GOOGLE_MAPS_LINK_MAX_LENGTH;
  readonly locationOptions = LOCATION_OPTIONS;
  readonly projectTypeOptions = PROJECT_TYPE_OPTIONS;
  readonly systemTypeOptions = SYSTEM_TYPE_OPTIONS;

  isEditingInfo = false;
  isSavingInfo = false;
  infoDraft: CustomerInfoDraft = this.createEmptyInfoDraft();
  infoErrorMessage = '';

  readonly electricityOptions: SelectOption[] = [
    { label: 'Residential (TOU)', value: 'residential-tou' },
    { label: 'Residential (Standard)', value: 'residential-standard' },
    { label: 'Commercial/Business', value: 'commercial' },
  ];

  electricBillForm: ElectricBillForm = {
    billName: '',
    billAmount: null,
    caRefNo: '',
    installationNo: '',
    electricityUsageType: null,
    kwhPerMonth: null,
  };
  electricBillFile: { name: string; url: string } | null = null;
  isEditingBill = true;
  isSavingBill = false;
  isUploadingBill = false;
  isBillDragOver = false;
  hasSavedElectricBill = false;
  private savedElectricBillForm: ElectricBillForm = { ...this.electricBillForm };
  billErrorMessage = '';

  get currentStatusName(): string {
    return this.statusList.find(s => s.id === this.statusSelected)?.status_name ?? '';
  }

  ngOnInit(): void {
    this.customerId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((id) => {
      if (!id) {
        this.customerLoadError = 'Customer not found';
        this.isLoading = false;
        return;
      }
      this.loadCustomerData(id);
    });
  }

  ngOnDestroy(): void {
    this.revokeAllCommentImageDrafts();
  }

  // input: id ของลูกค้าจาก route param — output: ไม่มี, reset state เดิมทั้งหมดแล้วโหลดข้อมูลลูกค้าคนใหม่
  // ทุก request ผูก takeUntil(customerId$) ไว้ด้วย กัน request ของ id เก่ามาถึงทีหลังแล้วเขียนทับ state ของ id ใหม่
  private loadCustomerData(id: string): void {
    this.isLoading = true;
    this.customer = null;
    this.customerLoadError = '';

    this.isLoadingEstimates = true;
    this.isLoadingSurveys = true;
    this.isLoadingNotes = true;
    this.estimates = [];
    this.surveys = [];
    this.notes = [];
    this.surveyHistoryErrorMessage = '';
    this.noteErrorMessage = '';

    this.currentSystem = null;
    this.pendingSystem = null;
    this.finalizedEstimateCount = 0;
    this.isLoadingSystem = true;
    this.systemErrorMessage = '';
    this.finalizingEstimateId = null;
    this.estimateActionErrorMessage = '';

    this.contacts = [];
    this.contactErrorMessage = '';
    this.statusSelected = null;
    this.savedStatusId = null;
    this.statusErrorMessage = '';

    this.expandedNoteCommentIds = new Set<string>();
    this.commentsByNoteId = {};
    this.isLoadingCommentsForNoteId = {};
    this.commentDraftByNoteId = {};
    this.isSavingCommentForNoteId = {};
    this.commentErrorByNoteId = {};
    this.revokeAllCommentImageDrafts();
    this.commentImageDraftByNoteId = {};

    this.isEditingName = false;
    this.isEditingCustomerNumber = false;
    this.isEditingInfo = false;
    this.showNoteForm = false;
    this.newNoteText = '';

    this.customerService.getStatuses().pipe(takeUntil(this.customerIdChanged$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (statuses) => { this.statusList = statuses; },
      error: (err) => console.error('[API] Failed to load statuses:', err),
    });

    this.estimateService.listByCustomer(id).pipe(takeUntil(this.customerIdChanged$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (estimates) => {
        this.estimates = estimates;
        this.isLoadingEstimates = false;
        this.loadSystemDetails(estimates);
      },
      error: (err) => {
        console.error('[API] Failed to load estimate history:', err);
        this.isLoadingEstimates = false;
        this.isLoadingSystem = false;
      },
    });

    this.surveyService.listByCustomer(id).pipe(takeUntil(this.customerIdChanged$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (surveys) => {
        this.surveys = surveys;
        this.isLoadingSurveys = false;
      },
      error: (err) => {
        console.error('[API] Failed to load survey history:', err);
        this.isLoadingSurveys = false;
        this.surveyHistoryErrorMessage = 'Failed to load survey history';
      },
    });

    this.customerService.listNotes(id).pipe(takeUntil(this.customerIdChanged$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (notes) => {
        this.notes = notes;
        this.isLoadingNotes = false;
      },
      error: (err) => {
        console.error('[API] Failed to load notes:', err);
        this.isLoadingNotes = false;
        this.noteErrorMessage = 'Failed to load notes';
      },
    });

    this.customerService.getOne(id).pipe(takeUntil(this.customerIdChanged$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.customer = data;
        this.statusSelected = data.statusId;
        this.savedStatusId = data.statusId;
        this.contacts = data.contacts.map(c => ({
          id: c.id,
          firstname: c.firstname ?? '',
          lastname: c.lastname ?? '',
          phone: c.tel ?? '',
          email: c.email ?? '',
          type: c.isPrimary ? 'Primary' : 'Secondary',
          isEditing: false,
        }));
        this.applyElectricBill(data.electricBill);
        this.isLoading = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[API] Failed to load customer:', err);
        this.customerLoadError = err.status === 404 ? 'Customer not found' : 'Failed to load customer. Please try again';
        this.isLoading = false;
      },
    });
  }

  // input: estimate ทั้งหมดของลูกค้า (draft + final) — output: ไม่มี, เซ็ต currentSystem/pendingSystem
  // currentSystem = บวกจาก final ทุกใบ (ระบบสะสมจริงของลูกค้า, ไม่ใช่ final ล่าสุดใบเดียว เพราะลูกค้ากลับมาขยายระบบได้)
  // pendingSystem = บวกจาก draft ทุกใบ (ลูกค้าคนเดียวมีได้หลาย draft พร้อมกัน) ไม่บวกกับ current — ใช้โชว์คู่กันว่า "ถ้ายืนยัน draft ที่ค้างอยู่ทั้งหมดจะเพิ่มอีกเท่าไร"
  // ⚠️ สมมติฐาน: ทุก final ที่นับ = การขาย/ขยายระบบจริง ถ้าวันหน้ามีเคส finalize ซ้ำเพื่อ "แก้ไขใบเดิม" (ไม่ใช่ขยาย)
  // ตัวเลขจะนับซ้ำ เพราะ DB ไม่มี field แยกประเภท final (ดู finalizedEstimateCount ในการ์ดเป็นตัวช่วยสังเกตความผิดปกติ)
  private loadSystemDetails(estimates: EstimateSummary[]): void {
    const finalSummaries = estimates.filter((e) => e.status === 'final');
    const draftSummaries = estimates.filter((e) => e.status === 'draft');
    this.finalizedEstimateCount = finalSummaries.length;

    if (finalSummaries.length === 0 && draftSummaries.length === 0) {
      this.isLoadingSystem = false;
      return;
    }

    const finals$ = finalSummaries.length > 0
      ? forkJoin(finalSummaries.map((e) => this.estimateService.getOne(e.id)))
      : of([] as EstimateDetail[]);
    const drafts$ = draftSummaries.length > 0
      ? forkJoin(draftSummaries.map((e) => this.estimateService.getOne(e.id)))
      : of([] as EstimateDetail[]);

    forkJoin({ finals: finals$, drafts: drafts$ })
      .pipe(takeUntil(this.customerIdChanged$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ finals, drafts }) => {
          this.currentSystem = this.sumFigures(finals.map((d) => this.toFigures(d)));
          if (this.currentSystem && finals.length > 0) {
            // type ของระบบไม่ใช่ค่าที่บวกกันได้ — เอาจาก final ที่ version_no สูงสุด (ล่าสุด)
            const latestFinal = finals.reduce((max, d) =>
              (d.versionNo ?? 0) > (max.versionNo ?? 0) ? d : max, finals[0]);
            this.currentSystem.typeOfSystemName = latestFinal.typeOfSystemName;
          }
          this.pendingSystem = this.sumFigures(drafts.map((d) => this.toFigures(d)));
          if (this.pendingSystem && drafts.length > 0) {
            // estimates มาเรียง created_at ใหม่สุดก่อนอยู่แล้ว (listByCustomer) → drafts[0] คือ draft ล่าสุด
            this.pendingSystem.typeOfSystemName = drafts[0].typeOfSystemName;
          }
          this.isLoadingSystem = false;
        },
        error: (err) => {
          console.error('[API] Failed to load system details:', err);
          this.systemErrorMessage = 'Failed to load system details';
          this.isLoadingSystem = false;
        },
      });
  }

  // input: EstimateDetail ใบเดียว — output: ตัวเลขสรุประบบของใบนั้น (main item เท่านั้น, accessory มี kw = 0 อยู่แล้วไม่ต้อง filter ซ้ำก็ได้แต่กันไว้ให้ชัด)
  private toFigures(detail: EstimateDetail): SystemFigures {
    const sumMainKw = (items: { itemRole: 'main' | 'accessory'; kw: number; quantity: number }[]): number =>
      items
        .filter((i) => i.itemRole === 'main')
        .reduce((sum, i) => sum + i.kw * i.quantity, 0);

    const inverterKw = sumMainKw(detail.inverterItems);
    const batteryKwh = sumMainKw(detail.batteryItems);

    return {
      // estimates.total_kw = ผลรวม W ของ panel (panels.kw เก็บเป็น W) → หาร 1000 เป็น kWp
      kwp: detail.totalKw > 0 ? detail.totalKw / 1000 : null,
      inverterKw: inverterKw > 0 ? inverterKw : null,
      batteryKwh: batteryKwh > 0 ? batteryKwh : null,
      systemPrice: detail.grandTotal > 0 ? detail.grandTotal : null,
      typeOfSystemName: detail.typeOfSystemName,
    };
  }

  // บวก SystemFigures หลายใบเข้าด้วยกัน (ข้าม field ที่เป็น null ทั้งหมด → คืน null แทน 0, type ไม่บวกจึงปล่อย null ไว้ให้ผู้เรียกเซ็ตเอง)
  private sumFigures(list: SystemFigures[]): SystemFigures | null {
    if (list.length === 0) return null;

    const sumField = (pick: (f: SystemFigures) => number | null): number | null => {
      const values = list.map(pick).filter((v): v is number => v !== null);
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
    };

    return {
      kwp: sumField((f) => f.kwp),
      inverterKw: sumField((f) => f.inverterKw),
      batteryKwh: sumField((f) => f.batteryKwh),
      systemPrice: sumField((f) => f.systemPrice),
      typeOfSystemName: null,
    };
  }

  // input: id ของ draft ในแถว History — output: ไม่มี, confirm ก่อนเพราะ finalize แล้วแก้ไขไม่ได้อีก
  onFinalizeEstimate(id: string): void {
    if (this.finalizingEstimateId) return;
    this.confirmationService.confirm({
      header: 'Finalize Estimate',
      message: 'Once finalized, this estimate can no longer be edited. Continue?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Finalize',
      rejectLabel: 'Cancel',
      accept: () => this.finalizeEstimate(id),
    });
  }

  private finalizeEstimate(id: string): void {
    this.estimateActionErrorMessage = '';
    this.finalizingEstimateId = id;

    this.estimateService.finalize(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.finalizingEstimateId = null;
          // แก้ในแถวเดิมแทนการ refetch ทั้ง list — estimateHistoryRows/loadSystemDetails คำนวณจาก this.estimates ใหม่ทุกครั้งอยู่แล้ว
          const estimate = this.estimates.find((e) => e.id === id);
          if (estimate) {
            estimate.status = result.status;
            estimate.versionNo = result.versionNo;
            estimate.finalizedAt = result.finalizedAt;
            estimate.finalizedBy = result.finalizedBy;
          }
          this.loadSystemDetails(this.estimates);
        },
        error: (err) => {
          this.finalizingEstimateId = null;
          console.error('[API] Failed to finalize estimate:', err);
          this.estimateActionErrorMessage = err?.status === 409
            ? 'This estimate was already finalized elsewhere'
            : 'Failed to finalize estimate. Please try again';
        },
      });
  }

  // input: id ของ estimate final ในแถว History (ปุ่มนี้โชว์เฉพาะ CEO) — output: ไม่มี, confirm ก่อนเพราะย้อนกลับเป็น draft ทำให้แก้ไขได้อีกครั้ง
  onUnfinalizeEstimate(id: string): void {
    if (this.finalizingEstimateId) return;
    this.confirmationService.confirm({
      header: 'Cancel Finalization',
      message: 'This quotation will become an editable draft again. Continue?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Revert to Draft',
      rejectLabel: 'Cancel',
      accept: () => this.unfinalizeEstimate(id),
    });
  }

  private unfinalizeEstimate(id: string): void {
    this.estimateActionErrorMessage = '';
    this.finalizingEstimateId = id;

    this.estimateService.unfinalize(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.finalizingEstimateId = null;
          const estimate = this.estimates.find((e) => e.id === id);
          if (estimate) {
            estimate.status = result.status;
            estimate.versionNo = result.versionNo;
            estimate.finalizedAt = result.finalizedAt;
            estimate.finalizedBy = result.finalizedBy;
          }
          this.loadSystemDetails(this.estimates);
        },
        error: (err) => {
          this.finalizingEstimateId = null;
          console.error('[API] Failed to unfinalize estimate:', err);
          this.estimateActionErrorMessage = err?.status === 409
            ? 'This estimate is not finalized'
            : 'Failed to revert estimate to draft. Please try again';
        },
      });
  }

  // input: status id ที่ผู้ใช้เลือกใน dropdown — output: ไม่มี, บันทึกลง backend; ถ้าพลาดคืนค่า dropdown กลับเป็นค่าที่บันทึกไว้
  onStatusChange(newStatusId: number | null): void {
    if (!this.customer || newStatusId === null || this.isSavingStatus) return;
    if (newStatusId === this.savedStatusId) return;

    this.isSavingStatus = true;
    this.statusErrorMessage = '';

    this.customerService.updateStatus(this.customer.id, newStatusId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savedStatusId = newStatusId;
          this.isSavingStatus = false;
        },
        error: (err: HttpErrorResponse) => {
          console.error('[API] Failed to update status:', err);
          this.statusSelected = this.savedStatusId;
          this.isSavingStatus = false;
          this.statusErrorMessage = 'Failed to update status. Please try again';
        },
      });
  }

  addContact(): void {
    this.contactErrorMessage = '';
    this.contacts.push({
      id: `new-${this.nextTempId++}`,
      firstname: '',
      lastname: '',
      phone: '',
      email: '',
      type: 'Other',
      isEditing: true,
    });
  }

  // input: contact ที่ save แล้ว (มี UUID จริง) ที่ต้องการแก้ไข — ปัจจุบันใช้กับ Primary contact เท่านั้น
  // output: ไม่มี — เก็บค่าเดิมไว้ก่อนเข้าโหมด edit เผื่อกด Cancel แล้วต้อง revert
  startEditContact(contact: Contact): void {
    if (contact.isSaving) return;
    contact.editSnapshot = {
      firstname: contact.firstname,
      lastname: contact.lastname,
      phone: contact.phone,
      email: contact.email,
    };
    this.contactErrorMessage = '';
    contact.isEditing = true;
  }

  // input: contact ที่กำลัง edit อยู่ (save แล้วเท่านั้น — แถวใหม่ใช้ removeContact ลบทิ้งแทน)
  // output: ไม่มี — revert ค่ากลับเป็นก่อนกด edit แล้วออกจากโหมด edit
  cancelEditContact(contact: Contact): void {
    if (contact.isSaving) return;
    if (contact.editSnapshot) {
      contact.firstname = contact.editSnapshot.firstname;
      contact.lastname = contact.editSnapshot.lastname;
      contact.phone = contact.editSnapshot.phone;
      contact.email = contact.editSnapshot.email;
      contact.editSnapshot = undefined;
    }
    this.contactErrorMessage = '';
    contact.isEditing = false;
  }

  // input: contact ที่กำลังแก้ (แถวใหม่จาก addContact() → สร้างใหม่, แถว save แล้ว → อัปเดตของเดิม)
  // output: ไม่มี — เรียก API ที่เหมาะสม, ถ้าสำเร็จเอาค่าจาก backend มาซิงค์กลับ
  saveContact(contact: Contact): void {
    if (!this.customer || contact.isSaving) return;

    const firstname = contact.firstname.trim();
    if (!firstname) {
      this.contactErrorMessage = 'Please enter a name';
      return;
    }

    const payload: UpsertContactPayload = {
      firstname,
      lastname: contact.lastname.trim() || undefined,
      tel: contact.phone.trim() || undefined,
      email: contact.email.trim() || undefined,
      isPrimary: contact.type === 'Primary',
    };

    this.contactErrorMessage = '';
    contact.isSaving = true;

    const isNew = contact.id.startsWith('new-');
    const request$ = isNew
      ? this.customerService.addContact(this.customer.id, payload)
      : this.customerService.updateContact(this.customer.id, contact.id, payload);

    request$.subscribe({
      next: (saved) => {
        contact.id = saved.id;
        contact.isSaving = false;
        contact.isEditing = false;
        contact.editSnapshot = undefined;
        // ถ้า contact นี้ถูกตั้งเป็น Primary ต้องเคลียร์ primary ของตัวอื่นในหน้าจอด้วย (backend เคลียร์ให้แล้ว แต่ local state ยังไม่รู้)
        if (saved.isPrimary) {
          this.contacts.forEach(c => { if (c.id !== contact.id) c.type = c.type === 'Primary' ? 'Secondary' : c.type; });
        }
      },
      error: (err) => {
        console.error(`[API] Failed to ${isNew ? 'save' : 'update'} contact:`, err);
        contact.isSaving = false;
        this.contactErrorMessage = `Failed to ${isNew ? 'save' : 'update'} contact. Please try again`;
      },
    });
  }

  // input: contact id (temp id ถ้ายังไม่เคย save, หรือ UUID จริงถ้า save แล้ว)
  // output: ไม่มี — ถ้ายังไม่เคย save แค่ตัดออกจาก local array, ถ้า save แล้วเรียก API ลบจริง
  removeContact(id: string): void {
    const contact = this.contacts.find(c => c.id === id);
    if (!contact || contact.isDeleting) return;

    if (id.startsWith('new-')) {
      this.contacts = this.contacts.filter(c => c.id !== id);
      return;
    }

    if (contact.type === 'Primary') {
      this.contactErrorMessage = 'Cannot delete the Primary contact. Set another contact as Primary first';
      return;
    }

    if (!this.customer) return;
    if (this.contacts.length <= 1) {
      this.contactErrorMessage = 'At least one contact is required and cannot be deleted';
      return;
    }

    const contactName = [contact.firstname, contact.lastname].filter(Boolean).join(' ').trim() || 'this contact';
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove ${contactName} from contacts?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.deleteContact(id),
    });
  }

  // ทำไมหา contact ใหม่: ระหว่างรอผู้ใช้กดยืนยัน list อาจเปลี่ยนแล้ว (เช่น กำลังลบอยู่ หรือถูกลบไปแล้ว) — อ้างด้วย id ไม่ใช้ตัวแปรเดิม
  private deleteContact(id: string): void {
    const contact = this.contacts.find(c => c.id === id);
    if (!this.customer || !contact || contact.isDeleting) return;

    this.contactErrorMessage = '';
    contact.isDeleting = true;

    this.customerService.deleteContact(this.customer.id, id).subscribe({
      next: () => {
        this.contacts = this.contacts.filter(c => c.id !== id);
      },
      error: (err) => {
        console.error('[API] Failed to delete contact:', err);
        contact.isDeleting = false;
        this.contactErrorMessage = 'Failed to delete contact. Please try again';
      },
    });
  }

  // input: contact ที่ save แล้ว (มี UUID จริง) และยังไม่ใช่ Primary
  // output: ไม่มี — เรียก API ตั้งเป็น Primary, ส่ง field เดิมของ contact นี้ไปด้วยทั้งหมดกันข้อมูล tel/email ถูกเขียนทับเป็น null
  setPrimaryContact(contact: Contact): void {
    if (!this.customer || contact.type === 'Primary' || contact.isSaving) return;

    this.contactErrorMessage = '';
    contact.isSaving = true;

    const payload: UpsertContactPayload = {
      firstname: contact.firstname,
      lastname: contact.lastname || undefined,
      tel: contact.phone || undefined,
      email: contact.email || undefined,
      isPrimary: true,
    };

    this.customerService.updateContact(this.customer.id, contact.id, payload).subscribe({
      next: () => {
        this.contacts.forEach(c => {
          c.type = c.id === contact.id ? 'Primary' : (c.type === 'Primary' ? 'Secondary' : c.type);
        });
        contact.isSaving = false;
      },
      error: (err) => {
        console.error('[API] Failed to set primary contact:', err);
        contact.isSaving = false;
        this.contactErrorMessage = 'Failed to set as Primary. Please try again';
      },
    });
  }

  toggleNoteForm(): void {
    if (this.isSavingNote) return;
    this.showNoteForm = !this.showNoteForm;
    this.noteErrorMessage = '';
    if (!this.showNoteForm) {
      this.newNoteText = '';
    }
  }

  // input: this.newNoteText — output: ไม่มี, เพิ่มโน้ตที่ backend คืนมาไว้บนสุดของ list
  // ไม่ล้างข้อความจนกว่า API จะสำเร็จ เพื่อไม่ให้ข้อความที่พิมพ์หายเมื่อ network หลุด
  saveNote(): void {
    const trimmed = this.newNoteText.trim();
    if (!this.customer || !trimmed || this.isSavingNote) return;

    this.noteErrorMessage = '';
    this.isSavingNote = true;

    this.customerService.addNote(this.customer.id, { text: trimmed }).subscribe({
      next: (saved) => {
        this.notes = [saved, ...this.notes];
        this.newNoteText = '';
        this.showNoteForm = false;
        this.isSavingNote = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[API] Failed to save note:', err);
        this.isSavingNote = false;
        this.noteErrorMessage = 'Failed to save note. Please try again';
      },
    });
  }

  // input: note id — output: ไม่มี
  // 404 = ถูกลบไปแล้ว (เช่น จากอีก tab) ถือว่าสำเร็จ, 403 = ไม่ใช่เจ้าของ/admin/ceo
  removeNote(id: string): void {
    if (!this.customer || this.deletingNoteId) return;

    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: 'Remove this note?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.deleteNote(id),
    });
  }

  private deleteNote(id: string): void {
    if (!this.customer || this.deletingNoteId) return;

    this.noteErrorMessage = '';
    this.deletingNoteId = id;

    this.customerService.deleteNote(this.customer.id, id).subscribe({
      next: () => {
        this.notes = this.notes.filter(n => n.id !== id);
        this.deletingNoteId = null;
      },
      error: (err: HttpErrorResponse) => {
        this.deletingNoteId = null;
        if (err.status === 404) {
          this.notes = this.notes.filter(n => n.id !== id);
          return;
        }
        console.error('[API] Failed to delete note:', err);
        this.noteErrorMessage = err.status === 403
          ? 'Only the note owner, admin or ceo can delete this note'
          : 'Failed to delete note. Please try again';
      },
    });
  }

  // input: note id — output: ไม่มี, ขยาย/ย่อ comment list — โหลด comment ครั้งแรกที่ขยายเท่านั้น (cache ไว้ใน commentsByNoteId)
  toggleNoteComments(noteId: string): void {
    if (this.expandedNoteCommentIds.has(noteId)) {
      this.expandedNoteCommentIds.delete(noteId);
      return;
    }
    this.expandedNoteCommentIds.add(noteId);
    if (!this.commentsByNoteId[noteId]) {
      this.loadNoteComments(noteId);
    }
  }

  private loadNoteComments(noteId: string): void {
    if (!this.customer) return;

    this.commentErrorByNoteId[noteId] = '';
    this.isLoadingCommentsForNoteId[noteId] = true;

    this.customerService.listNoteComments(this.customer.id, noteId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (comments) => {
        this.commentsByNoteId[noteId] = comments;
        this.isLoadingCommentsForNoteId[noteId] = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[API] Failed to load note comments:', err);
        this.isLoadingCommentsForNoteId[noteId] = false;
        this.commentErrorByNoteId[noteId] = 'Failed to load comments';
      },
    });
  }

  // input: this.commentDraftByNoteId[noteId] + this.commentImageDraftByNoteId[noteId] — output: ไม่มี, เพิ่ม comment ที่ backend คืนมาไว้ท้าย list และ +1 commentCount บนโน้ต
  // ส่งได้แม้ไม่มีข้อความ ถ้ามีรูปแนบอย่างน้อย 1 รูป
  saveNoteComment(noteId: string): void {
    const trimmed = (this.commentDraftByNoteId[noteId] ?? '').trim();
    const draftImages = this.commentImageDraftByNoteId[noteId] ?? [];
    if (!this.customer || (!trimmed && draftImages.length === 0) || this.isSavingCommentForNoteId[noteId]) return;

    this.commentErrorByNoteId[noteId] = '';
    this.isSavingCommentForNoteId[noteId] = true;

    this.customerService.addNoteComment(this.customer.id, noteId, trimmed, draftImages.map((d) => d.file)).subscribe({
      next: (saved) => {
        this.commentsByNoteId[noteId] = [...(this.commentsByNoteId[noteId] ?? []), saved];
        this.commentDraftByNoteId[noteId] = '';
        this.clearCommentImageDrafts(noteId);
        this.isSavingCommentForNoteId[noteId] = false;
        const note = this.notes.find(n => n.id === noteId);
        if (note) note.commentCount += 1;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[API] Failed to save comment:', err);
        this.isSavingCommentForNoteId[noteId] = false;
        this.commentErrorByNoteId[noteId] = 'Failed to save comment. Please try again';
      },
    });
  }

  // input: note id + FileList จาก <input type="file" multiple> — output: ไม่มี, validate แล้วเพิ่มเข้า draft ของโน้ตนั้น (เก็บ object URL ไว้ preview)
  onCommentImagesSelected(noteId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    const existing = this.commentImageDraftByNoteId[noteId] ?? [];
    this.commentErrorByNoteId[noteId] = '';

    if (existing.length + files.length > NOTE_COMMENT_MAX_IMAGES) {
      this.commentErrorByNoteId[noteId] = `You can attach up to ${NOTE_COMMENT_MAX_IMAGES} images per comment`;
      return;
    }

    for (const file of files) {
      if (!NOTE_COMMENT_IMAGE_ACCEPTED_TYPES.includes(file.type)) {
        this.commentErrorByNoteId[noteId] = 'Only JPEG, PNG, or WebP images are supported';
        return;
      }
      if (file.size > NOTE_COMMENT_IMAGE_MAX_SIZE_BYTES) {
        this.commentErrorByNoteId[noteId] = 'Each image must not exceed 10MB';
        return;
      }
    }

    const added = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    this.commentImageDraftByNoteId[noteId] = [...existing, ...added];
  }

  // input: note id + index ในรายการรูปที่ยังไม่ส่ง — output: ไม่มี, ลบออกจาก draft และ revoke object URL กัน memory leak
  removeCommentImageDraft(noteId: string, index: number): void {
    const existing = this.commentImageDraftByNoteId[noteId] ?? [];
    const target = existing[index];
    if (!target) return;
    URL.revokeObjectURL(target.previewUrl);
    this.commentImageDraftByNoteId[noteId] = existing.filter((_, i) => i !== index);
  }

  private clearCommentImageDrafts(noteId: string): void {
    for (const draft of this.commentImageDraftByNoteId[noteId] ?? []) {
      URL.revokeObjectURL(draft.previewUrl);
    }
    delete this.commentImageDraftByNoteId[noteId];
  }

  private revokeAllCommentImageDrafts(): void {
    for (const drafts of Object.values(this.commentImageDraftByNoteId)) {
      for (const draft of drafts ?? []) {
        URL.revokeObjectURL(draft.previewUrl);
      }
    }
  }

  // input: note id + comment id — output: ไม่มี
  removeNoteComment(noteId: string, commentId: string): void {
    if (!this.customer || this.deletingCommentId) return;

    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: 'Remove this comment?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.deleteNoteComment(noteId, commentId),
    });
  }

  private deleteNoteComment(noteId: string, commentId: string): void {
    if (!this.customer || this.deletingCommentId) return;

    this.commentErrorByNoteId[noteId] = '';
    this.deletingCommentId = commentId;

    this.customerService.deleteNoteComment(this.customer.id, noteId, commentId).subscribe({
      next: () => {
        this.commentsByNoteId[noteId] = (this.commentsByNoteId[noteId] ?? []).filter(c => c.id !== commentId);
        this.deletingCommentId = null;
        const note = this.notes.find(n => n.id === noteId);
        if (note) note.commentCount = Math.max(0, note.commentCount - 1);
      },
      error: (err: HttpErrorResponse) => {
        this.deletingCommentId = null;
        if (err.status === 404) {
          this.commentsByNoteId[noteId] = (this.commentsByNoteId[noteId] ?? []).filter(c => c.id !== commentId);
          return;
        }
        console.error('[API] Failed to delete comment:', err);
        this.commentErrorByNoteId[noteId] = 'Failed to delete comment. Please try again';
      },
    });
  }

  startEditName(): void {
    if (!this.customer) return;
    this.nameDraft = this.customer.displayName;
    this.nameErrorMessage = '';
    this.isEditingName = true;
  }

  cancelEditName(): void {
    if (this.isSavingName) return;
    this.isEditingName = false;
    this.nameErrorMessage = '';
  }

  // input: this.nameDraft — output: ไม่มี, อัปเดต customer.displayName ด้วยชื่อที่ backend บันทึกแล้ว
  saveName(): void {
    if (!this.customer || this.isSavingName) return;

    const trimmed = this.nameDraft.trim();
    if (!trimmed) {
      this.nameErrorMessage = 'Please enter a name';
      return;
    }
    if (trimmed === this.customer.displayName) {
      this.isEditingName = false;
      return;
    }

    this.nameErrorMessage = '';
    this.isSavingName = true;

    this.customerService.updateName(this.customer.id, { displayName: trimmed }).subscribe({
      next: ({ displayName }) => {
        if (this.customer) this.customer = { ...this.customer, displayName };
        this.isSavingName = false;
        this.isEditingName = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[API] Failed to update customer name:', err);
        this.isSavingName = false;
        this.nameErrorMessage = 'Failed to update name. Please try again';
      },
    });
  }

  startEditCustomerNumber(): void {
    if (!this.customer) return;
    this.customerNumberDraft = this.customer.customerNumber ?? '';
    this.customerNumberErrorMessage = '';
    this.isEditingCustomerNumber = true;
  }

  cancelEditCustomerNumber(): void {
    if (this.isSavingCustomerNumber) return;
    this.isEditingCustomerNumber = false;
    this.customerNumberErrorMessage = '';
  }

  // input: this.customerNumberDraft — output: ไม่มี, อัปเดต customer.customerNumber ด้วยค่าที่ backend บันทึกแล้ว
  saveCustomerNumber(): void {
    if (!this.customer || this.isSavingCustomerNumber) return;

    const trimmed = this.customerNumberDraft.trim();
    const normalized = trimmed || null;
    if (normalized === this.customer.customerNumber) {
      this.isEditingCustomerNumber = false;
      return;
    }

    this.customerNumberErrorMessage = '';
    this.isSavingCustomerNumber = true;

    this.customerService.updateCustomerNumber(this.customer.id, { customerNumber: normalized }).subscribe({
      next: ({ customerNumber }) => {
        if (this.customer) this.customer = { ...this.customer, customerNumber };
        this.isSavingCustomerNumber = false;
        this.isEditingCustomerNumber = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[API] Failed to update customer number:', err);
        this.isSavingCustomerNumber = false;
        this.customerNumberErrorMessage = err.status === 409
          ? `Customer # "${trimmed}" ถูกใช้ไปแล้ว`
          : 'Failed to update customer number. Please try again';
      },
    });
  }

  private createEmptyInfoDraft(): CustomerInfoDraft {
    return { fullAddress: '', googleMapsLink: '', projectLocationName: null, typeOfCustomerName: null, typeOfSystemName: null };
  }

  startEditInfo(): void {
    if (!this.customer) return;
    this.infoDraft = {
      fullAddress: this.customer.fullAddress ?? '',
      googleMapsLink: this.customer.googleMapsLink ?? '',
      projectLocationName: this.customer.projectLocationName,
      typeOfCustomerName: this.customer.typeOfCustomerName,
      typeOfSystemName: this.customer.typeOfSystemName,
    };
    this.infoErrorMessage = '';
    this.isEditingInfo = true;
  }

  cancelEditInfo(): void {
    if (this.isSavingInfo) return;
    this.isEditingInfo = false;
    this.infoErrorMessage = '';
  }

  // คลิก tag ที่เลือกอยู่แล้วไม่ทำอะไร (ทั้ง 3 กลุ่มต้องมีค่า จึงไม่มีการ toggle ออก)
  selectInfoTag(field: 'projectLocationName' | 'typeOfCustomerName' | 'typeOfSystemName', value: string): void {
    if (this.isSavingInfo) return;
    this.infoDraft = { ...this.infoDraft, [field]: value };
  }

  // input: this.infoDraft — output: ไม่มี, อัปเดต customer ด้วยค่าที่ backend บันทึกแล้ว
  saveInfo(): void {
    if (!this.customer || this.isSavingInfo) return;

    const fullAddress = this.infoDraft.fullAddress.trim();
    const googleMapsLink = this.infoDraft.googleMapsLink.trim();
    const { projectLocationName, typeOfCustomerName, typeOfSystemName } = this.infoDraft;

    if (!fullAddress) {
      this.infoErrorMessage = 'Please enter an address';
      return;
    }
    if (googleMapsLink && !this.isHttpUrl(googleMapsLink)) {
      this.infoErrorMessage = 'Google Maps link must start with http:// or https://';
      return;
    }
    if (!projectLocationName || !typeOfCustomerName || !typeOfSystemName) {
      this.infoErrorMessage = 'Please select Location, Project Type and Type of System';
      return;
    }

    const isUnchanged =
      fullAddress === (this.customer.fullAddress ?? '') &&
      googleMapsLink === (this.customer.googleMapsLink ?? '') &&
      projectLocationName === this.customer.projectLocationName &&
      typeOfCustomerName === this.customer.typeOfCustomerName &&
      typeOfSystemName === this.customer.typeOfSystemName;
    if (isUnchanged) {
      this.isEditingInfo = false;
      return;
    }

    this.infoErrorMessage = '';
    this.isSavingInfo = true;

    this.customerService
      .updateDetails(this.customer.id, {
        fullAddress,
        googleMapsLink: googleMapsLink || null,
        projectLocationName,
        typeOfCustomerName,
        typeOfSystemName,
      })
      .subscribe({
        next: (saved) => {
          if (this.customer) this.customer = { ...this.customer, ...saved };
          this.isSavingInfo = false;
          this.isEditingInfo = false;
        },
        error: (err: HttpErrorResponse) => {
          console.error('[API] Failed to update customer details:', err);
          this.isSavingInfo = false;
          this.infoErrorMessage = err.status === 404
            ? 'Customer not found. Please refresh the page'
            : 'Failed to update client information. Please try again';
        },
      });
  }

  private isHttpUrl(value: string): boolean {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  // input: electric bill จาก API (null ถ้ายังไม่เคยบันทึก)
  // output: ไม่มี — เซ็ต electricBillForm / electricBillFile ให้ตรงกับข้อมูลที่โหลดมา, ล็อกฟอร์มถ้ามีข้อมูลอยู่แล้ว
  private applyElectricBill(bill: ElectricBillDetail | null): void {
    this.electricBillForm = {
      billName: bill?.billName ?? '',
      billAmount: bill?.billAmount ?? null,
      caRefNo: bill?.caRefNo ?? '',
      installationNo: bill?.installationNo ?? '',
      electricityUsageType: bill?.electricityUsageType ?? null,
      kwhPerMonth: bill?.kwhPerMonth ?? null,
    };
    this.electricBillFile = bill?.fileUrl && bill.fileName
      ? { name: bill.fileName, url: bill.fileUrl }
      : null;
    this.savedElectricBillForm = { ...this.electricBillForm };
    this.hasSavedElectricBill = !!bill;
    this.isEditingBill = !bill;
  }

  enableBillEdit(): void {
    this.isEditingBill = true;
    this.billErrorMessage = '';
  }

  // ยกเลิกการแก้ไข — revert ฟอร์มกลับไปค่าที่ save ล่าสุด (ไฟล์แนบไม่ revert เพราะ upload/remove ถูกบันทึกทันทีอยู่แล้ว แยกจาก Save)
  cancelBillEdit(): void {
    this.electricBillForm = { ...this.savedElectricBillForm };
    this.isEditingBill = !this.hasSavedElectricBill;
    this.billErrorMessage = '';
  }

  saveElectricBill(): void {
    if (!this.customer || !this.isEditingBill || this.isSavingBill) return;

    this.isSavingBill = true;
    this.billErrorMessage = '';

    this.customerService.saveElectricBill(this.customer.id, {
      billName: this.electricBillForm.billName.trim() || undefined,
      billAmount: this.electricBillForm.billAmount ?? undefined,
      caRefNo: this.electricBillForm.caRefNo.trim() || undefined,
      installationNo: this.electricBillForm.installationNo.trim() || undefined,
      electricityUsageType: this.electricBillForm.electricityUsageType ?? undefined,
      kwhPerMonth: this.electricBillForm.kwhPerMonth ?? undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (bill) => {
        this.applyElectricBill(bill);
        this.isSavingBill = false;
      },
      error: (err) => {
        console.error('[API] Failed to save electric bill:', err);
        this.billErrorMessage = 'Failed to save. Please try again';
        this.isSavingBill = false;
      },
    });
  }

  onBillFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) this.uploadBillFile(file);
  }

  onBillDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.isEditingBill) return;
    this.isBillDragOver = true;
  }

  onBillDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isBillDragOver = false;
  }

  onBillDrop(event: DragEvent): void {
    event.preventDefault();
    this.isBillDragOver = false;
    if (!this.isEditingBill) return;
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) this.uploadBillFile(file);
  }

  private uploadBillFile(file: File): void {
    if (!this.customer || !this.isEditingBill || this.isUploadingBill) return;

    if (!ELECTRIC_BILL_ACCEPTED_TYPES.includes(file.type)) {
      this.billErrorMessage = 'Only PDF, JPEG, or PNG files are supported';
      return;
    }
    if (file.size > ELECTRIC_BILL_MAX_SIZE_BYTES) {
      this.billErrorMessage = 'File must not exceed 10MB';
      return;
    }

    this.isUploadingBill = true;
    this.billErrorMessage = '';

    this.customerService.uploadElectricBillFile(this.customer.id, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (bill) => {
          // อัปโหลดไฟล์ persist ทันที แยกจากปุ่ม Save — ไม่ sync ข้อความในฟอร์มทับ เผื่อผู้ใช้กำลังแก้ field อื่นค้างอยู่
          this.electricBillFile = bill.fileUrl && bill.fileName
            ? { name: bill.fileName, url: bill.fileUrl }
            : null;
          this.hasSavedElectricBill = true;
          this.isUploadingBill = false;
        },
        error: (err) => {
          console.error('[API] Failed to upload electric bill file:', err);
          this.billErrorMessage = 'Failed to upload file. Please try again';
          this.isUploadingBill = false;
        },
      });
  }

  removeBillFile(): void {
    if (!this.customer || !this.isEditingBill || this.isUploadingBill) return;

    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove ${this.electricBillFile?.name ?? 'this file'}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.deleteBillFile(),
    });
  }

  // ทำไมเช็ก guard ซ้ำ: ระหว่างรอยืนยัน อาจเริ่มอัปโหลด/ออกจากโหมดแก้ไขไปแล้ว
  private deleteBillFile(): void {
    if (!this.customer || !this.isEditingBill || this.isUploadingBill) return;

    this.isUploadingBill = true;
    this.billErrorMessage = '';

    this.customerService.deleteElectricBillFile(this.customer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.electricBillFile = null;
          this.isUploadingBill = false;
        },
        error: (err) => {
          console.error('[API] Failed to remove electric bill file:', err);
          this.billErrorMessage = 'Failed to delete file. Please try again';
          this.isUploadingBill = false;
        },
      });
  }
}
