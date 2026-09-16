import { Injectable, signal } from '@angular/core';
import type { QuotationSnapshot } from '../dto/quotation.dto';

/**
 * ที่พัก snapshot ของใบเสนอราคาระหว่างหน้า estimate-page → pdf-bos-preview
 *
 * เทียบ Angular: เป็น singleton service (providedIn: 'root') ทำหน้าที่เหมือน state store เล็กๆ
 * ใช้ signal เพื่อให้ preview อ่านค่าแบบ reactive ได้ตรงๆ
 *
 * ข้อจำกัด: เก็บใน memory เท่านั้น — refresh หน้า preview หรือเปิด URL ตรงๆ = ค่าเป็น null
 * (preview จัดการเคสนี้ด้วยการโชว์ empty state + ปุ่มกลับ)
 */
@Injectable({ providedIn: 'root' })
export class QuotationPreviewService {
  private readonly _snapshot = signal<QuotationSnapshot | null>(null);

  /** อ่านแบบ readonly — preview ใช้ตัวนี้ */
  readonly snapshot = this._snapshot.asReadonly();

  set(snapshot: QuotationSnapshot): void {
    this._snapshot.set(snapshot);
  }

  clear(): void {
    this._snapshot.set(null);
  }
}
