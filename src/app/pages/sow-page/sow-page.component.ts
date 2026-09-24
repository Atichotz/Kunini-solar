import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { TabsModule } from 'primeng/tabs';
import { CustomerService } from '../../services/customer.service';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;
type Weather = 'clear' | 'overcast' | 'rain';

interface MachineryFlags {
  scaffolding: boolean;
  mobileCrane: boolean;
  boomLift: boolean;
  fallProtection: boolean;
  generator: boolean;
}

interface SowTask {
  id: string;
  text: string;
}

interface DayPlan {
  id: string;
  date: Date | null;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Delayed';
  headcount: number | null;
  leadTech: string;
  subcontractorNotes: string;
  machinery: MachineryFlags;
  machineryNotes: string;
  tasks: SowTask[];
}

// รูปที่เพิ่งเลือก/ลากมา — preview ในเครื่องเท่านั้น ไม่มีการอัปโหลดจริง (หน้านี้ยังไม่ต่อ backend)
interface StagedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

interface EodReport {
  id: string;
  dayLabel: string;
  date: Date | null;
  weather: Weather;
  progressNotes: string;
  photos: StagedPhoto[];
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

@Component({
  selector: 'app-sow-page',
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, DatePickerModule, TabsModule],
  templateUrl: './sow-page.component.html',
  styleUrl: './sow-page.component.scss',
})
export class SowPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly customerService = inject(CustomerService);
  private readonly destroyRef = inject(DestroyRef);

  // customer id จาก query param — SOW ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้ (เหมือน survey-page)
  customerId: string | null = null;

  isLoadingCustomer = false;
  loadErrorMessage = '';

  customerName = '';
  location = '';
  startDate: Date | null = null;
  endDate: Date | null = null;
  customerNotes = '';
  finalNotes = '';

  days: DayPlan[] = [];
  eodReports: EodReport[] = [];

  // หน้านี้ยังไม่เชื่อมฐานข้อมูล — Save เก็บได้แค่ flag ในเครื่อง ข้อมูลหายเมื่อ reload/ออกจากหน้า
  hasSavedLocally = false;

  get backLink(): string[] {
    return this.customerId ? ['/detail', this.customerId] : ['/dashboard'];
  }

  get startAfterEnd(): boolean {
    return !!this.startDate && !!this.endDate && this.startDate.getTime() > this.endDate.getTime();
  }

  ngOnInit(): void {
    this.customerId = this.route.snapshot.queryParamMap.get('customerId');

    if (!this.customerId) {
      this.loadErrorMessage = 'Customer not found. Please open this page from the customer detail page';
      return;
    }

    this.loadCustomer(this.customerId);
    this.addDay();
    this.addEodReport();
  }

  // ล้าง blob URL ของรูป preview ที่ค้างไว้ กัน memory leak ตอนออกจากหน้า
  ngOnDestroy(): void {
    this.eodReports.forEach((report) => report.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl)));
  }

  private loadCustomer(id: string): void {
    this.isLoadingCustomer = true;
    this.customerService.getOne(id).subscribe({
      next: (customer) => {
        this.customerName = customer.displayName ?? '';
        this.location = customer.fullAddress ?? '';
        this.isLoadingCustomer = false;
      },
      error: (err) => {
        console.error('[API] Failed to load customer for SOW:', err);
        // โหลด customer ไม่ได้ (เช่น id ผิด) — ยังเปิดหน้าได้ แค่ปล่อยชื่อ/ที่อยู่ให้กรอกเอง
        this.isLoadingCustomer = false;
      },
    });
  }

  // ===== Days =====

  addDay(): void {
    const lastDate = this.days[this.days.length - 1]?.date ?? this.startDate;
    this.days.push({
      id: nextId('day'),
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
    day.tasks.push({ id: nextId('task'), text: '' });
  }

  removeTask(day: DayPlan, task: SowTask): void {
    day.tasks = day.tasks.filter((t) => t.id !== task.id);
  }

  // input: ค่าจาก headcount input ที่อาจติดลบถ้า user พิมพ์เอง — clamp ไม่ให้ต่ำกว่า 0
  clampHeadcount(day: DayPlan): void {
    if (day.headcount !== null && day.headcount < 0) day.headcount = 0;
  }

  // ===== EOD Reports =====

  addEodReport(): void {
    this.eodReports.push({
      id: nextId('eod'),
      dayLabel: `Report: Day ${this.eodReports.length + 1}`,
      date: null,
      weather: 'clear',
      progressNotes: '',
      photos: [],
    });
  }

  removeEodReport(report: EodReport): void {
    report.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    this.eodReports = this.eodReports.filter((r) => r.id !== report.id);
  }

  setWeather(report: EodReport, weather: Weather): void {
    report.weather = weather;
  }

  // ===== Photos (local preview only — ไม่มีการอัปโหลดจริง) =====

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

  private stagePhotos(report: EodReport, files: File[]): void {
    for (const file of files) {
      if (!PHOTO_ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > PHOTO_MAX_SIZE_BYTES) continue;
      report.photos.push({ id: nextId('photo'), file, previewUrl: URL.createObjectURL(file) });
    }
  }

  removePhoto(report: EodReport, photo: StagedPhoto): void {
    URL.revokeObjectURL(photo.previewUrl);
    report.photos = report.photos.filter((p) => p.id !== photo.id);
  }

  // ===== Save (placeholder — ยังไม่เชื่อมฐานข้อมูล) =====

  saveDraft(): void {
    this.hasSavedLocally = true;
  }

  exportToPdf(): void {
    window.print();
  }
}
