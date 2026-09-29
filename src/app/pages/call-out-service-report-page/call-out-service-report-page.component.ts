import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { CustomerService } from '../../services/customer.service';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

type PhotoSlot = 'preWork1' | 'preWork2' | 'postWork1' | 'postWork2';
type ResolutionStatus = 'resolved' | 'monitoring' | 'unresolved';

// รูปที่เพิ่งเลือก/ลากมา — preview ในเครื่องเท่านั้น ไม่มีการอัปโหลดจริง (หน้านี้ยังไม่ต่อ backend)
interface StagedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

@Component({
  selector: 'app-call-out-service-report-page',
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, DatePickerModule],
  templateUrl: './call-out-service-report-page.component.html',
  styleUrl: './call-out-service-report-page.component.scss',
})
export class CallOutServiceReportPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly customerService = inject(CustomerService);

  // customer id จาก query param — Call Out Service Report ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน survey-report)
  customerId: string | null = null;

  isLoadingCustomer = false;
  loadErrorMessage = '';

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
  resolutionStatus: ResolutionStatus = 'resolved';

  photosBySlot: Record<PhotoSlot, StagedPhoto[]> = {
    preWork1: [],
    preWork2: [],
    postWork1: [],
    postWork2: [],
  };

  // ===== 4. Sign-Off & Approvals =====
  engineerName = '';
  engineerSignDate: Date | null = null;
  customerSignName = '';
  customerSignDate: Date | null = null;

  // หน้านี้ยังไม่เชื่อมฐานข้อมูล — Save เก็บได้แค่ flag ในเครื่อง ข้อมูลหายเมื่อ reload/ออกจากหน้า
  hasSavedLocally = false;

  get backLink(): string[] {
    return this.customerId ? ['/detail', this.customerId] : ['/dashboard'];
  }

  ngOnInit(): void {
    this.customerId = this.route.snapshot.queryParamMap.get('customerId');

    if (!this.customerId) {
      this.loadErrorMessage = 'Customer not found. Please open this page from the customer detail page';
      return;
    }

    this.loadCustomer(this.customerId);
  }

  // ล้าง blob URL ของรูป preview ที่ค้างไว้ทั้งหมด กัน memory leak ตอนออกจากหน้า
  ngOnDestroy(): void {
    Object.values(this.photosBySlot)
      .flat()
      .forEach((p) => URL.revokeObjectURL(p.previewUrl));
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

  // ===== Photos (slot-based, local preview only — ไม่มีการอัปโหลดจริง) =====

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

  removePhoto(slot: PhotoSlot, photo: StagedPhoto): void {
    URL.revokeObjectURL(photo.previewUrl);
    this.photosBySlot[slot] = this.photosBySlot[slot].filter((p) => p.id !== photo.id);
  }

  private stagePhotos(target: StagedPhoto[], files: File[]): void {
    for (const file of files) {
      if (!PHOTO_ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > PHOTO_MAX_SIZE_BYTES) continue;
      target.push({ id: nextId('photo'), file, previewUrl: URL.createObjectURL(file) });
    }
  }

  // ===== Save (placeholder — ยังไม่เชื่อมฐานข้อมูล) =====

  saveDraft(): void {
    this.hasSavedLocally = true;
  }

  exportToPdf(): void {
    window.print();
  }
}
