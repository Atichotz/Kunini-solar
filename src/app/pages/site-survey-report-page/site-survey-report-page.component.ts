import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { CustomerService } from '../../services/customer.service';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

type PhotoSlot = 'bill' | 'drone' | 'roofSurface' | 'shading' | 'mdb' | 'inverterWall' | 'cableRouting';

// รูปที่เพิ่งเลือก/ลากมา — preview ในเครื่องเท่านั้น ไม่มีการอัปโหลดจริง (หน้านี้ยังไม่ต่อ backend)
interface StagedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

interface LayoutOption {
  id: string;
  title: string;
  estimatedCapacity: string;
  orientation: string;
  designRationale: string;
  sketchPhotos: StagedPhoto[];
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

@Component({
  selector: 'app-site-survey-report-page',
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, DatePickerModule, SelectModule],
  templateUrl: './site-survey-report-page.component.html',
  styleUrl: './site-survey-report-page.component.scss',
})
export class SiteSurveyReportPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly customerService = inject(CustomerService);

  // customer id จาก query param — Survey Report ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน report-page)
  customerId: string | null = null;

  isLoadingCustomer = false;
  loadErrorMessage = '';

  readonly tariffOptions = TARIFF_OPTIONS;
  readonly electricalPhaseOptions = ELECTRICAL_PHASE_OPTIONS;
  readonly roofMaterialOptions = ROOF_MATERIAL_OPTIONS;

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

  photosBySlot: Record<PhotoSlot, StagedPhoto[]> = {
    bill: [],
    drone: [],
    roofSurface: [],
    shading: [],
    mdb: [],
    inverterWall: [],
    cableRouting: [],
  };

  // ===== 4. PV Layout Suggestions =====
  layoutOptions: LayoutOption[] = [];

  // ===== 5. Notes & Remarks =====
  clientNotes = '';
  notesForCustomer = '';
  internalNotes = '';

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
    this.layoutOptions = [this.newLayoutOption()];
  }

  // ล้าง blob URL ของรูป preview ที่ค้างไว้ทั้งหมด กัน memory leak ตอนออกจากหน้า
  ngOnDestroy(): void {
    Object.values(this.photosBySlot)
      .flat()
      .forEach((p) => URL.revokeObjectURL(p.previewUrl));
    this.layoutOptions.forEach((option) => option.sketchPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl)));
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
    };
  }

  addLayoutOption(): void {
    this.layoutOptions.push(this.newLayoutOption());
  }

  removeLayoutOption(option: LayoutOption): void {
    option.sketchPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    this.layoutOptions = this.layoutOptions.filter((o) => o.id !== option.id);
  }

  onLayoutPhotoFilesSelected(option: LayoutOption, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    this.stagePhotos(option.sketchPhotos, files);
  }

  onLayoutPhotoDrop(option: LayoutOption, event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    this.stagePhotos(option.sketchPhotos, files);
  }

  removeLayoutPhoto(option: LayoutOption, photo: StagedPhoto): void {
    URL.revokeObjectURL(photo.previewUrl);
    option.sketchPhotos = option.sketchPhotos.filter((p) => p.id !== photo.id);
  }

  // ===== Save (placeholder — ยังไม่เชื่อมฐานข้อมูล) =====

  saveDraft(): void {
    this.hasSavedLocally = true;
  }

  exportToPdf(): void {
    window.print();
  }
}
