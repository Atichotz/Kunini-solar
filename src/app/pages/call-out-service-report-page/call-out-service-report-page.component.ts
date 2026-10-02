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
import { catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
import { CustomerService } from '../../services/customer.service';
import { CallOutServiceReportService } from '../../services/call-out-service-report.service';
import {
  CALL_OUT_PHOTO_SLOTS,
  type CallOutPhotoSlot,
  type CallOutResolutionStatus,
  type CallOutServiceReportDetail,
  type CallOutServiceReportPhoto,
  type SaveCallOutServiceReportPayload,
} from '../../dto/call-out-service-report.dto';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

type PhotoSlot = CallOutPhotoSlot;

// รูปในฟอร์ม 2 แบบ: staged (มี file, previewUrl เป็น blob URL — อัปโหลดตอนกด Save) กับ saved (มี serverId, previewUrl เป็น signed URL)
interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string;
  file?: File;
  serverId?: string;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

@Component({
  selector: 'app-call-out-service-report-page',
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, ConfirmDialogModule, DatePickerModule, ImageModule, KLoadingComponent],
  providers: [ConfirmationService],
  templateUrl: './call-out-service-report-page.component.html',
  styleUrl: './call-out-service-report-page.component.scss',
})
export class CallOutServiceReportPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customerService = inject(CustomerService);
  private readonly reportService = inject(CallOutServiceReportService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // customer id จาก query param — Call Out Service Report ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน survey-report)
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

  // ===== 1. Customer & Service Details =====
  customerName = '';
  siteAddress = '';
  callOutDateTime: Date | null = null;
  resolutionDate: Date | null = null;
  systemSizeType = '';
  inverterModel = '';
  reportedErrorCode = '';

  // ===== 2. Issue & On-site Inspection =====
  callOutReason = '';
  inspectionFindings = '';

  // ===== 3. Action Taken & Result =====
  actionsTaken = '';
  materialsUsed = '';
  resultStatusNote = '';
  resolutionStatus: CallOutResolutionStatus = 'resolved';

  photosBySlot: Record<PhotoSlot, PhotoItem[]> = this.emptyPhotosBySlot();

  // ===== 4. Sign-Off & Approvals =====
  engineerName = '';
  engineerSignDate: Date | null = null;
  customerSignName = '';
  customerSignDate: Date | null = null;

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
    return Object.fromEntries(CALL_OUT_PHOTO_SLOTS.map((slot) => [slot, []])) as unknown as Record<PhotoSlot, PhotoItem[]>;
  }

  private revokeAllStagedPreviews(): void {
    for (const photo of Object.values(this.photosBySlot).flat()) this.revokeIfStaged(photo);
  }

  private revokeIfStaged(photo: PhotoItem): void {
    if (photo.file) URL.revokeObjectURL(photo.previewUrl);
  }

  private loadCustomer(id: string): void {
    this.isLoadingCustomer = true;
    this.customerService.getOne(id).subscribe({
      next: (customer) => {
        this.customerName = customer.displayName ?? '';
        this.siteAddress = customer.fullAddress ?? '';
        this.isLoadingCustomer = false;
      },
      error: (err) => {
        console.error('[API] Failed to load customer for Call Out Service Report:', err);
        // โหลด customer ไม่ได้ (เช่น id ผิด) — ยังเปิดหน้าได้ แค่ปล่อยชื่อ/ที่อยู่ให้กรอกเอง
        this.isLoadingCustomer = false;
      },
    });
  }

  // ===== โหลด report เดิม =====

  // input: report UUID — report จะ override ทุก field ในฟอร์ม (รวมชื่อ/ที่อยู่ลูกค้าที่เป็น snapshot ตอน save) — ไม่โหลด customer ซ้ำ
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
          console.error('[API] Failed to load call out service report:', err);
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
  private applyReportToForm(r: CallOutServiceReportDetail): void {
    this.customerId = r.customerId;
    this.customerName = r.customerName ?? '';
    this.siteAddress = r.siteAddress ?? '';
    this.callOutDateTime = r.callOutDateTime ? new Date(r.callOutDateTime) : null;
    this.resolutionDate = parseDateOnly(r.resolutionDate);
    this.systemSizeType = r.systemSizeType ?? '';
    this.inverterModel = r.inverterModel ?? '';
    this.reportedErrorCode = r.reportedErrorCode ?? '';

    this.callOutReason = r.callOutReason ?? '';
    this.inspectionFindings = r.inspectionFindings ?? '';

    this.actionsTaken = r.actionsTaken ?? '';
    this.materialsUsed = r.materialsUsed ?? '';
    this.resultStatusNote = r.resultStatusNote ?? '';
    this.resolutionStatus = r.resolutionStatus;

    this.engineerName = r.engineerName ?? '';
    this.engineerSignDate = parseDateOnly(r.engineerSignDate);
    this.customerSignName = r.customerSignName ?? '';
    this.customerSignDate = parseDateOnly(r.customerSignDate);

    this.photosBySlot = this.emptyPhotosBySlot();
    for (const slot of CALL_OUT_PHOTO_SLOTS) {
      this.photosBySlot[slot] = r.photosBySlot[slot].map((p) => this.toSavedPhotoItem(p));
    }

    this.applyMeta(r);
  }

  private applyMeta(r: CallOutServiceReportDetail): void {
    this.reportId = r.id;
    this.savedAt = r.savedAt;
    this.createdAt = r.createdAt;
    this.createdBy = r.createdBy;
    this.updatedAt = r.updatedAt;
    this.updatedBy = r.updatedBy;
  }

  private toSavedPhotoItem(photo: CallOutServiceReportPhoto): PhotoItem {
    return { id: `saved-${photo.id}`, serverId: photo.id, name: photo.fileName, previewUrl: photo.url };
  }

  // input: วันที่ใหม่ของ Engineer / output: ตั้งวันที่ Customer ตาม ถ้ายังว่างหรือยังตรงกับวันเดิมของ Engineer (ยังไม่ถูกแก้แยก)
  // ถ้าผู้ใช้แก้ฝั่ง Customer เป็นอีกวันแล้ว จะไม่ถูกทับ — ใช้ onModelChange แทน [(ngModel)] เพื่อเห็นค่าเดิมก่อนเปลี่ยน
  onEngineerSignDateChange(next: Date | null): void {
    const customerFollowsEngineer =
      this.customerSignDate === null || formatDateOnly(this.customerSignDate) === formatDateOnly(this.engineerSignDate);
    this.engineerSignDate = next;
    if (customerFollowsEngineer && next) this.customerSignDate = next;
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

  // รูปที่ยังไม่อัปโหลด → ลบในเครื่องทันที / รูปที่ save แล้ว → ถามยืนยันก่อน แล้วลบที่ server ทันที (soft delete)
  removePhoto(slot: PhotoSlot, photo: PhotoItem): void {
    if (this.isSaving) return;

    const removeFromView = (): void => {
      this.photosBySlot[slot] = this.photosBySlot[slot].filter((p) => p.id !== photo.id);
    };

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
              console.error('[API] Failed to delete call out service report photo:', err);
              this.photoErrorMessage = 'Failed to delete the photo. Please try again';
            },
          });
      },
    });
  }

  // true ระหว่างรอ server ลบรูปนี้ — ใช้ disable ปุ่มลบ
  isPhotoRemoving(photo: PhotoItem): boolean {
    return photo.serverId !== undefined && this.removingPhotoId === photo.serverId;
  }

  // input: ลิสต์ปลายทาง + ไฟล์ที่ผู้ใช้เลือก / output: เพิ่มเฉพาะไฟล์ที่ผ่านเงื่อนไข และแจ้งชื่อไฟล์ที่ถูกข้าม
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

  // ===== Save =====

  private clearStatusMessages(): void {
    this.saveNotice = '';
    this.saveErrorMessage = '';
    this.isConflict = false;
    this.photoErrorMessage = '';
  }

  // output: payload ที่ประกอบทีละ field — ไม่ spread object ฝั่ง client เพราะ backend (forbidNonWhitelisted) ปฏิเสธ field แปลกปลอม
  // สตริงว่าง → null เพื่อให้ตรงกับ "ยังไม่กรอก" และไม่ติด validator ของ field วันที่
  private buildPayload(customerId: string): SaveCallOutServiceReportPayload {
    return {
      customer_id: customerId,
      ...(this.reportId && this.savedAt ? { expected_saved_at: this.savedAt } : {}),
      head: {
        customer_name: blankToNull(this.customerName),
        site_address: blankToNull(this.siteAddress),
        call_out_date_time: this.callOutDateTime ? this.callOutDateTime.toISOString() : null,
        resolution_date: formatDateOnly(this.resolutionDate),
        system_size_type: blankToNull(this.systemSizeType),
        inverter_model: blankToNull(this.inverterModel),
        reported_error_code: blankToNull(this.reportedErrorCode),

        call_out_reason: blankToNull(this.callOutReason),
        inspection_findings: blankToNull(this.inspectionFindings),

        actions_taken: blankToNull(this.actionsTaken),
        materials_used: blankToNull(this.materialsUsed),
        result_status_note: blankToNull(this.resultStatusNote),
        resolution_status: this.resolutionStatus,

        engineer_name: blankToNull(this.engineerName),
        engineer_sign_date: formatDateOnly(this.engineerSignDate),
        customer_sign_name: blankToNull(this.customerSignName),
        customer_sign_date: formatDateOnly(this.customerSignDate),
      },
    };
  }

  // กด Save: บันทึกฟอร์ม (POST ถ้ายังไม่มี report, ไม่งั้น PUT) → อัปโหลดรูปที่ค้างอยู่ทีละรูป
  saveReport(): void {
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

  private onFormSaved(saved: CallOutServiceReportDetail): void {
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
  private mergeSavedPhotos(saved: CallOutServiceReportDetail): void {
    for (const slot of CALL_OUT_PHOTO_SLOTS) {
      const staged = this.photosBySlot[slot].filter((p) => p.file);
      this.photosBySlot[slot] = [...saved.photosBySlot[slot].map((p) => this.toSavedPhotoItem(p)), ...staged];
    }
  }

  // อัปโหลดรูปที่ค้างอยู่ทีละรูป (ไม่ขนาน) — รูปไหนพลาดยังค้างไว้ให้กด Save ใหม่ ไม่ทำให้รูปอื่นหรือการบันทึกฟอร์มเสียไป
  private uploadStagedPhotos(reportId: string, wasNew: boolean): void {
    const tasks = CALL_OUT_PHOTO_SLOTS.flatMap((slot) =>
      this.photosBySlot[slot].filter((p) => p.file).map((photo) => ({ slot, photo })),
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
              this.photosBySlot[slot] = this.photosBySlot[slot].map((p) => (p.id === photo.id ? savedItem : p));
              // ใช้เฉพาะ updatedAt/updatedBy ของผลอัปโหลดโชว์ "แก้ล่าสุด" — ไม่แตะ savedAt
              this.updatedAt = result.updatedAt;
              this.updatedBy = result.updatedBy;
              return null;
            }),
            catchError((err: HttpErrorResponse) => {
              console.error('[API] Failed to upload call out service report photo:', err);
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
  // output: พลาด → อยู่หน้าเดิมให้กด Save ซ้ำ / save ครั้งแรกสำเร็จ → กลับหน้า customer /
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
      void this.router.navigate(['/call-out-service-report-pdf'], { queryParams: { reportId: this.reportId } });
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
    console.error('[API] Failed to save call out service report:', err);

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
