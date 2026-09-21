import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SurveyService } from '../../services/survey.service';
import type { SurveyDetail, SurveyNote, SurveyPhoto } from '../../dto/survey.dto';

const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;

// รูปที่เพิ่งเลือก/ลากมา — โชว์ preview ในเครื่องก่อน ยังไม่ยิงอัปโหลดจนกว่าจะกด "Save Photos"
interface StagedPhoto {
  file: File;
  previewUrl: string;
}

@Component({
  selector: 'app-survey-page',
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule],
  templateUrl: './survey-page.component.html',
  styleUrl: './survey-page.component.scss',
})
export class SurveyPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly surveyService = inject(SurveyService);
  private readonly destroyRef = inject(DestroyRef);

  // customer id จาก query param — survey ต้องผูกกับลูกค้าเสมอ ไม่มีแล้วเปิดหน้าไม่ได้
  customerId: string | null = null;
  // survey id — มีตอนเปิด survey เดิมกลับมาดู/แก้ (?surveyId= มาจาก Survey History เท่านั้น)
  surveyId: string | null = null;

  isLoading = false;
  loadErrorMessage = '';

  photos: SurveyPhoto[] = [];
  notes: SurveyNote[] = [];
  createdAt: string | null = null;
  createdBy: string | null = null;
  updatedAt: string | null = null;

  // โชว์ "Updated" เฉพาะตอนมีการแก้ไขจริงหลังสร้างครั้งแรก (updatedAt ขยับจาก createdAt)
  get hasBeenUpdated(): boolean {
    return !!this.createdAt && !!this.updatedAt && this.updatedAt !== this.createdAt;
  }

  get backLink(): string[] {
    return this.customerId ? ['/detail', this.customerId] : ['/dashboard'];
  }

  stagedPhotos: StagedPhoto[] = [];
  isUploadingPhoto = false;
  isPhotoDragOver = false;
  photoErrorMessage = '';
  removingPhotoId: string | null = null;

  showNoteForm = false;
  newNoteText = '';
  isSavingNote = false;
  noteErrorMessage = '';

  editingNoteId: string | null = null;
  editingNoteText = '';
  isUpdatingNote = false;
  removingNoteId: string | null = null;

  ngOnInit(): void {
    this.customerId = this.route.snapshot.queryParamMap.get('customerId');
    this.surveyId = this.route.snapshot.queryParamMap.get('surveyId');

    if (!this.customerId) {
      this.loadErrorMessage = 'Customer not found. Please open this page from the customer detail page';
      return;
    }

    // โหลดข้อมูลเก่าเฉพาะตอนมี surveyId ชัดเจน (มาจาก Survey History) — เปิดจากปุ่ม Survey เปล่าๆ จะไม่ auto ดึงของเก่ามา
    if (this.surveyId) {
      this.loadSurvey(this.surveyId);
    }
  }

  private loadSurvey(id: string): void {
    this.isLoading = true;
    this.loadErrorMessage = '';

    this.surveyService.getOne(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.applyDetail(detail);
          this.isLoading = false;
        },
        error: (err) => {
          console.error('[API] Failed to load survey:', err);
          this.isLoading = false;
          // survey เก่าหาไม่เจอ (ลบไปแล้ว/id ผิด) — พากลับหน้าลูกค้าแทนที่จะค้างหน้าเปล่า
          this.router.navigate(this.backLink);
        },
      });
  }

  private applyDetail(detail: SurveyDetail): void {
    // survey ใหม่เพิ่งถูกสร้างตอนแนบรูป/โน้ตแรก (ไม่มี surveyId ใน URL มาก่อน) — เติม surveyId เข้า URL ทันที
    // กัน reload แล้วหลุดกลับไปเป็นหน้าสร้างใหม่ซ้ำ (จะกลายเป็น survey คนละใบกับที่เพิ่งกรอกไป)
    if (!this.surveyId && this.customerId) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { customerId: this.customerId, surveyId: detail.id },
        replaceUrl: true,
      });
    }

    this.surveyId = detail.id;
    this.photos = detail.photos;
    this.notes = detail.notes;
    this.createdAt = detail.createdAt;
    this.createdBy = detail.createdBy;
    this.updatedAt = detail.updatedAt;
  }

  // เคลียร์ blob URL ของรูปที่ preview ค้างไว้ (ยังไม่ได้กด Save) กันหน่วยความจำรั่วตอนออกจากหน้า
  ngOnDestroy(): void {
    this.stagedPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }

  // ===== Photos =====

  onPhotoFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    this.stagePhotos(files);
  }

  onPhotoDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isPhotoDragOver = true;
  }

  onPhotoDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isPhotoDragOver = false;
  }

  onPhotoDrop(event: DragEvent): void {
    event.preventDefault();
    this.isPhotoDragOver = false;
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    this.stagePhotos(files);
  }

  // input: ไฟล์ที่เลือก/ลากมาได้หลายไฟล์พร้อมกัน — กรองชนิด/ขนาดก่อน แล้วสร้าง preview ในเครื่องเท่านั้น
  // ยังไม่ยิงอัปโหลดจริงจนกว่าจะกด "Save Photos" (saveStagedPhotos)
  private stagePhotos(files: File[]): void {
    if (files.length === 0) return;

    this.photoErrorMessage = '';

    for (const file of files) {
      if (!PHOTO_ACCEPTED_TYPES.includes(file.type)) {
        this.photoErrorMessage = `File "${file.name}" is not a supported image (JPEG/PNG/WebP)`;
        continue;
      }
      if (file.size > PHOTO_MAX_SIZE_BYTES) {
        this.photoErrorMessage = `File "${file.name}" exceeds 10MB`;
        continue;
      }
      this.stagedPhotos.push({ file, previewUrl: URL.createObjectURL(file) });
    }
  }

  // ลบรูปที่ preview ค้างไว้ออกก่อนกด Save — ไม่มีการเรียก API เพราะยังไม่เคยอัปโหลดจริง
  removeStagedPhoto(index: number): void {
    const [removed] = this.stagedPhotos.splice(index, 1);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
  }

  saveStagedPhotos(): void {
    if (!this.customerId || this.stagedPhotos.length === 0 || this.isUploadingPhoto) return;
    this.photoErrorMessage = '';
    this.uploadNextStagedPhoto();
  }

  // อัปโหลดรูปที่ preview ค้างไว้ทีละไฟล์ต่อคิว (เอาตัวแรกออกไปเรื่อยๆ) — ไฟล์ไหนพังแค่ error เฉพาะไฟล์นั้น ไม่หยุดคิวที่เหลือ
  private uploadNextStagedPhoto(): void {
    if (!this.customerId || this.stagedPhotos.length === 0) {
      this.isUploadingPhoto = false;
      return;
    }

    this.isUploadingPhoto = true;
    const staged = this.stagedPhotos[0];

    this.surveyService.addPhoto(this.customerId, this.surveyId, staged.file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.applyDetail(detail);
          URL.revokeObjectURL(staged.previewUrl);
          this.stagedPhotos.shift();
          this.uploadNextStagedPhoto();
        },
        error: (err) => {
          console.error('[API] Failed to upload survey photo:', err);
          this.photoErrorMessage = `Failed to upload "${staged.file.name}"`;
          URL.revokeObjectURL(staged.previewUrl);
          this.stagedPhotos.shift();
          this.uploadNextStagedPhoto();
        },
      });
  }

  removePhoto(photo: SurveyPhoto): void {
    if (!this.surveyId || this.removingPhotoId) return;

    this.removingPhotoId = photo.id;
    this.photoErrorMessage = '';

    this.surveyService.removePhoto(this.surveyId, photo.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.applyDetail(detail);
          this.removingPhotoId = null;
        },
        error: (err) => {
          console.error('[API] Failed to remove survey photo:', err);
          this.photoErrorMessage = 'Failed to delete photo. Please try again';
          this.removingPhotoId = null;
        },
      });
  }

  // ===== Notes =====

  toggleNoteForm(): void {
    this.showNoteForm = !this.showNoteForm;
    if (!this.showNoteForm) this.newNoteText = '';
    this.noteErrorMessage = '';
  }

  saveNote(): void {
    const trimmed = this.newNoteText.trim();
    if (!trimmed || !this.customerId || this.isSavingNote) return;

    this.isSavingNote = true;
    this.noteErrorMessage = '';

    this.surveyService.addNote(this.customerId, this.surveyId, trimmed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.applyDetail(detail);
          this.newNoteText = '';
          this.showNoteForm = false;
          this.isSavingNote = false;
        },
        error: (err) => {
          console.error('[API] Failed to save survey note:', err);
          this.noteErrorMessage = 'Failed to save note. Please try again';
          this.isSavingNote = false;
        },
      });
  }

  startEditNote(note: SurveyNote): void {
    if (this.isUpdatingNote) return;
    this.editingNoteId = note.id;
    this.editingNoteText = note.text;
  }

  cancelEditNote(): void {
    this.editingNoteId = null;
    this.editingNoteText = '';
  }

  saveEditNote(note: SurveyNote): void {
    const trimmed = this.editingNoteText.trim();
    if (!trimmed || !this.surveyId || this.isUpdatingNote) return;

    this.isUpdatingNote = true;
    this.noteErrorMessage = '';

    this.surveyService.updateNote(this.surveyId, note.id, trimmed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.applyDetail(detail);
          this.editingNoteId = null;
          this.editingNoteText = '';
          this.isUpdatingNote = false;
        },
        error: (err) => {
          console.error('[API] Failed to update survey note:', err);
          this.noteErrorMessage = 'Failed to update note. Please try again';
          this.isUpdatingNote = false;
        },
      });
  }

  removeNote(note: SurveyNote): void {
    if (!this.surveyId || this.removingNoteId) return;

    this.removingNoteId = note.id;
    this.noteErrorMessage = '';

    this.surveyService.removeNote(this.surveyId, note.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.applyDetail(detail);
          this.removingNoteId = null;
        },
        error: (err) => {
          console.error('[API] Failed to remove survey note:', err);
          this.noteErrorMessage = 'Failed to delete note. Please try again';
          this.removingNoteId = null;
        },
      });
  }
}
