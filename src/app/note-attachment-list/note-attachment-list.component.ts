import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { NoteAttachmentDetail } from '../dto/customer.dto';
import { fileIconClass, formatFileSize, splitAttachments } from '../note-attachments.util';

// แสดงไฟล์แนบของโน้ต/comment แบบอ่านอย่างเดียว: รูปเป็น thumbnail, ไฟล์อื่นเป็นการ์ดมีไอคอน+ชื่อ+ขนาด
// คลิกเปิดในแท็บใหม่ — ไฟล์ที่ไม่ใช่รูป backend sign URL ให้ดาวน์โหลดด้วยชื่อจริงอยู่แล้ว
@Component({
  selector: 'app-note-attachment-list',
  templateUrl: './note-attachment-list.component.html',
  styleUrl: './note-attachment-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteAttachmentListComponent {
  readonly attachments = input.required<readonly NoteAttachmentDetail[]>();

  protected readonly groups = computed(() => splitAttachments(this.attachments()));

  protected iconFor(attachment: NoteAttachmentDetail): string {
    return fileIconClass(attachment.name);
  }

  protected sizeOf(attachment: NoteAttachmentDetail): string {
    return formatFileSize(attachment.sizeBytes);
  }
}
