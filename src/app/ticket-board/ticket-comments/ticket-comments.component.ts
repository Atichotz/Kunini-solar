import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ImageModule } from 'primeng/image';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { FilePreviewCache } from '../../attachment-files.util';
import { TicketService } from '../../services/ticket.service';
import type { TicketAssignee, TicketComment } from '../../dto/ticket.dto';
import type { AssigneeOption } from '../ticket-board.component';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 3;

// แผง comment ที่โผล่ใต้แถว ticket (ดูที่ ticket-board.component.html) — โหลด comment เฉพาะตอนเปิด ไม่โหลดพร้อม getAll()
// ConfirmationService ต้องอยู่ใน providers ของ component นี้เอง (เหมือน pattern ใน todo-comments) เพราะ
// <p-confirmDialog> ผูกกับ instance เดียวที่ inject มา ถ้าไปพึ่ง provider ระดับ root จะไม่มี dialog ให้เปิด
@Component({
  selector: 'app-ticket-comments',
  imports: [FormsModule, ImageModule, ProgressSpinnerModule, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './ticket-comments.component.html',
  styleUrl: './ticket-comments.component.scss'
})
export class TicketCommentsComponent implements OnInit, OnDestroy {
  private readonly ticketService = inject(TicketService);
  private readonly confirmationService = inject(ConfirmationService);

  @Input({ required: true }) ticketId!: string;
  @Input({ required: true }) me!: TicketAssignee | null;
  // คนที่มองเห็น ticket นี้ได้เท่านั้น (privileged + assignee ที่ role ตรงกับ ticket) — คำนวณจาก parent ต่อ ticket
  @Input({ required: true }) mentionOptions!: AssigneeOption[];
  // true = อ่านอย่างเดียว: ซ่อนช่องพิมพ์และปุ่มลบ (backend จะตอบ 403 ถ้ายิงมาอยู่ดี)
  @Input() readOnly = false;
  // แจ้ง parent ให้ reload tickets list เพื่ออัปเดตจำนวน comment บน badge (parent เก็บ commentCount รวมไว้ที่ TicketCard)
  @Output() commentsChanged = new EventEmitter<void>();

  comments = signal<TicketComment[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  isSubmitting = signal(false);
  private readonly pendingDeleteIds = signal<ReadonlySet<string>>(new Set());

  newBody = '';
  selectedFiles = signal<File[]>([]);
  // thumbnail ของรูปที่เลือกไว้รอแนบ — PDF ไม่มี preview (urlFor คืน null)
  readonly filePreviews = new FilePreviewCache();
  // ตัวอักษรหลัง "@" ที่กำลังพิมพ์ — null = ไม่ได้กำลังเลือก mention อยู่
  mentionQuery = signal<string | null>(null);

  ngOnInit(): void {
    this.loadComments();
  }

  private loadComments(): void {
    this.loading.set(true);
    this.ticketService.getComments(this.ticketId).subscribe({
      next: list => {
        this.comments.set(list);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(this.errorMessage(err, 'Unable to load comments'));
        this.loading.set(false);
      }
    });
  }

  isPendingDelete(id: string): boolean {
    return this.pendingDeleteIds().has(id);
  }

  canDelete(comment: TicketComment): boolean {
    if (!this.me || this.readOnly) return false;
    return comment.author.id === this.me.id || this.me.role === 'ceo' || this.me.role === 'admin';
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  // ตัดข้อความเป็นช่วง text/mention (ไม่ใช้ innerHTML กัน XSS) — mention รู้จักจากชื่อใน mentionOptions เท่านั้น
  segmentsFor(body: string): { text: string; mention: boolean }[] {
    const regex = this.buildMentionRegex();
    if (!regex) return [{ text: body, mention: false }];

    const segments: { text: string; mention: boolean }[] = [];
    let lastIndex = 0;
    for (const match of body.matchAll(regex)) {
      const index = match.index ?? 0;
      if (index > lastIndex) segments.push({ text: body.slice(lastIndex, index), mention: false });
      segments.push({ text: match[0], mention: true });
      lastIndex = index + match[0].length;
    }
    if (lastIndex < body.length) segments.push({ text: body.slice(lastIndex), mention: false });
    return segments;
  }

  // input: ข้อความ comment ที่จะส่ง — output: id ของคนที่ถูก @mention จริงในข้อความ (match ด้วย regex เดียวกับที่ใช้ highlight
  // ไม่ใช้ string.includes เพราะชื่อสั้นที่เป็น substring ของชื่ออื่น เช่น "Dan" กับ "Danai P" จะโดนนับซ้ำ)
  private mentionedIdsIn(body: string): string[] {
    const regex = this.buildMentionRegex();
    if (!regex) return [];
    const matchedNames = new Set([...body.matchAll(regex)].map(match => match[0].slice(1)));
    return this.mentionOptions.filter(option => matchedNames.has(option.name)).map(option => option.id);
  }

  private buildMentionRegex(): RegExp | null {
    const names = [...new Set(this.mentionOptions.map(o => o.name))].filter(Boolean);
    if (!names.length) return null;
    // ชื่อยาวก่อน กัน "Dan" แย่ง match ก่อน "Danai P"
    const escaped = names
      .sort((a, b) => b.length - a.length)
      .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`@(?:${escaped.join('|')})`, 'g');
  }

  // input: textarea element — ตรวจว่ากำลังพิมพ์ "@ชื่อ" อยู่หน้า cursor ไหม เพื่อโชว์ dropdown แนะนำ
  onBodyInput(textarea: HTMLTextAreaElement): void {
    this.newBody = textarea.value;
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const uptoCursor = textarea.value.slice(0, cursor);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(uptoCursor);
    this.mentionQuery.set(match ? match[1] : null);
  }

  filteredMentionOptions(): AssigneeOption[] {
    const query = this.mentionQuery();
    if (query === null) return [];
    const q = query.toLowerCase();
    return this.mentionOptions.filter(o => o.name.toLowerCase().includes(q)).slice(0, 6);
  }

  // input: option ที่เลือกจาก dropdown, textarea element — output: แทรก "@ชื่อ " ตรงตำแหน่ง "@query" ที่พิมพ์ค้างไว้
  selectMention(option: AssigneeOption, textarea: HTMLTextAreaElement): void {
    const cursor = textarea.selectionStart ?? this.newBody.length;
    const uptoCursor = this.newBody.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf('@');
    if (atIndex === -1) return;

    const before = this.newBody.slice(0, atIndex);
    const after = this.newBody.slice(cursor);
    const insertion = `@${option.name} `;
    this.newBody = `${before}${insertion}${after}`;
    this.mentionQuery.set(null);

    const newCursor = before.length + insertion.length;
    // รอ Angular sync ค่าใหม่เข้า DOM ก่อน (ngModel) ไม่งั้น setSelectionRange จะเพี้ยนเพราะ textarea.value ยังเป็นค่าเก่า
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  }

  // ปุ่ม "@" กดแล้วแทรก "@" ที่ cursor เอง (เผื่อ space นำถ้าตัวก่อนหน้าไม่ใช่ space) แล้วเปิด dropdown แนะนำทันที
  insertMentionTrigger(textarea: HTMLTextAreaElement): void {
    textarea.focus();
    const cursor = textarea.selectionStart ?? this.newBody.length;
    const before = this.newBody.slice(0, cursor);
    const after = this.newBody.slice(cursor);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const insertion = `${needsSpace ? ' ' : ''}@`;
    this.newBody = `${before}${insertion}${after}`;

    const newCursor = before.length + insertion.length;
    setTimeout(() => {
      textarea.setSelectionRange(newCursor, newCursor);
      this.onBodyInput(textarea);
    });
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    const combined = [...this.selectedFiles(), ...files];
    if (combined.length > MAX_FILES) {
      this.error.set(`Attach at most ${MAX_FILES} files`);
      return;
    }
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        this.error.set(`${file.name}: only JPEG, PNG, WebP, or PDF files are allowed`);
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        this.error.set(`${file.name}: file must be 10MB or smaller`);
        return;
      }
    }

    this.error.set(null);
    this.selectedFiles.set(combined);
  }

  removeFile(index: number): void {
    const removed = this.selectedFiles()[index];
    if (removed) this.filePreviews.release(removed);
    this.selectedFiles.update(files => files.filter((_, i) => i !== index));
  }

  ngOnDestroy(): void {
    this.filePreviews.releaseAll();
  }

  submitComment(textarea: HTMLTextAreaElement): void {
    const body = this.newBody.trim();
    const files = this.selectedFiles();
    if ((!body && !files.length) || this.isSubmitting()) return;

    // หา mention จากข้อความจริงตอนส่ง (ไม่ track ชุด id แยก) — ถ้าคนลบ "@ชื่อ" ออกจาก body ก่อนส่ง ก็จะไม่ถูกนับเป็น mention
    const mentionedUserIds = this.mentionedIdsIn(body);

    this.isSubmitting.set(true);
    this.error.set(null);
    this.ticketService.addComment(this.ticketId, { body: body || undefined, mentionedUserIds, files }).subscribe({
      next: () => {
        this.newBody = '';
        this.selectedFiles.set([]);
        this.filePreviews.releaseAll();
        this.mentionQuery.set(null);
        this.isSubmitting.set(false);
        this.loadComments();
        this.commentsChanged.emit();
        textarea.style.height = 'auto';
      },
      error: err => {
        this.isSubmitting.set(false);
        this.error.set(this.errorMessage(err, 'Unable to add comment'));
      }
    });
  }

  deleteComment(comment: TicketComment): void {
    if (this.isPendingDelete(comment.id)) return;

    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: 'Delete this comment? This cannot be undone.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.setPendingDelete(comment.id, true);
        this.ticketService.deleteComment(this.ticketId, comment.id).subscribe({
          next: () => {
            this.setPendingDelete(comment.id, false);
            this.loadComments();
            this.commentsChanged.emit();
          },
          error: err => {
            this.setPendingDelete(comment.id, false);
            this.error.set(this.errorMessage(err, 'Unable to delete comment'));
          }
        });
      }
    });
  }

  private setPendingDelete(id: string, pending: boolean): void {
    this.pendingDeleteIds.update(current => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message: unknown = err.error?.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(', ');
    }
    return fallback;
  }
}
