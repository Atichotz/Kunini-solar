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

  // แยกจาก canManage เพราะ sales ต้องแก้ข้อมูลลูกค้า/contacts และย้าย status ใน Workflow ได้ แต่ห้ามเห็น revenue หรือจัดการ user
  // canManage ยังคุมเฉพาะ revenue (+ สิ่งที่เป็นของ ceo/admin ล้วน) — สิทธิ์จริงบังคับที่ backend (@Roles('ceo', 'admin', 'sales') ใน customers.controller.ts)
  // fail-closed: profile ยังไม่โหลด = false
  readonly canManageCustomers = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin' || role === 'sales';
  });

  // แยกจาก canManage เพราะ purchasing ต้องแก้ราคา/เพิ่ม/ลบรายการสินค้าใน Settings ได้ แต่ห้ามจัดการ user หรือเปลี่ยน status ลูกค้า
  // fail-closed เหมือน canManage: profile ยังไม่โหลด = false — สิทธิ์จริงบังคับที่ backend
  readonly canManageProducts = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin' || role === 'purchasing';
  });

  // engineer สร้าง/finalize ใบเสนอราคาไม่ได้ (แก้ draft เดิมได้อย่างเดียว) และไม่เห็นราคาสรุปในหน้า customer detail
  // technician ไม่เกี่ยวกับใบเสนอราคาเลย — เป็น whitelist เพื่อให้ role ใหม่ในอนาคตเริ่มจากไม่มีสิทธิ์
  // fail-closed เหมือน canManage: profile ยังไม่โหลด (undefined) = false — สิทธิ์จริงบังคับที่ backend (estimates.service.ts)
  readonly canCreateQuotation = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin' || role === 'purchasing';
  });

  readonly canSeePrice = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin' || role === 'purchasing';
  });

  // false ระหว่างรอ GET /users/me — ใช้รอก่อนตัดสินว่าจะเรียก API ที่ technician ไม่มีสิทธิ์หรือไม่
  readonly isProfileLoaded = computed<boolean>(() => this.profile() !== null);

  // technician ใช้ได้แค่ SOW/Report (+ ดูข้อมูลลูกค้าอย่างเดียว) — จึงไม่เห็น Dashboard, Task/Ticket, Notes, ใบเสนอราคา, Settings
  // profile ยังไม่โหลด = false — ถ้าต้องซ่อนของจนกว่าจะรู้ role ให้ใช้ canUseStaffTools แทน
  // สิทธิ์จริงบังคับที่ backend (@DenyRoles / @ReadOnlyRoles)
  readonly isTechnician = computed<boolean>(() => this.profile()?.role === 'technician');

  // true เมื่อรู้ role แล้วและไม่ใช่ technician — ใช้คุมส่วนที่ technician ห้ามเห็น (fail-closed: ยังไม่รู้ role = ซ่อนไว้ก่อน)
  readonly canUseStaffTools = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role !== undefined && role !== 'technician';
  });

  // purchasing และ sales ดู SOW/Report ได้อย่างเดียว (เพิ่ม/แก้/ลบ/อัปโหลดรูปไม่ได้) — เป็น whitelist เพื่อให้ role ใหม่ในอนาคตเริ่มจากแก้ไม่ได้
  // fail-closed: profile ยังไม่โหลด = false — สิทธิ์จริงบังคับที่ backend (@ReadOnlyRoles('purchasing', 'sales'))
  readonly canEditDocuments = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin' || role === 'engineer' || role === 'technician';
  });

  // input: created_by_user_id ของ SOW/report (null = แถวเก่าไม่มีเจ้าของ)
  // output: ceo/admin/engineer ลบได้ทั้งหมด, purchasing/sales ลบไม่ได้, technician ลบได้เฉพาะของที่ตัวเองสร้าง — สิทธิ์จริงเช็คที่ backend
  canDeleteDocument(createdByUserId: string | null): boolean {
    const profile = this.profile();
    if (!profile || !this.canEditDocuments()) return false;
    if (profile.role !== 'technician') return true;
    return createdByUserId !== null && createdByUserId === profile.userId;
  }

  // ทุก role เห็นบอร์ด Task (sales เห็นงานตัวเอง + ทีม sales เหมือน engineer) — fail-closed: profile ยังไม่โหลด = false
  readonly canSeeTodoBoard = computed<boolean>(() => this.profile()?.role !== undefined);

  // sales ไม่เห็นบอร์ด/แท็บ Ticket — ticket เปิดดูได้อย่างเดียวผ่าน History card ใน customer detail
  // fail-closed: profile ยังไม่โหลด = false — สิทธิ์จริงบังคับที่ backend (tickets: @ReadOnlyRoles)
  readonly canSeeTicketBoard = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role !== undefined && role !== 'sales';
  });

  // แก้/เพิ่ม/ลบ Task ได้ — technician ดูได้อย่างเดียว (sales แก้ได้เท่า engineer)
  readonly canEditTodos = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role !== undefined && role !== 'technician';
  });

  // แก้/เพิ่ม/ลบ Ticket ได้ — technician และ sales ดูได้อย่างเดียว
  readonly canEditTickets = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role !== undefined && role !== 'technician' && role !== 'sales';
  });

  // เข้า Settings ได้ — technician และ sales ไม่ได้ (Settings มีราคาต้นทุนสินค้า) fail-closed: profile ยังไม่โหลด = false
  readonly canUseSettings = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role !== undefined && role !== 'technician' && role !== 'sales';
  });

  // ใช้เฉพาะจุดที่ UI ต้องต่างจาก role อื่นจริงๆ (เช่น ใบเสนอราคา draft ที่ sales เปิดหน้าแก้ไม่ได้) — เรื่องสิทธิ์ให้ใช้ can* ด้านบน
  readonly isSales = computed<boolean>(() => this.profile()?.role === 'sales');

  // แยกจาก canManage เพราะ backend อนุญาตเฉพาะ CEO เปลี่ยน role (PATCH /users/:id/role)
  readonly isCeo = computed<boolean>(() => this.profile()?.role === 'ceo');
}
