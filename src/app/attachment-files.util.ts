// กติกาไฟล์แนบต้องตรงกับ backend (TODO_COMMENT_* / ticket เทียบเท่า ใน *.service.ts) — ถ้าแก้ฝั่งนี้ต้องแก้ backend ด้วย
export const ATTACHMENT_ALLOWED_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ATTACHMENT_ACCEPT = ATTACHMENT_ALLOWED_MIME_TYPES.join(',');
export const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 3;

export type AttachmentMergeResult = { files: File[] } | { error: string };

// input: ไฟล์ที่เลือกไว้แล้ว + ไฟล์ที่เพิ่งเลือกเพิ่ม
// output: { files } รวมทั้งหมดถ้าผ่านทุกข้อ, { error } ข้อความแรกที่ไม่ผ่าน (จำนวนเกิน/ชนิดไม่รองรับ/ใหญ่เกิน) — ไม่รับไฟล์ใหม่เลยถ้ามีอันไม่ผ่าน
export function mergeAttachmentFiles(current: readonly File[], incoming: readonly File[]): AttachmentMergeResult {
  const combined = [...current, ...incoming];
  if (combined.length > ATTACHMENT_MAX_FILES) {
    return { error: `Attach at most ${ATTACHMENT_MAX_FILES} files` };
  }
  for (const file of incoming) {
    if (!ATTACHMENT_ALLOWED_MIME_TYPES.includes(file.type)) {
      return { error: `${file.name}: only JPEG, PNG, WebP, or PDF files are allowed` };
    }
    if (file.size > ATTACHMENT_MAX_SIZE_BYTES) {
      return { error: `${file.name}: file must be 10MB or smaller` };
    }
  }
  return { files: combined };
}

// เก็บ object URL ของรูปที่เลือกไว้รอแนบ เพื่อโชว์ thumbnail — ต้อง release ทุกครั้งที่ไฟล์ออกจากรายการ/ฟอร์มถูกล้าง/component ถูกทำลาย
// ไม่งั้น blob ค้างใน memory จนปิดแท็บ (ไม่ใช้ computed สร้าง URL เพราะรันซ้ำทุกครั้งที่ signal เปลี่ยนและจะสร้าง URL ใหม่ทิ้งไว้เรื่อยๆ)
export class FilePreviewCache {
  private readonly urls = new Map<File, string>();

  // input: ไฟล์ที่เลือก — output: object URL ถ้าเป็นรูป (คืนค่าเดิมซ้ำเมื่อถามซ้ำ), null ถ้าไม่ใช่รูป (เช่น PDF)
  urlFor(file: File): string | null {
    if (!file.type.startsWith('image/')) return null;
    let url = this.urls.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      this.urls.set(file, url);
    }
    return url;
  }

  release(file: File): void {
    const url = this.urls.get(file);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.urls.delete(file);
  }

  releaseAll(): void {
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls.clear();
  }
}
