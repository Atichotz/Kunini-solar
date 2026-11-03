import type { NoteAttachmentDetail } from './dto/customer.dto';

// กติกาไฟล์แนบของ Internal Notes ต้องตรงกับ backend (dto/note-shared.dto.ts) — ถ้าแก้ฝั่งนี้ต้องแก้ backend ด้วย
// แยกจาก attachment-files.util.ts เพราะของ Task/Ticket จำกัด 3 ไฟล์และรับแค่รูป+PDF
export const NOTE_ATTACHMENT_MAX_FILES = 10;
export const NOTE_ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const NOTE_TITLE_MAX_LENGTH = 120;

const IMAGE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const FILE_EXTENSIONS: readonly string[] = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'zip'];
const ALLOWED_EXTENSIONS: readonly string[] = [...IMAGE_EXTENSIONS, ...FILE_EXTENSIONS];

// ใช้กับ <input type="file" accept> — ระบุเป็นนามสกุลเพราะ MIME ของ csv/zip/docx แต่ละ OS ไม่เหมือนกัน
export const NOTE_ATTACHMENT_ACCEPT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export interface NoteAttachmentMergeResult {
  files: File[];
  // ข้อความแรกที่บอกว่ามีไฟล์ถูกข้ามเพราะอะไร — null เมื่อรับครบทุกไฟล์
  error: string | null;
}

// input: ชื่อไฟล์ — output: นามสกุลตัวพิมพ์เล็กไม่มีจุด ('' ถ้าไม่มี)
export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

// ตัดสินจากนามสกุลแทน file.type เพราะ browser บางตัวส่ง type ว่างสำหรับบางไฟล์
export function isImageFileName(fileName: string): boolean {
  return IMAGE_EXTENSIONS.includes(getFileExtension(fileName));
}

// input: ไฟล์ที่เลือกไว้แล้ว + ไฟล์ที่เพิ่งเลือกเพิ่ม
// output: { files } = รายการรวมโดยรับเฉพาะไฟล์ที่ผ่านทุกข้อ (ชนิด/ขนาด/ไม่ว่าง/ไม่ซ้ำ/ไม่เกินจำนวน), { error } = เหตุผลของไฟล์ที่ถูกข้าม
// รับไฟล์ที่ผ่านแม้บางไฟล์ไม่ผ่าน เพราะผู้ใช้อาจลากมาทีเดียวหลายไฟล์ — ไม่ควรทิ้งทั้งชุดเพราะไฟล์เดียว
export function mergeNoteAttachmentFiles(current: readonly File[], incoming: readonly File[]): NoteAttachmentMergeResult {
  const accepted = [...current];
  let error: string | null = null;

  for (const file of incoming) {
    if (!ALLOWED_EXTENSIONS.includes(getFileExtension(file.name))) {
      error ??= `${file.name}: this file type is not supported`;
      continue;
    }
    if (file.size === 0) {
      error ??= `${file.name}: file is empty`;
      continue;
    }
    if (file.size > NOTE_ATTACHMENT_MAX_SIZE_BYTES) {
      error ??= `${file.name}: file must be 10MB or smaller`;
      continue;
    }
    // เลือกไฟล์เดิมซ้ำ (เช่น กดปุ่มแนบสองรอบ) ไม่ใช่ error แค่ไม่ต้องใส่ซ้ำ
    if (accepted.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) continue;
    if (accepted.length >= NOTE_ATTACHMENT_MAX_FILES) {
      error ??= `Attach at most ${NOTE_ATTACHMENT_MAX_FILES} files`;
      continue;
    }
    accepted.push(file);
  }

  return { files: accepted, error };
}

// input: จำนวน byte — output: "532 KB" / "1.4 MB" (รูปเก่าที่ไม่รู้ขนาดคืน '')
export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// input: ชื่อไฟล์ — output: class Font Awesome ของไอคอนที่ตรงกับชนิดไฟล์
export function fileIconClass(fileName: string): string {
  switch (getFileExtension(fileName)) {
    case 'pdf':
      return 'fa-file-pdf';
    case 'doc':
    case 'docx':
      return 'fa-file-word';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'fa-file-excel';
    case 'ppt':
    case 'pptx':
      return 'fa-file-powerpoint';
    case 'zip':
      return 'fa-file-zipper';
    case 'txt':
      return 'fa-file-lines';
    default:
      return 'fa-file';
  }
}

// รูปที่แนบไว้ (แสดงเป็น thumbnail) แยกจากไฟล์อื่น (แสดงเป็นการ์ดไฟล์)
export function splitAttachments(attachments: readonly NoteAttachmentDetail[]): {
  images: NoteAttachmentDetail[];
  files: NoteAttachmentDetail[];
} {
  return {
    images: attachments.filter((a) => a.kind === 'image'),
    files: attachments.filter((a) => a.kind !== 'image'),
  };
}
