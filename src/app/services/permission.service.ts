import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly auth = inject(AuthService);

  private readonly profile = toSignal(this.auth.currentProfile$, { initialValue: null });

  // fail-closed: profile ยังโหลดไม่เสร็จ (null) ถือว่าไม่มีสิทธิ์ เพื่อไม่ให้ปุ่มแก้ไขแวบขึ้นมา
  // คืน true เฉพาะ role 'ceo' หรือ 'admin'
  readonly canManage = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin';
  });

  // แยกจาก canManage เพราะ purchasing ต้องแก้ราคา/เพิ่ม/ลบรายการสินค้าใน Settings ได้ แต่ห้ามจัดการ user หรือเปลี่ยน status ลูกค้า
  // fail-closed เหมือน canManage: profile ยังไม่โหลด = false — สิทธิ์จริงบังคับที่ backend
  readonly canManageProducts = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin' || role === 'purchasing';
  });

  // technician สร้าง/finalize ใบเสนอราคาไม่ได้ (แก้ draft เดิมได้อย่างเดียว) และไม่เห็นราคาสรุปในหน้า customer detail
  // fail-closed เหมือน canManage: profile ยังไม่โหลด (undefined) = false — สิทธิ์จริงบังคับที่ backend (estimates.service.ts)
  readonly canCreateQuotation = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role !== undefined && role !== 'technician';
  });

  readonly canSeePrice = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role !== undefined && role !== 'technician';
  });

  // แยกจาก canManage เพราะ backend อนุญาตเฉพาะ CEO เปลี่ยน role (PATCH /users/:id/role)
  readonly isCeo = computed<boolean>(() => this.profile()?.role === 'ceo');
}
