import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { CustomerService } from '../../services/customer.service';
import { EstimateService } from '../../services/estimate.service';
import type { CustomerDetail, ElectricBillDetail, StatusOption } from '../../dto/customer.dto';
import type { EstimateDetail, EstimateSummary } from '../../dto/estimate.dto';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  type: 'Primary' | 'Secondary' | 'Other';
  isEditing: boolean;
}

interface Note {
  id: number;
  text: string;
  date: Date;
  author: string;
}

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

const ELECTRIC_BILL_ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ELECTRIC_BILL_MAX_SIZE_BYTES = 10 * 1024 * 1024;

interface EstimateHistoryRow {
  id: string;
  title: string;
  badgeLabel: string;
  isDraft: boolean;
  dateIso: string;
  author: string;
  grandTotal: number;
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
  imports: [CommonModule, FormsModule, FloatLabelModule, InputTextModule, SelectModule, RouterLink],
  templateUrl: './customer-detail-page.component.html',
  styleUrl: './customer-detail-page.component.scss'
})
export class CustomerDetailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly customerService = inject(CustomerService);
  private readonly estimateService = inject(EstimateService);
  private readonly destroyRef = inject(DestroyRef);

  customer: CustomerDetail | null = null;
  isLoading = true;

  estimates: EstimateSummary[] = [];

  // System Details card — currentSystem = ผลรวมของ final ทุกใบ (ระบบสะสมของลูกค้า), pendingSystem = ค่าของ draft เดี่ยวๆ (ยังไม่บวกเข้า current)
  currentSystem: SystemFigures | null = null;
  pendingSystem: SystemFigures | null = null;
  finalizedEstimateCount = 0;
  isLoadingSystem = true;
  systemErrorMessage = '';

  get estimateHistoryRows(): EstimateHistoryRow[] {
    return this.estimates.map((e) => ({
      id: e.id,
      title: e.status === 'final' ? `Estimate v${e.versionNo}` : 'Estimate (Draft)',
      badgeLabel: e.status === 'final' ? 'Final' : 'Draft',
      isDraft: e.status === 'draft',
      dateIso: (e.status === 'final' ? e.finalizedAt : e.updatedAt) ?? e.createdAt,
      author: (e.status === 'final' ? e.finalizedBy : e.createdBy) ?? '—',
      grandTotal: e.grandTotal,
    }));
  }

  contacts: Contact[] = [];
  statusList: StatusOption[] = [];
  statusSelected: number | null = null;

  private nextTempId = 0;
  private nextNoteId = 1;

  notes: Note[] = [];
  showNoteForm = false;
  newNoteText = '';

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
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    this.customerService.getStatuses().subscribe({
      next: (statuses) => { this.statusList = statuses; },
      error: (err) => console.error('[API] Failed to load statuses:', err),
    });

    this.estimateService.listByCustomer(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (estimates) => {
        this.estimates = estimates;
        this.loadSystemDetails(estimates);
      },
      error: (err) => {
        console.error('[API] Failed to load estimate history:', err);
        this.isLoadingSystem = false;
      },
    });

    this.customerService.getOne(id).subscribe({
      next: (data) => {
        this.customer = data;
        this.statusSelected = data.statusId;
        this.contacts = data.contacts.map(c => ({
          id: c.id,
          name: `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim(),
          phone: c.tel ?? '',
          email: c.email ?? '',
          type: c.isPrimary ? 'Primary' : 'Secondary',
          isEditing: false,
        }));
        this.applyElectricBill(data.electricBill);
        this.isLoading = false;
      },
      error: (err) => {
        console.error('[API] Failed to load customer:', err);
        this.isLoading = false;
      },
    });
  }

  // input: estimate ทั้งหมดของลูกค้า (draft + final) — output: ไม่มี, เซ็ต currentSystem/pendingSystem
  // currentSystem = บวกจาก final ทุกใบ (ระบบสะสมจริงของลูกค้า, ไม่ใช่ final ล่าสุดใบเดียว เพราะลูกค้ากลับมาขยายระบบได้)
  // pendingSystem = ค่าของ draft เดี่ยวๆ ไม่บวกกับ current — ใช้โชว์คู่กันว่า "ถ้ายืนยัน draft นี้จะเพิ่มอีกเท่าไร"
  // ⚠️ สมมติฐาน: ทุก final ที่นับ = การขาย/ขยายระบบจริง ถ้าวันหน้ามีเคส finalize ซ้ำเพื่อ "แก้ไขใบเดิม" (ไม่ใช่ขยาย)
  // ตัวเลขจะนับซ้ำ เพราะ DB ไม่มี field แยกประเภท final (ดู finalizedEstimateCount ในการ์ดเป็นตัวช่วยสังเกตความผิดปกติ)
  private loadSystemDetails(estimates: EstimateSummary[]): void {
    const finalSummaries = estimates.filter((e) => e.status === 'final');
    const draftSummary = estimates.find((e) => e.status === 'draft');
    this.finalizedEstimateCount = finalSummaries.length;

    if (finalSummaries.length === 0 && !draftSummary) {
      this.isLoadingSystem = false;
      return;
    }

    const finals$ = finalSummaries.length > 0
      ? forkJoin(finalSummaries.map((e) => this.estimateService.getOne(e.id)))
      : of([] as EstimateDetail[]);
    const draft$ = draftSummary
      ? this.estimateService.getOne(draftSummary.id)
      : of(null as EstimateDetail | null);

    forkJoin({ finals: finals$, draft: draft$ })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ finals, draft }) => {
          this.currentSystem = this.sumFigures(finals.map((d) => this.toFigures(d)));
          if (this.currentSystem && finals.length > 0) {
            // type ของระบบไม่ใช่ค่าที่บวกกันได้ — เอาจาก final ที่ version_no สูงสุด (ล่าสุด)
            const latestFinal = finals.reduce((max, d) =>
              (d.versionNo ?? 0) > (max.versionNo ?? 0) ? d : max, finals[0]);
            this.currentSystem.typeOfSystemName = latestFinal.typeOfSystemName;
          }
          this.pendingSystem = draft ? this.toFigures(draft) : null;
          this.isLoadingSystem = false;
        },
        error: (err) => {
          console.error('[API] Failed to load system details:', err);
          this.systemErrorMessage = 'โหลดข้อมูล System Details ไม่สำเร็จ';
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
      kwp: detail.totalKw > 0 ? detail.totalKw : null,
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

  addContact(): void {
    this.contacts.push({
      id: `new-${this.nextTempId++}`,
      name: '',
      phone: '',
      email: '',
      type: 'Other',
      isEditing: true,
    });
  }

  saveContact(contact: Contact): void {
    contact.isEditing = false;
  }

  removeContact(id: string): void {
    this.contacts = this.contacts.filter(c => c.id !== id);
  }

  toggleNoteForm(): void {
    this.showNoteForm = !this.showNoteForm;
    if (!this.showNoteForm) {
      this.newNoteText = '';
    }
  }

  saveNote(): void {
    const trimmed = this.newNoteText.trim();
    if (!trimmed) return;

    this.notes.unshift({
      id: this.nextNoteId++,
      text: trimmed,
      date: new Date(),
      author: 'Staff_You',
    });

    this.newNoteText = '';
    this.showNoteForm = false;
  }

  removeNote(id: number): void {
    this.notes = this.notes.filter(n => n.id !== id);
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
        this.billErrorMessage = 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
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
      this.billErrorMessage = 'รองรับเฉพาะไฟล์ PDF, JPEG, หรือ PNG เท่านั้น';
      return;
    }
    if (file.size > ELECTRIC_BILL_MAX_SIZE_BYTES) {
      this.billErrorMessage = 'ไฟล์ต้องมีขนาดไม่เกิน 10MB';
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
          this.billErrorMessage = 'อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
          this.isUploadingBill = false;
        },
      });
  }

  removeBillFile(): void {
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
          this.billErrorMessage = 'ลบไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
          this.isUploadingBill = false;
        },
      });
  }
}
