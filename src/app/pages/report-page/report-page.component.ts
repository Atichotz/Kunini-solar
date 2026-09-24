import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { CustomerService } from '../../services/customer.service';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

type PhotoSlot = 'sld' | 'roof' | 'equipment';
type SerialGroup = 'inverter' | 'battery' | 'panel' | 'optimizer';

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
  selector: 'app-report-page',
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, DatePickerModule],
  templateUrl: './report-page.component.html',
  styleUrl: './report-page.component.scss',
})
export class ReportPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly customerService = inject(CustomerService);

  // customer id จาก query param — Report ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน sow-page)
  customerId: string | null = null;

  isLoadingCustomer = false;
  loadErrorMessage = '';

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

  inverterSerials: SerialEntry[] = [];
  batterySerials: SerialEntry[] = [];
  panelSerials: SerialEntry[] = [];
  optimizerSerials: SerialEntry[] = [];

  sldPhotos: StagedPhoto[] = [];
  roofPhotos: StagedPhoto[] = [];
  equipmentPhotos: StagedPhoto[] = [];

  nextMaintenanceDate: Date | null = null;

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
    this.seedDefaults();
  }

  // ล้าง blob URL ของรูป preview ที่ค้างไว้ กัน memory leak ตอนออกจากหน้า
  ngOnDestroy(): void {
    [...this.sldPhotos, ...this.roofPhotos, ...this.equipmentPhotos].forEach((p) =>
      URL.revokeObjectURL(p.previewUrl),
    );
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
    this.dcStrings = [this.newDcStringRow(), this.newDcStringRow()];
    this.acPhases = [
      { id: nextId('ac'), phase: 'L1', ampReading: '', voltageReading: '' },
      { id: nextId('ac'), phase: 'L2', ampReading: '', voltageReading: '' },
      { id: nextId('ac'), phase: 'L3', ampReading: '', voltageReading: '' },
    ];
    this.checklist = [
      { id: nextId('chk'), label: 'Visual Inspection of the System and PV Array', checked: false },
      { id: nextId('chk'), label: "Check CT's + All Cables (PV + Power)", checked: false },
      { id: nextId('chk'), label: 'Check Phase Sequence', checked: false },
      { id: nextId('chk'), label: 'Check Grounding', checked: false },
      { id: nextId('chk'), label: 'Clean Solar Inverter, Combiner Box & Equipment', checked: false },
      { id: nextId('chk'), label: 'Clean Solar Panels', checked: false },
      { id: nextId('chk'), label: 'Test the Solar App + Internet Connection', checked: false },
      { id: nextId('chk'), label: 'Test Backup Loads (Hybrid) - power off utility 10 mins', checked: false },
      { id: nextId('chk'), label: 'Test ATS (Hybrid) - shut down solar inverter', checked: false },
    ];
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

  // ===== Photos (local preview only — ไม่มีการอัปโหลดจริง) =====

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

  private stagePhotos(slot: PhotoSlot, files: File[]): void {
    const target = this.photosFor(slot);
    for (const file of files) {
      if (!PHOTO_ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > PHOTO_MAX_SIZE_BYTES) continue;
      target.push({ id: nextId('photo'), file, previewUrl: URL.createObjectURL(file) });
    }
  }

  removePhoto(slot: PhotoSlot, photo: StagedPhoto): void {
    URL.revokeObjectURL(photo.previewUrl);
    this.setPhotosFor(
      slot,
      this.photosFor(slot).filter((p) => p.id !== photo.id),
    );
  }

  photosFor(slot: PhotoSlot): StagedPhoto[] {
    if (slot === 'sld') return this.sldPhotos;
    if (slot === 'roof') return this.roofPhotos;
    return this.equipmentPhotos;
  }

  private setPhotosFor(slot: PhotoSlot, photos: StagedPhoto[]): void {
    if (slot === 'sld') this.sldPhotos = photos;
    else if (slot === 'roof') this.roofPhotos = photos;
    else this.equipmentPhotos = photos;
  }

  // ===== Save (placeholder — ยังไม่เชื่อมฐานข้อมูล) =====

  saveDraft(): void {
    this.hasSavedLocally = true;
  }

  exportToPdf(): void {
    window.print();
  }
}
