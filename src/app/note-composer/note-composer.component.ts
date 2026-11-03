import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FilePreviewCache } from '../attachment-files.util';
import type { MentionableUser } from '../dto/customer.dto';
import {
  NOTE_ATTACHMENT_ACCEPT,
  NOTE_ATTACHMENT_MAX_FILES,
  NOTE_TITLE_MAX_LENGTH,
  fileIconClass,
  formatFileSize,
  mergeNoteAttachmentFiles,
} from '../note-attachments.util';

// ค่าที่ composer ส่งออกตอนกด Post — text/title trim แล้ว, mentionedUserIds เฉพาะคนที่ชื่อยังอยู่ในข้อความจริง
export interface NoteComposerValue {
  title: string;
  text: string;
  mentionedUserIds: string[];
  files: File[];
}

const MAX_MENTION_OPTIONS = 8;
// "@" ที่ต้นข้อความหรือหลังช่องว่าง ตามด้วยคำค้นหนึ่งคำ (หรือสองคำคั่นช่องว่างเดียว เผื่อชื่อมีนามสกุล) ชิดติด caret
const MENTION_TRIGGER_PATTERN = /(?:^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/u;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// pattern ของ "@ชื่อ" ที่ไม่ใช่ส่วนหนึ่งของคำอื่น (กันอีเมล a@Bob.com และ @Bobby เมื่อแท็ก Bob) — \p{M} รวมสระ/วรรณยุกต์ไทย
function mentionPattern(name: string, flags: string): RegExp {
  return new RegExp(`(?<=^|\\s)@${escapeRegExp(name)}(?![\\p{L}\\p{M}\\p{N}])`, flags);
}

// composer แบบ Discord forum post: (title) + ข้อความ + แนบรูป/ไฟล์ + แท็กคนด้วย @ — ใช้ทั้งโน้ตหลักและ comment
// ไม่เรียก API เอง: emit `submitted` ให้ parent ส่ง แล้ว parent เรียก reset() เมื่อสำเร็จ
// (ไม่ล้างเองตอนกด Post เพื่อให้ข้อความ/ไฟล์ที่พิมพ์ไม่หายเมื่อ network หลุด)
@Component({
  selector: 'app-note-composer',
  templateUrl: './note-composer.component.html',
  styleUrl: './note-composer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteComposerComponent implements OnDestroy {
  readonly showTitle = input(false);
  readonly textMaxLength = input.required<number>();
  readonly placeholder = input('Write your note here...');
  readonly submitLabel = input('Post');
  readonly compact = input(false);
  readonly showCancel = input(false);
  readonly autoFocus = input(false);
  // parent กำลังส่งอยู่ — ล็อกทุกช่องกัน post ซ้ำและกันแก้ไฟล์ระหว่าง upload
  readonly isSaving = input(false);
  // error จาก API ที่ parent อยากให้โชว์ใต้ composer
  readonly errorMessage = input('');
  // ต้องส่ง reference ที่เสถียร (ไม่ใช่ getter ที่ new array ทุกครั้ง) — ที่นี่ใช้แค่ filter ใน computed แต่ parent ไม่ควรสร้างใหม่ทุก CD
  readonly mentionableUsers = input<readonly MentionableUser[]>([]);

  readonly submitted = output<NoteComposerValue>();
  readonly cancelled = output<void>();

  protected readonly titleMaxLength = NOTE_TITLE_MAX_LENGTH;
  protected readonly maxFiles = NOTE_ATTACHMENT_MAX_FILES;
  protected readonly accept = NOTE_ATTACHMENT_ACCEPT;
  protected readonly previews = new FilePreviewCache();

  protected readonly title = signal('');
  protected readonly text = signal('');
  protected readonly files = signal<File[]>([]);
  protected readonly localError = signal<string | null>(null);
  protected readonly isDragOver = signal(false);

  // null = ไม่ได้อยู่ในโหมดพิมพ์ @
  protected readonly mentionQuery = signal<string | null>(null);
  protected readonly activeOptionIndex = signal(0);
  // คนที่เคยเลือกจาก dropdown — ตอนส่งจะกรองเหลือเฉพาะที่ "@ชื่อ" ยังอยู่ในข้อความ (ผู้ใช้อาจลบข้อความทีหลัง)
  private readonly taggedUsers = signal<MentionableUser[]>([]);

  protected readonly mentionOptions = computed<MentionableUser[]>(() => {
    const query = this.mentionQuery();
    if (query === null) return [];
    const needle = query.trimStart().toLowerCase();
    return this.mentionableUsers()
      .filter((user) => user.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)))
      .slice(0, MAX_MENTION_OPTIONS);
  });

  protected readonly activeTags = computed(() =>
    this.taggedUsers().filter((user) => mentionPattern(user.name, 'u').test(this.text())),
  );

  // โน้ตหลัก (มี title) กดได้เสมอ เพื่อให้ submit() บอกว่าลืมกรอก title แทนที่จะปล่อยปุ่ม disabled เงียบๆ
  // comment (ไม่มี title) ต้องมีข้อความหรือไฟล์อย่างใดอย่างหนึ่ง
  protected readonly canSubmit = computed(
    () => !this.isSaving() && (this.showTitle() || this.text().trim().length > 0 || this.files().length > 0),
  );

  protected readonly displayError = computed(() => this.localError() ?? (this.errorMessage() || null));

  private readonly textareaRef = viewChild.required<ElementRef<HTMLTextAreaElement>>('textarea');
  private readonly titleRef = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  constructor() {
    afterNextRender(() => {
      if (this.autoFocus()) this.focusInitialField();
    });
  }

  ngOnDestroy(): void {
    this.previews.releaseAll();
  }

  // ปิดแท็บ/รีเฟรชขณะมี draft → browser ถามยืนยันก่อน (ครอบคลุมเฉพาะการออกจากหน้าเว็บ ไม่ครอบคลุมการกดย้อนกลับ/เปลี่ยนเมนูภายในแอป)
  @HostListener('window:beforeunload', ['$event'])
  protected warnBeforeLeavingWithDraft(event: BeforeUnloadEvent): void {
    if (this.hasDraft()) event.preventDefault();
  }

  // output: true ถ้ามีอะไรที่ผู้ใช้พิมพ์/แนบไว้แล้วจะหายถ้าปิดฟอร์ม — parent ใช้ถามยืนยันก่อนทิ้ง draft
  hasDraft(): boolean {
    return this.title().trim().length > 0 || this.text().trim().length > 0 || this.files().length > 0;
  }

  // parent เรียกหลังบันทึกสำเร็จ — ล้างทุกอย่างและคืน object URL ของ thumbnail
  reset(): void {
    this.previews.releaseAll();
    this.title.set('');
    this.text.set('');
    this.files.set([]);
    this.taggedUsers.set([]);
    this.mentionQuery.set(null);
    this.localError.set(null);
    this.isDragOver.set(false);
  }

  focus(): void {
    this.focusInitialField();
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    if (this.showTitle() && this.title().trim().length === 0) {
      this.localError.set('Please enter a title');
      this.titleRef()?.nativeElement.focus();
      return;
    }
    this.localError.set(null);
    this.submitted.emit({
      title: this.title().trim(),
      text: this.text().trim(),
      mentionedUserIds: this.activeTags().map((user) => user.id),
      files: [...this.files()],
    });
  }

  protected iconFor(file: File): string {
    return fileIconClass(file.name);
  }

  protected sizeOf(file: File): string {
    return formatFileSize(file.size);
  }

  // ---------- title / text ----------

  protected onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
    this.localError.set(null);
  }

  protected onTitleEnter(event: Event): void {
    event.preventDefault();
    this.textareaRef().nativeElement.focus();
  }

  protected onTextInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.text.set(textarea.value);
    this.updateMentionQuery(textarea);
  }

  // caret ขยับด้วยเมาส์/ลูกศรซ้าย-ขวา → ตรวจใหม่ว่ายังอยู่ในโหมดพิมพ์ @ หรือไม่ (ไม่ผูก ArrowUp/Down เพราะใช้เลื่อนรายการ)
  protected onCaretMoved(event: Event): void {
    this.updateMentionQuery(event.target as HTMLTextAreaElement);
  }

  protected closeMentionList(): void {
    this.mentionQuery.set(null);
  }

  protected onTextKeydown(event: KeyboardEvent): void {
    // กำลังเรียบเรียงตัวอักษรด้วย IME — Enter/Escape เป็นของ IME ไม่ใช่ของเรา
    if (event.isComposing) return;

    const options = this.mentionOptions();
    if (options.length > 0) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.activeOptionIndex.update((index) => (index + 1) % options.length);
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.activeOptionIndex.update((index) => (index - 1 + options.length) % options.length);
          return;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          this.selectMention(options[Math.min(this.activeOptionIndex(), options.length - 1)]);
          return;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          this.mentionQuery.set(null);
          return;
      }
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submit();
    }
  }

  // ---------- mention ----------

  // input: textarea ที่ caret อยู่ — output: ตั้ง mentionQuery เป็นคำที่พิมพ์ต่อจาก @ ก่อน caret (null ถ้าไม่ได้อยู่ในโหมด @)
  private updateMentionQuery(textarea: HTMLTextAreaElement): void {
    if (this.mentionableUsers().length === 0) {
      this.mentionQuery.set(null);
      return;
    }
    const beforeCaret = textarea.value.slice(0, textarea.selectionStart);
    const match = MENTION_TRIGGER_PATTERN.exec(beforeCaret);
    this.mentionQuery.set(match ? match[1] : null);
    this.activeOptionIndex.set(0);
  }

  protected setActiveOption(index: number): void {
    this.activeOptionIndex.set(index);
  }

  // input: คนที่เลือกจาก dropdown — output: แทนที่ "@คำค้น" ก่อน caret ด้วย "@ชื่อเต็ม " และจำว่าแท็กคนนี้แล้ว
  protected selectMention(user: MentionableUser): void {
    const textarea = this.textareaRef().nativeElement;
    const caret = textarea.selectionStart;
    const beforeCaret = textarea.value.slice(0, caret);
    const match = MENTION_TRIGGER_PATTERN.exec(beforeCaret);
    if (!match) {
      this.mentionQuery.set(null);
      return;
    }

    // match[0] อาจนำหน้าด้วยช่องว่าง 1 ตัวที่ต้องเก็บไว้
    const atIndex = beforeCaret.length - match[0].length + (match[0].startsWith('@') ? 0 : 1);
    const insertion = `@${user.name} `;
    const nextText = beforeCaret.slice(0, atIndex) + insertion + textarea.value.slice(caret);
    if (nextText.length > this.textMaxLength()) {
      this.localError.set(`Text must be at most ${this.textMaxLength()} characters`);
      this.mentionQuery.set(null);
      return;
    }

    const nextCaret = atIndex + insertion.length;
    textarea.value = nextText;
    textarea.setSelectionRange(nextCaret, nextCaret);
    this.text.set(nextText);
    this.localError.set(null);
    this.mentionQuery.set(null);
    this.taggedUsers.update((users) => (users.some((u) => u.id === user.id) ? users : [...users, user]));
    textarea.focus();
  }

  // ปุ่ม @ บน toolbar — ใส่ "@" ที่ caret (เว้นวรรคนำถ้าติดคำอื่น) แล้วเปิดรายชื่อ
  protected insertAtSign(): void {
    const textarea = this.textareaRef().nativeElement;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const beforeCaret = textarea.value.slice(0, start);
    const insertion = beforeCaret.length > 0 && !/\s$/u.test(beforeCaret) ? ' @' : '@';
    const nextText = beforeCaret + insertion + textarea.value.slice(end);
    if (nextText.length > this.textMaxLength()) return;

    const nextCaret = start + insertion.length;
    textarea.value = nextText;
    textarea.setSelectionRange(nextCaret, nextCaret);
    this.text.set(nextText);
    textarea.focus();
    this.updateMentionQuery(textarea);
  }

  // input: คนที่เอา chip ออก — output: ลบ "@ชื่อ" ออกจากข้อความด้วย เพื่อให้ข้อความกับรายการแท็กตรงกันเสมอ
  protected removeTag(user: MentionableUser): void {
    this.taggedUsers.update((users) => users.filter((u) => u.id !== user.id));
    this.text.update((current) => current.replace(mentionPattern(user.name, 'gu'), '').replace(/ {2,}/g, ' '));
  }

  // ---------- attachments ----------

  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    // เคลียร์ค่า เพื่อให้เลือกไฟล์เดิมซ้ำหลังลบออกแล้วยัง trigger change ได้
    input.value = '';
  }

  private addFiles(incoming: File[]): void {
    if (incoming.length === 0 || this.isSaving()) return;
    const result = mergeNoteAttachmentFiles(this.files(), incoming);
    this.files.set(result.files);
    this.localError.set(result.error);
  }

  protected removeFile(file: File): void {
    if (this.isSaving()) return;
    this.previews.release(file);
    this.files.update((files) => files.filter((f) => f !== file));
    this.localError.set(null);
  }

  // วางรูป (เช่น screenshot) จาก clipboard — ปล่อยให้วางข้อความตามปกติถ้ามีข้อความมาด้วย
  // (copy จาก Excel ได้ทั้งข้อความและรูปตาราง ถ้า preventDefault จะวางข้อความไม่ได้)
  protected onPaste(event: ClipboardEvent): void {
    const pastedFiles = Array.from(event.clipboardData?.files ?? []);
    if (pastedFiles.length === 0 || event.clipboardData?.getData('text/plain')) return;
    event.preventDefault();
    this.addFiles(pastedFiles);
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files') || this.isSaving()) return;
    event.preventDefault();
    this.isDragOver.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    // dragleave ยิงตอนผ่านเข้า element ลูกด้วย — ไม่ใช่การลากออกจริง
    const container = event.currentTarget;
    if (container instanceof Node && event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
    this.isDragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.isDragOver.set(false);
    this.addFiles(Array.from(event.dataTransfer.files));
  }

  private focusInitialField(): void {
    const titleInput = this.titleRef();
    (titleInput ?? this.textareaRef()).nativeElement.focus();
  }
}
