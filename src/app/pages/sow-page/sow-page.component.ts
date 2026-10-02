import { Component, DestroyRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DatePickerModule } from 'primeng/datepicker';
import { ImageModule } from 'primeng/image';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
import { CustomerService } from '../../services/customer.service';
import { SowService } from '../../services/sow.service';
import {
  SOW_DAY_STATUSES,
  type SaveSowPayload,
  type SowDayStatus,
  type SowDetail,
  type SowMachineryFlags,
  type SowPhoto,
  type SowWeather,
} from '../../dto/sow.dto';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

// serverId = null → ยังไม่เคยบันทึก (ส่งไป backend โดยไม่มี id = สร้างใหม่); id = key ฝั่ง client ใช้กับ track/ลบรายการเท่านั้น
interface TaskRow {
  id: string;
  serverId: string | null;
  text: string;
}

interface DayPlan {
  id: string;
  serverId: string | null;
  date: Date | null;
  status: SowDayStatus;
  headcount: number | null;
  leadTech: string;
  subcontractorNotes: string;
  machinery: SowMachineryFlags;
  machineryNotes: string;
  tasks: TaskRow[];
}

// รูปที่เพิ่งเลือก/ลากมา — preview ในเครื่อง จะอัปโหลดตอนกด Save (หลัง EOD report นั้นมี id จริงแล้ว)
interface StagedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

interface EodReport {
  id: string;
  serverId: string | null;
  date: Date | null;
  weather: SowWeather;
  progressNotes: string;
  // รูปที่อัปโหลดแล้ว (มี signed URL) กับรูปที่รออัปโหลดแยกกัน เพราะลบคนละแบบ (ลบที่ server vs ลบในเครื่อง)
  savedPhotos: SowPhoto[];
  photos: StagedPhoto[];
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

@Component({
  selector: 'app-sow-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    ConfirmDialogModule,
    DatePickerModule,
    ImageModule,
    SelectModule,
    TabsModule,
    KLoadingComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './sow-page.component.html',
  styleUrl: './sow-page.component.scss',
})
export class SowPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customerService = inject(CustomerService);
  private readonly sowService = inject(SowService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // customer id จาก query param — SOW ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน site-survey-report-page)
  customerId: string | null = null;
  // sow id จาก query param — ไม่มี = SOW ใหม่ (สร้างตอนกด Save ครั้งแรก แล้ว URL จะถูกเติม sowId)
  sowId: string | null = null;

  isLoadingCustomer = false;
  isLoadingSow = false;
  isSaving = false;
  // กันกดลบรูปซ้ำระหว่างรอ server
  removingPhotoId: string | null = null;
  // true เมื่อ PUT โดน 409 (มีคนอื่น save ไปก่อน) — โชว์ปุ่ม Reload latest
  isConflict = false;

  loadErrorMessage = '';
  saveErrorMessage = '';
  photoErrorMessage = '';
  saveNotice = '';

  // true เมื่อ save นี้ถูกเริ่มจากปุ่ม Export to PDF — save สำเร็จครบ (รวมรูป) แล้วค่อยไปหน้า preview; ล้มเหลวที่ไหนก็ล้างค่านี้ ไม่ให้ Save ครั้งหน้าเด้งไป preview เอง
  private exportAfterSave = false;

  customerName = '';
  location = '';
  // p-select [options] รับเฉพาะ array ที่แก้ไขได้ (ไม่รับ readonly) จึง spread ออกมา — ต้องเป็น field ค่าเดียว ห้ามเป็น getter ที่สร้าง array ใหม่ทุกรอบ (infinite change detection)
  readonly dayStatusOptions: SowDayStatus[] = [...SOW_DAY_STATUSES];

  startDate: Date | null = null;
  endDate: Date | null = null;
  customerNotes = '';
  finalNotes = '';

  days: DayPlan[] = [];
  eodReports: EodReport[] = [];

  // savedAt = token ส่งกลับเป็น expected_saved_at ตอน PUT (เปลี่ยนเฉพาะตอน save ฟอร์ม)
  // updatedAt/updatedBy = ใครแก้ล่าสุด รวมการแก้รูป — ใช้โชว์อย่างเดียว ห้ามเอาไปแทน savedAt
  private savedAt: string | null = null;
  createdAt: string | null = null;
  createdBy: string | null = null;
  updatedAt: string | null = null;
  updatedBy: string | null = null;

  get backLink(): string[] {
    return this.customerId ? ['/detail', this.customerId] : ['/dashboard'];
  }

  get startAfterEnd(): boolean {
    return !!this.startDate && !!this.endDate && this.startDate.getTime() > this.endDate.getTime();
  }

  // ปิดแท็บ/refresh ระหว่าง save → เตือนก่อน กัน SOW ถูกบันทึกครึ่งๆ กลางๆ (รูปยังอัปโหลดไม่ครบ)
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.isSaving) event.preventDefault();
  }

  ngOnInit(): void {
    this.customerId = this.route.snapshot.queryParamMap.get('customerId');
    this.sowId = this.route.snapshot.queryParamMap.get('sowId');

    if (!this.customerId) {
      this.loadErrorMessage = 'Customer not found. Please open this page from the customer detail page';
      return;
    }

    this.loadCustomer(this.customerId);

    if (this.sowId) {
      this.loadExistingSow(this.sowId);
    } else {
      this.addDay();
      this.addEodReport();
    }
  }

  // ล้าง blob URL ของรูป preview ที่ค้างไว้ กัน memory leak ตอนออกจากหน้า
  ngOnDestroy(): void {
    this.revokeAllStagedPreviews();
  }

  private loadCustomer(id: string): void {
    this.isLoadingCustomer = true;
    this.customerService
      .getOne(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (customer) => {
          this.customerName = customer.displayName ?? '';
          this.location = customer.fullAddress ?? '';
          this.isLoadingCustomer = false;
        },
        error: (err) => {
          console.error('[API] Failed to load customer for SOW:', err);
          // โหลด customer ไม่ได้ (เช่น id ผิด) — ยังเปิดหน้าได้ แค่ปล่อยชื่อ/ที่อยู่ว่าง
          this.isLoadingCustomer = false;
        },
      });
  }

  // input: SOW UUID / output: เติมฟอร์มจากข้อมูลใน server — 404 = ถูกลบไปแล้ว
  private loadExistingSow(id: string): void {
    this.isLoadingSow = true;
    this.sowService
      .getOne(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sow) => {
          this.applySowToForm(sow);
          this.isLoadingSow = false;
        },
        error: (err: HttpErrorResponse) => {
          console.error('[API] Failed to load SOW:', err);
          this.isLoadingSow = false;
          this.loadErrorMessage =
            err.status === 404
              ? 'This SOW was not found. It may have been deleted'
              : 'Failed to load the SOW. Please try again';
        },
      });
  }

  // กด Reload latest หลังโดน 409 — ทิ้งสิ่งที่แก้ค้างอยู่ทั้งหมดแล้วโหลดของ server มาแทน
  confirmReloadLatest(): void {
    if (!this.sowId) return;
    const id = this.sowId;
    this.confirmationService.confirm({
      header: 'Reload latest version',
      message: 'Your unsaved changes and photos waiting to upload will be discarded. Continue?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Reload',
      rejectLabel: 'Cancel',
      accept: () => {
        this.revokeAllStagedPreviews();
        this.clearStatusMessages();
        this.loadExistingSow(id);
      },
    });
  }

  // input: SOW จาก server / output: เขียนทุก field ในฟอร์มทับ (รูปที่รออัปโหลดถูกล้าง — ผู้เรียกต้องเก็บไว้เองถ้าจะคงไว้)
  private applySowToForm(sow: SowDetail): void {
    this.sowId = sow.id;
    this.customerId = sow.customerId;
    this.savedAt = sow.savedAt;
    this.createdAt = sow.createdAt;
    this.createdBy = sow.createdBy;
    this.updatedAt = sow.updatedAt;
    this.updatedBy = sow.updatedBy;

    this.startDate = parseDateOnly(sow.plannedStartDate);
    this.endDate = parseDateOnly(sow.estCompletionDate);
    this.customerNotes = sow.customerNotes ?? '';
    this.finalNotes = sow.finalNotes ?? '';

    this.days = sow.days.map((day) => ({
      id: nextId('day'),
      serverId: day.id,
      date: parseDateOnly(day.date),
      status: day.status,
      headcount: day.headcount,
      leadTech: day.leadTech ?? '',
      subcontractorNotes: day.subcontractorNotes ?? '',
      machinery: { ...day.machinery },
      machineryNotes: day.machineryNotes ?? '',
      tasks: day.tasks.map((task) => ({ id: nextId('task'), serverId: task.id, text: task.text })),
    }));

    this.eodReports = sow.eodReports.map((report) => ({
      id: nextId('eod'),
      serverId: report.id,
      date: parseDateOnly(report.date),
      weather: report.weather,
      progressNotes: report.progressNotes ?? '',
      savedPhotos: report.photos,
      photos: [],
    }));
  }

  private clearStatusMessages(): void {
    this.isConflict = false;
    this.saveErrorMessage = '';
    this.photoErrorMessage = '';
    this.saveNotice = '';
  }

  // ===== Days =====

  addDay(): void {
    const lastDate = this.days[this.days.length - 1]?.date ?? this.startDate;
    this.days.push({
      id: nextId('day'),
      serverId: null,
      date: lastDate,
      status: 'Pending',
      headcount: null,
      leadTech: '',
      subcontractorNotes: '',
      machinery: {
        scaffolding: false,
        mobileCrane: false,
        boomLift: false,
        fallProtection: false,
        generator: false,
      },
      machineryNotes: '',
      tasks: [],
    });
  }

  removeDay(day: DayPlan): void {
    this.days = this.days.filter((d) => d.id !== day.id);
  }

  dayLabel(index: number): string {
    return `Day ${index + 1}`;
  }

  addTask(day: DayPlan): void {
    day.tasks.push({ id: nextId('task'), serverId: null, text: '' });
  }

  // task ที่ยังว่าง (เพิ่งกด + Add Task) ลบทันทีไม่ต้องถาม — ถามเฉพาะ task ที่มีข้อความ กันกดพลาด
  removeTask(day: DayPlan, task: TaskRow): void {
    if (this.isSaving) return;

    if (task.text.trim() === '') {
      day.tasks = day.tasks.filter((t) => t.id !== task.id);
      return;
    }

    this.confirmationService.confirm({
      header: 'Delete task',
      message: `Delete task "${task.text.trim()}"? It is removed when you press Save.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        day.tasks = day.tasks.filter((t) => t.id !== task.id);
      },
    });
  }

  // input: ค่าจาก headcount input ที่อาจติดลบหรือเป็นทศนิยมถ้า user พิมพ์เอง — clamp ไม่ให้ต่ำกว่า 0 และตัดเป็นจำนวนเต็ม (backend รับเฉพาะ int)
  clampHeadcount(day: DayPlan): void {
    if (day.headcount === null) return;
    day.headcount = Math.max(0, Math.trunc(day.headcount));
  }

  // ===== EOD Reports =====

  addEodReport(): void {
    this.eodReports.push({
      id: nextId('eod'),
      serverId: null,
      date: null,
      weather: 'clear',
      progressNotes: '',
      savedPhotos: [],
      photos: [],
    });
  }

  // label คำนวณจากลำดับ ไม่เก็บใน DB — ลบ report กลางลิสต์แล้วเลขเรียงใหม่เอง
  eodLabel(index: number): string {
    return `Report: Day ${index + 1}`;
  }

  // ถามยืนยันเสมอ เพราะรูปที่อัปโหลดแล้วของ report นี้จะถูกลบตามตอนกด Save (backend soft delete)
  // input: report + index (ใช้โชว์ label ในข้อความ) / output: เอา report ออกจากฟอร์มหลังผู้ใช้กด Delete
  removeEodReport(report: EodReport, index: number): void {
    if (this.isSaving) return;

    const uploadedCount = report.savedPhotos.length;
    const photoWarning =
      uploadedCount > 0 ? ` Its ${uploadedCount} uploaded photo(s) will be deleted too.` : '';

    this.confirmationService.confirm({
      header: 'Delete EOD report',
      message: `Delete "${this.eodLabel(index)}"?${photoWarning} It is removed when you press Save.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        report.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        this.eodReports = this.eodReports.filter((r) => r.id !== report.id);
      },
    });
  }

  setWeather(report: EodReport, weather: SowWeather): void {
    report.weather = weather;
  }

  // ===== Photos =====

  onPhotoFilesSelected(report: EodReport, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    this.stagePhotos(report, files);
  }

  onPhotoDrop(report: EodReport, event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    this.stagePhotos(report, files);
  }

  // input: report + ไฟล์ที่ผู้ใช้เลือก / output: เพิ่มเฉพาะไฟล์ที่ผ่านเงื่อนไข และแจ้งชื่อไฟล์ที่ถูกข้าม (ไม่ข้ามเงียบๆ)
  private stagePhotos(report: EodReport, files: File[]): void {
    if (this.isSaving) return;

    const skipped: string[] = [];
    for (const file of files) {
      if (!PHOTO_ACCEPTED_TYPES.includes(file.type) || file.size > PHOTO_MAX_SIZE_BYTES) {
        skipped.push(file.name);
        continue;
      }
      report.photos.push({ id: nextId('photo'), file, previewUrl: URL.createObjectURL(file) });
    }

    this.photoErrorMessage = skipped.length
      ? `Skipped (only JPEG/PNG/WebP up to 10MB): ${skipped.join(', ')}`
      : '';
  }

  // รูปที่ยังไม่อัปโหลด → ลบในเครื่อง
  removePhoto(report: EodReport, photo: StagedPhoto): void {
    if (this.isSaving) return;
    URL.revokeObjectURL(photo.previewUrl);
    report.photos = report.photos.filter((p) => p.id !== photo.id);
  }

  // true ถ้า report นี้มีรูปแสดงอยู่ (ทั้งที่อัปโหลดแล้วและรออัปโหลด) — template ใช้สลับรูปแบบปุ่มอัปโหลด
  hasAnyPhoto(report: EodReport): boolean {
    return report.savedPhotos.length > 0 || report.photos.length > 0;
  }

  // รูปที่ save แล้ว → ถามยืนยันก่อน แล้วลบที่ server ทันที (soft delete) ไม่รอกด Save
  removeSavedPhoto(report: EodReport, photo: SowPhoto): void {
    const sowId = this.sowId;
    const reportId = report.serverId;
    if (this.isSaving || this.removingPhotoId || !sowId || !reportId) return;

    this.confirmationService.confirm({
      header: 'Delete photo',
      message: `Delete "${photo.fileName}"? This is saved immediately.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.removingPhotoId = photo.id;
        this.photoErrorMessage = '';
        this.sowService
          .removePhoto(sowId, reportId, photo.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (touch) => {
              this.removingPhotoId = null;
              this.updatedAt = touch.updatedAt;
              this.updatedBy = touch.updatedBy;
              report.savedPhotos = report.savedPhotos.filter((p) => p.id !== photo.id);
            },
            error: (err: HttpErrorResponse) => {
              this.removingPhotoId = null;
              // 404 = รูปนี้ถูกลบไปแล้ว (เช่นจากอีก tab) — เอาออกจากหน้าจอให้ตรงกับความจริง
              if (err.status === 404) {
                report.savedPhotos = report.savedPhotos.filter((p) => p.id !== photo.id);
                return;
              }
              console.error('[API] Failed to delete SOW photo:', err);
              this.photoErrorMessage = 'Failed to delete the photo. Please try again';
            },
          });
      },
    });
  }

  private revokeAllStagedPreviews(): void {
    this.eodReports.forEach((report) => report.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl)));
  }

  // ===== Save =====

  // input: ฟอร์มปัจจุบัน / output: payload สำหรับ POST/PUT — task ที่ว่างเปล่าถูกตัดทิ้ง (backend ไม่รับ text ว่าง)
  private buildPayload(customerId: string): SaveSowPayload {
    return {
      customer_id: customerId,
      ...(this.sowId && this.savedAt ? { expected_saved_at: this.savedAt } : {}),
      head: {
        planned_start_date: formatDateOnly(this.startDate),
        est_completion_date: formatDateOnly(this.endDate),
        customer_notes: blankToNull(this.customerNotes),
        final_notes: blankToNull(this.finalNotes),
      },
      days: this.days.map((day) => ({
        ...(day.serverId ? { id: day.serverId } : {}),
        day_date: formatDateOnly(day.date),
        status: day.status,
        headcount: day.headcount,
        lead_tech: blankToNull(day.leadTech),
        subcontractor_notes: blankToNull(day.subcontractorNotes),
        machinery: { ...day.machinery },
        machinery_notes: blankToNull(day.machineryNotes),
        tasks: day.tasks
          .map((task) => ({ serverId: task.serverId, text: task.text.trim() }))
          .filter((task) => task.text !== '')
          .map((task) => ({ ...(task.serverId ? { id: task.serverId } : {}), text: task.text })),
      })),
      eod_reports: this.eodReports.map((report) => ({
        ...(report.serverId ? { id: report.serverId } : {}),
        report_date: formatDateOnly(report.date),
        weather: report.weather,
        progress_notes: blankToNull(report.progressNotes),
      })),
    };
  }

  // บันทึก SOW (สร้างใหม่หรือแก้ทับทั้งก้อน) แล้วอัปโหลดรูป EOD ที่รออยู่ — ฟอร์มถูกล็อกด้วย overlay ตลอดจนเสร็จ
  saveSow(): void {
    if (this.isSaving || !this.customerId) return;
    if (this.startAfterEnd) {
      this.exportAfterSave = false;
      return;
    }

    this.clearStatusMessages();
    this.isSaving = true;

    const payload = this.buildPayload(this.customerId);
    const request$ =
      this.sowId && this.savedAt ? this.sowService.update(this.sowId, payload) : this.sowService.create(payload);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => this.onSaved(saved),
      error: (err: HttpErrorResponse) => this.onSaveFailed(err),
    });
  }

  private onSaved(saved: SowDetail): void {
    const wasNew = !this.sowId;

    // response เรียง EOD ตามลำดับเดียวกับ payload → จับคู่รูปที่รออัปโหลดกลับเข้า report เดิมด้วยตำแหน่ง
    const stagedByPosition = this.eodReports.map((report) => report.photos);
    this.applySowToForm(saved);
    this.eodReports.forEach((report, index) => {
      report.photos = stagedByPosition[index] ?? [];
    });

    // สร้างใหม่ครั้งแรก: ใส่ sowId ใน URL เพื่อให้ refresh แล้วเปิด SOW เดิม (ไม่ใช่ฟอร์มว่างที่ save แล้วได้ SOW ซ้ำ)
    if (wasNew) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { sowId: saved.id },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    this.uploadStagedPhotos(saved.id, wasNew);
  }

  // อัปโหลดรูปที่รออยู่ทีละรูป (เรียงตามลำดับ ไม่ยิงพร้อมกันเพื่อไม่ให้ server รับหนักและ error ระบุไฟล์ได้ชัด)
  // รูปที่อัปโหลดไม่สำเร็จคงไว้ในลิสต์ "รออัปโหลด" ให้กด Save ซ้ำเพื่อลองใหม่
  private uploadStagedPhotos(sowId: string, wasNew: boolean): void {
    const uploads = this.eodReports.flatMap((report) =>
      report.serverId ? report.photos.map((photo) => ({ report, reportId: report.serverId as string, photo })) : [],
    );

    if (uploads.length === 0) {
      this.finishSave([], wasNew);
      return;
    }

    from(uploads)
      .pipe(
        concatMap(({ report, reportId, photo }) =>
          this.sowService.uploadPhoto(sowId, reportId, photo.file).pipe(
            map((result) => {
              URL.revokeObjectURL(photo.previewUrl);
              report.photos = report.photos.filter((p) => p.id !== photo.id);
              report.savedPhotos = [...report.savedPhotos, result.photo];
              // ใช้เฉพาะ updatedAt/updatedBy โชว์ "แก้ล่าสุด" — ไม่แตะ savedAt
              this.updatedAt = result.updatedAt;
              this.updatedBy = result.updatedBy;
              return null;
            }),
            catchError((err: unknown) => {
              console.error('[API] Failed to upload SOW photo:', err);
              return of(photo.file.name);
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

  // input: ชื่อไฟล์ที่อัปโหลดพลาด + wasNew (save ครั้งแรกของ SOW นี้หรือไม่)
  // output: มีรูปพลาด → อยู่หน้าเดิมให้กด Save ซ้ำ (ไม่พาออกเพราะรูปจะหาย) / save ครั้งแรกสำเร็จ → กลับหน้า customer /
  //         แก้ของเดิมสำเร็จ → ถามว่าจะอยู่ต่อหรือกลับหน้า customer (เหมือน estimate-page)
  private finishSave(failedFileNames: string[], wasNew: boolean): void {
    this.isSaving = false;
    if (failedFileNames.length > 0) {
      // รูปที่อัปโหลดไม่ผ่านจะหายจาก PDF — หยุดอยู่หน้าฟอร์มให้ผู้ใช้กด Save ซ้ำก่อน
      this.exportAfterSave = false;
      this.photoErrorMessage = `SOW saved, but ${failedFileNames.length} photo(s) failed to upload: ${failedFileNames.join(', ')}. Press Save again to retry`;
      return;
    }

    this.saveNotice = 'Saved';

    if (this.exportAfterSave && this.sowId) {
      this.exportAfterSave = false;
      void this.router.navigate(['/sow-pdf'], { queryParams: { sowId: this.sowId } });
      return;
    }

    if (wasNew) {
      void this.router.navigate(this.backLink);
      return;
    }

    this.confirmationService.confirm({
      header: 'SOW Saved',
      message: 'Your SOW has been saved. Go back to the customer page, or stay here?',
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
    console.error('[API] Failed to save SOW:', err);

    if (err.status === 409) {
      this.isConflict = true;
      this.saveErrorMessage =
        'This SOW was saved by someone else after you opened it. Nothing was overwritten. Reload the latest version before saving again';
    } else if (err.status === 404) {
      this.saveErrorMessage = 'This SOW (or one of its days/reports) no longer exists. It may have been deleted by someone else';
    } else if (err.status === 400) {
      this.saveErrorMessage = `Some values are not valid: ${describeBadRequest(err)}`;
    } else {
      this.saveErrorMessage = 'Failed to save the SOW. Please try again';
    }
  }

  // PDF พรีวิวดึงจาก SOW ที่ save แล้ว (ไม่ใช่สถานะฟอร์มสด) จึง save ก่อนทุกครั้ง เพื่อให้ PDF ตรงกับหน้าจอและรูป Pending ถูกอัปโหลดแล้ว
  exportToPdf(): void {
    if (this.isSaving || !this.customerId || this.startAfterEnd) return;
    this.exportAfterSave = true;
    this.saveSow();
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

// input: 'YYYY-MM-DD' / output: Date เที่ยงคืนตามเวลาท้องถิ่น กันเลื่อนวันเหมือน new Date('YYYY-MM-DD') ที่ตีเป็น UTC
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
