import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TicketService } from '../services/ticket.service';
import { TicketCommentsComponent } from './ticket-comments/ticket-comments.component';
import type { Customer } from '../services/workflow.service';
import type { TicketCard, TicketAssignee, TicketRole, TicketStatus, UpdateTicketPayload } from '../dto/ticket.dto';

// field ที่แก้ไขแบบ inline ได้ทีละอัน (Status/startDate/daysAllotted/closeDate ไม่รวม เพราะคลิกแล้วเปลี่ยน/save ได้ทันทีอยู่แล้วเหมือน badge dropdown)
type EditableField = 'task' | 'customer' | 'assignees';

export interface AssigneeOption extends TicketAssignee {
  label: string;
}

// จำนวน ticket ต่อหน้าที่ให้เลือก และค่าเริ่มต้น
const PAGE_SIZE_OPTIONS = [5, 10, 20, 30] as const;
const DEFAULT_PAGE_SIZE = 10;

// ตารางเดียวใช้ร่วมกันทุกคน (ไม่แยก My/Team การ์ดเหมือน Todo) — สิทธิ์มองเห็นยังกรองที่ backend เหมือนเดิม
interface TicketBoardView {
  tickets: TicketCard[];
  visibleTickets: TicketCard[];
  currentPage: number;
  totalPages: number;
}

const ROLE_LABELS: Record<TicketRole, string> = {
  ceo: 'CEO',
  admin: 'Admin',
  technician: 'Technician',
  purchasing: 'Purchasing'
};

// สีจุดหน้า Status dropdown ตาม reference (Notion) — ชุดเดียวกับ Todo
const STATUS_META: Record<TicketStatus, { label: string; color: string }> = {
  todo: { label: 'Not started', color: 'var(--k-accent-orange)' },
  to_schedule: { label: 'To Schedule', color: 'var(--k-accent-blue)' },
  in_progress: { label: 'In Progress', color: 'var(--k-accent-blue)' },
  done: { label: 'Done', color: 'var(--k-accent-green)' }
};

// จำนวนคอลัมน์คงที่ (ไม่มีโหมดล็อก customer เหมือน Todo) — Done/Task/Customer/Status/Start/Days Allotted/Days Overdue/Close/Who's Task/Delete
const COLUMN_COUNT = 10;

@Component({
  selector: 'app-ticket-board',
  imports: [RouterLink, FormsModule, SelectModule, MultiSelectModule, DatePickerModule, ProgressSpinnerModule, DialogModule, ConfirmDialogModule, ToastModule, TicketCommentsComponent],
  templateUrl: './ticket-board.component.html',
  styleUrl: './ticket-board.component.scss',
  providers: [ConfirmationService, MessageService]
})
export class TicketBoardComponent implements OnInit {
  private readonly ticketService = inject(TicketService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // ตัวเลือกลูกค้าสำหรับ dropdown ผูก ticket เรียงชื่อ ก-ฮ ไว้แล้ว
  // ต้อง cache ผลลัพธ์ตอนรับ @Input แทนการ sort ใน getter ทุก change detection cycle — ไม่งั้น p-select ได้ [options]
  // เป็น reference ใหม่ทุกรอบ (อาการคล้าย dateCache ด้านล่างที่กันไว้สำหรับ p-datepicker)
  customerOptions: Customer[] = [];
  @Input() set customers(list: Customer[]) {
    this.customerOptions = [...list].sort((a, b) => a.name.localeCompare(b.name));
  }

  readonly teamOptions = (Object.keys(ROLE_LABELS) as TicketRole[]).map(role => ({ role, label: ROLE_LABELS[role] }));

  // ตัวเองใน allowed_users — role ตรงนี้ (ไม่ใช่ PermissionService) ใช้ตัดสินว่าเห็น filter ทีม/คนไหม
  me = signal<TicketAssignee | null>(null);
  tickets = signal<TicketCard[]>([]);
  assignees = signal<TicketAssignee[]>([]);
  isSubmitting = signal(false);
  // true จนกว่าโหลด me + รายการ ticket ครั้งแรกเสร็จ (หรือพัง) — กันตารางว่างที่ดูเหมือน "ไม่มี ticket"
  ticketsLoading = signal(true);
  // จำนวน ticket ทั้งหมด (ไม่ผ่าน filter) — ใช้แสดง badge บน tab ของ dashboard
  readonly totalCount = computed<number>(() => this.tickets().length);
  // id ticket ที่กำลัง toggle/ลบอยู่ — กันกดซ้ำระหว่างรอ request + refetch
  private readonly pendingTicketIds = signal<ReadonlySet<string>>(new Set());
  // field ที่กำลังแก้ไขอยู่ (แยกอิสระต่อ field ไม่ใช่ทั้งแถว) — แก้ได้ทีละ field ทั้งระบบ, null = ไม่มี field ไหนกำลังแก้
  private readonly activeEdit = signal<{ ticketId: string; field: EditableField } | null>(null);
  // ค่า draft ระหว่างแก้ไข — ไม่ยิง API จนกว่าจะกด Save (saveEditField)
  editTitle = '';
  editDescription = '';
  editCustomerId: string | null = null;
  editAssigneeIds: string[] = [];
  collapsed = signal(false);

  // id ของ ticket ที่เปิด drawer รายละเอียด/comment อยู่ (null = ปิด) — เก็บแค่ id แล้ว lookup จาก tickets() สดทุกครั้ง
  // กัน object ค้างเก่าหลัง loadTickets() (เช่น commentCount/field อื่นเปลี่ยนระหว่างเปิด drawer อยู่)
  private readonly drawerTicketId = signal<string | null>(null);
  readonly drawerTicket = computed<TicketCard | null>(() => {
    const id = this.drawerTicketId();
    return id ? (this.tickets().find(ticket => ticket.id === id) ?? null) : null;
  });

  // filter ของ ceo/admin (กรองฝั่ง client — backend ส่งทุก ticket มาให้ ceo/admin อยู่แล้ว)
  teamFilter = signal<TicketRole | null>(null);
  personFilter = signal<string | null>(null);

  // ข้อความค้นหา (กรองฝั่ง client เหมือน filter ทีม/คน)
  searchText = signal('');

  // แบ่งหน้า (แบ่งฝั่ง client เหมือน filter — backend ส่งทุก ticket มาอยู่แล้ว)
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  pageSize = signal(DEFAULT_PAGE_SIZE);
  page = signal(1);

  // ฟอร์มเพิ่ม ticket
  newCustomerId: string | null = null;
  newStartDate: Date | null = null;
  newDaysAllotted: number | null = null;
  newAssigneeIds: string[] = [];

  readonly statusOptions = (Object.keys(STATUS_META) as TicketStatus[]).map(value => ({ value, ...STATUS_META[value] }));

  readonly columnCount = COLUMN_COUNT;

  readonly isManager = computed<boolean>(() => {
    const role = this.me()?.role;
    return role === 'ceo' || role === 'admin';
  });

  // ceo/admin: filter ตามทีม/คนได้ (มองเห็นทุก ticket อยู่แล้ว) | role อื่น: เห็นเฉพาะ ticket ของทีมตัวเอง (backend กรองมาแล้ว) ไม่ต้อง filter ซ้ำ
  readonly filteredTickets = computed<TicketCard[]>(() => {
    if (!this.isManager()) return this.tickets();

    const team = this.teamFilter();
    const person = this.personFilter();
    return this.tickets().filter(ticket =>
      (!team || ticket.assignees.some(assignee => assignee.role === team)) &&
      (!person || ticket.assignees.some(assignee => assignee.id === person))
    );
  });

  // manager เห็นหลาย role จึงต่อท้าย role ในชื่อเพื่อแยกคนชื่อซ้ำ; role อื่นเห็นทีมเดียวจึงใช้ชื่ออย่างเดียว
  readonly assigneeOptions = computed<AssigneeOption[]>(() =>
    this.assignees().map(assignee => ({
      ...assignee,
      label: this.isManager() ? `${assignee.name} · ${ROLE_LABELS[assignee.role]}` : assignee.name
    }))
  );

  // ตัวเลือก filter "คน" ตามทีมที่เลือกอยู่ (เฉพาะ ceo/admin ที่เห็น filter นี้)
  readonly personOptions = computed<AssigneeOption[]>(() => {
    const team = this.teamFilter();
    return team ? this.assigneeOptions().filter(option => option.role === team) : this.assigneeOptions();
  });

  // ตารางเดียว: ค้นหา + แบ่งหน้าจาก filteredTickets() — หน้าปัจจุบันถูก clamp เพราะลบ/ค้นหาแล้วจำนวนหน้าอาจลดลง
  readonly board = computed<TicketBoardView>(() => {
    const tickets = this.searchTickets(this.filteredTickets());
    const size = this.pageSize();
    const totalPages = Math.max(1, Math.ceil(tickets.length / size));
    const currentPage = Math.min(this.page(), totalPages);
    const start = (currentPage - 1) * size;
    return { tickets, visibleTickets: tickets.slice(start, start + size), currentPage, totalPages };
  });

  ngOnInit(): void {
    this.loadMe();
  }

  private loadMe(): void {
    this.ticketService.getMe().subscribe({
      next: me => {
        this.me.set(me);
        this.loadTickets();
        this.loadAssignees();
      },
      error: err => {
        this.notifyError('Load Failed', this.errorMessage(err, 'Unable to load your Ticket profile'));
        this.ticketsLoading.set(false);
      }
    });
  }

  // input: onSettled — เรียกเมื่อโหลดเสร็จไม่ว่าสำเร็จหรือพัง (ใช้ปลด pending ของ toggle/delete หลัง list อัปเดตแล้ว)
  private loadTickets(onSettled?: () => void): void {
    this.ticketService.getAll().subscribe({
      next: list => {
        this.tickets.set(list);
        this.ticketsLoading.set(false);
        onSettled?.();
      },
      error: err => {
        this.notifyError('Load Failed', this.errorMessage(err, 'Unable to load tickets'));
        this.ticketsLoading.set(false);
        onSettled?.();
      }
    });
  }

  isTicketPending(id: string): boolean {
    return this.pendingTicketIds().has(id);
  }

  private setTicketPending(id: string, pending: boolean): void {
    this.pendingTicketIds.update(current => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  isEditingField(ticketId: string, field: EditableField): boolean {
    const active = this.activeEdit();
    return !!active && active.ticketId === ticketId && active.field === field;
  }

  // เข้าโหมดแก้ไข field เดียว: คัดลอกค่าปัจจุบันมาเป็น draft ก่อน — เปลี่ยนแล้วไม่ยิง API ทันที ต้องกด Save เท่านั้น
  // แก้ได้ทีละ field ทั้งระบบ — เปิด field ใหม่ระหว่างที่อันเดิมยังไม่ได้กด Save จะทิ้ง draft เดิมไปเลย
  startEditField(ticket: TicketCard, field: EditableField): void {
    this.activeEdit.set({ ticketId: ticket.id, field });
    switch (field) {
      case 'task':
        this.editTitle = ticket.title;
        this.editDescription = ticket.description ?? '';
        break;
      case 'customer':
        this.editCustomerId = ticket.customerId;
        break;
      case 'assignees':
        this.editAssigneeIds = ticket.assignees.map(assignee => assignee.id);
        break;
    }
  }

  // ปิดโหมดแก้ไขโดยไม่บันทึก — ทิ้ง draft ของ field นั้น
  cancelEditField(): void {
    this.activeEdit.set(null);
  }

  // input: ticket ที่กำลังแก้, field ที่จะ save — output: ยิง PATCH เฉพาะ field นั้น สำเร็จแล้วค่อยกลับไปโหมดดู (plain text/badge)
  saveEditField(ticket: TicketCard, field: EditableField): void {
    if (this.isTicketPending(ticket.id)) return;

    const patch: UpdateTicketPayload = {};
    switch (field) {
      case 'task': {
        const title = this.editTitle.trim();
        if (!title) {
          this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Title is required' });
          return;
        }
        patch.title = title;
        patch.description = this.editDescription.trim() || null;
        break;
      }
      case 'customer':
        patch.customer_id = this.editCustomerId;
        break;
      case 'assignees':
        if (!this.editAssigneeIds.length) {
          this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Select at least one assignee' });
          return;
        }
        patch.assignee_ids = this.editAssigneeIds;
        break;
    }

    this.setTicketPending(ticket.id, true);
    this.ticketService.update(ticket.id, patch).subscribe({
      next: () => this.loadTickets(() => {
        this.setTicketPending(ticket.id, false);
        this.activeEdit.set(null);
      }),
      error: err => {
        this.setTicketPending(ticket.id, false);
        this.notifyError('Update Failed', this.errorMessage(err, 'Unable to update ticket'));
      }
    });
  }

  private loadAssignees(): void {
    this.ticketService.getAssignees().subscribe({
      next: list => this.assignees.set(list),
      error: err => this.notifyError('Load Failed', this.errorMessage(err, 'Unable to load assignees'))
    });
  }

  // แจ้ง error จาก API เป็น toast มุมจอ — แทนที่ข้อความ error แบบ inline เดิมที่ค้างอยู่บนหน้าจอจนกว่าจะลองใหม่
  private notifyError(summary: string, detail: string): void {
    this.messageService.add({ severity: 'error', summary, detail });
  }

  // input: error จาก HttpClient, ข้อความ fallback — output: message จาก backend ถ้ามี (string หรือ array จาก class-validator) ไม่งั้น fallback
  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message: unknown = err.error?.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(', ');
    }
    return fallback;
  }

  // input: Date จาก p-datepicker — output: string "YYYY-MM-DD" ให้ API (ใช้ local date, ไม่ใช้ toISOString เพื่อกัน timezone เพี้ยน)
  private toDateString(date: Date | null): string | undefined {
    if (!date) return undefined;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // input: "YYYY-MM-DD" — output: Date ที่เที่ยงคืน local time (ไม่ใช้ new Date(string) ตรงๆ เพราะ parse เป็น UTC ทำให้วันเพี้ยนข้ามโซนเวลา)
  private parseDateString(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  // cache ผลลัพธ์ไว้ตาม string — สำคัญมาก: ถ้าไม่ cache แล้วเรียก new Date() ใหม่ทุกครั้งที่ template เรียก toDate()
  // p-datepicker จะเห็น [ngModel] เป็นค่า "เปลี่ยน" ทุก change detection cycle (reference ไม่เท่าเดิม) แล้วเรียก markForCheck()
  // วนลูป CD ไม่มีที่สิ้นสุดจนหน้าเว็บค้าง (เกิดเฉพาะ row ที่มี startDate/closeDate จริง ไม่ใช่ null)
  private readonly dateCache = new Map<string, Date>();

  // input: "YYYY-MM-DD" หรือ null — output: Date ให้ p-datepicker ผูก [ngModel] (คืน null ตรงๆ ถ้าไม่มีค่า)
  toDate(value: string | null): Date | null {
    if (!value) return null;
    let cached = this.dateCache.get(value);
    if (!cached) {
      cached = this.parseDateString(value);
      this.dateCache.set(value, cached);
    }
    return cached;
  }

  assigneeNames(ticket: TicketCard): string {
    return ticket.assignees.map(assignee => assignee.name).join(', ');
  }

  // input: ticket — output: จำนวนวัน overdue (>0) หรือ null ถ้าไม่มี startDate/daysAllotted หรือยังไม่เกินกำหนด
  // สูตร: (closeDate ?? วันนี้) − (startDate + daysAllotted) — ปิดงานแล้วหยุดนับที่ close date ไม่นับเพิ่มอีก
  daysOverdue(ticket: TicketCard): number | null {
    if (!ticket.startDate || ticket.daysAllotted === null) return null;

    const deadline = this.parseDateString(ticket.startDate);
    deadline.setDate(deadline.getDate() + ticket.daysAllotted);

    const end = ticket.closeDate ? this.parseDateString(ticket.closeDate) : new Date();
    end.setHours(0, 0, 0, 0);
    deadline.setHours(0, 0, 0, 0);

    const diffDays = Math.round((end.getTime() - deadline.getTime()) / 86400000);
    return diffDays > 0 ? diffDays : null;
  }

  // input: ticket — output: Date กำหนดส่ง (startDate + daysAllotted) หรือ null ถ้าข้อมูลไม่ครบ — ใช้แสดง "Due Date" ใน drawer
  dueDate(ticket: TicketCard): Date | null {
    if (!ticket.startDate || ticket.daysAllotted === null) return null;
    const deadline = this.parseDateString(ticket.startDate);
    deadline.setDate(deadline.getDate() + ticket.daysAllotted);
    return deadline;
  }

  // input: ticket — output: ป้ายนับถอยหลังกำหนดส่งสำหรับ drawer ("Due in N days" / "Due today" / "N days overdue"), null ถ้าไม่มีกำหนด
  // ต่างจาก daysOverdue() ที่คืนค่าเฉพาะตอนเลยกำหนดแล้ว — ตัวนี้ครอบคลุมทั้งก่อน/หลังกำหนด
  dueSummary(ticket: TicketCard): { text: string; overdue: boolean } | null {
    const deadline = this.dueDate(ticket);
    if (!deadline) return null;

    const end = ticket.closeDate ? this.parseDateString(ticket.closeDate) : new Date();
    end.setHours(0, 0, 0, 0);
    deadline.setHours(0, 0, 0, 0);

    const diffDays = Math.round((deadline.getTime() - end.getTime()) / 86400000);
    if (diffDays > 0) return { text: `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`, overdue: false };
    if (diffDays === 0) return { text: 'Due today', overdue: false };
    return { text: `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} overdue`, overdue: true };
  }

  // input: ชื่อเต็มของ assignee — output: อักษรแรกตัวเดียวตัวใหญ่ ใช้ทำ avatar ย่อใน drawer (Assignees)
  initials(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  // สมาชิกทีมเห็น ticket เพื่อนร่วมทีมได้แต่แก้ไม่ได้ — backend บังคับเช่นเดียวกัน ตรงนี้แค่ซ่อนปุ่มไม่ให้กดแล้วเจอ 403
  canModify(ticket: TicketCard): boolean {
    const me = this.me();
    return this.isManager() || (!!me && ticket.assignees.some(assignee => assignee.id === me.id));
  }

  // input: ticket ที่ผ่าน filter อื่นแล้ว — output: ticket ที่ title / description / ชื่อผู้รับ มีข้อความค้นหา (ไม่สนตัวพิมพ์เล็กใหญ่)
  private searchTickets(tickets: TicketCard[]): TicketCard[] {
    const query = this.searchText().trim().toLowerCase();
    if (!query) return tickets;

    return tickets.filter(ticket => {
      const haystack = [
        ticket.title,
        ticket.description ?? '',
        ticket.customerName ?? '',
        ...ticket.assignees.map(assignee => assignee.name)
      ];
      return haystack.some(text => text.toLowerCase().includes(query));
    });
  }

  setPage(page: number): void {
    this.page.set(Math.max(1, page));
  }

  // เปลี่ยนจำนวนต่อหน้าแล้วกลับหน้า 1 ไม่พยายามรักษาตำแหน่งเดิม
  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.setPage(1);
  }

  setSearchText(value: string): void {
    this.searchText.set(value);
    this.setPage(1);
  }

  setPersonFilter(id: string | null): void {
    this.personFilter.set(id);
    this.setPage(1);
  }

  toggleCollapsed(): void {
    this.collapsed.update(current => !current);
  }

  // เปิด drawer รายละเอียด + comment ของ ticket นี้ (คลิกที่ title)
  openTaskDrawer(ticket: TicketCard): void {
    this.drawerTicketId.set(ticket.id);
  }

  closeTaskDrawer(): void {
    this.drawerTicketId.set(null);
  }

  // ผูกกับ (visibleChange) ของ p-dialog — ปิดด้วย X/Esc/คลิก mask ก็ต้องเคลียร์ state เหมือนกด close เอง
  onDrawerVisibleChange(visible: boolean): void {
    if (!visible) this.closeTaskDrawer();
  }

  // input: TicketStatus — output: label + สีจุด ใช้แสดง badge สถานะใน drawer (ชุดเดียวกับ statusOptions ที่ผูกกับ p-select ในตาราง)
  statusMeta(status: TicketStatus): { label: string; color: string } {
    return STATUS_META[status];
  }

  // input: "YYYY-MM-DD"/Date/null — output: "dd/mm/yyyy" สำหรับแสดงผลอย่างเดียวใน drawer (ตารางยังใช้ p-datepicker ของมันเองแยกกัน)
  // รับได้ทั้ง string ดิบจาก TicketCard และ Date ที่คำนวณเอง (เช่น dueDate()) กันโค้ดซ้ำ
  formatDate(value: string | Date | null): string {
    if (!value) return '—';
    const date = typeof value === 'string' ? this.parseDateString(value) : value;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getFullYear()}`;
  }

  // คนที่ @mention ได้ในแผง comment ของ ticket นี้ — เฉพาะคนที่มองเห็น ticket นี้ได้ (privileged + assignee role เดียวกับ ticket)
  // เกณฑ์เดียวกับที่ backend ใช้กรอง getAll()/assertCanView — ดูเหตุผลใน tickets.service.ts ฝั่ง backend
  commentMentionOptions(ticket: TicketCard): AssigneeOption[] {
    const privileged: readonly TicketRole[] = ['ceo', 'admin'];
    return this.assigneeOptions().filter(option =>
      privileged.includes(option.role) || ticket.assignees.some(assignee => assignee.role === option.role)
    );
  }

  // comment ถูกเพิ่ม/ลบใน child component — reload tickets list ทั้งชุดเพื่ออัปเดต commentCount บน badge (เหมือน pattern อื่นในไฟล์นี้)
  onCommentsChanged(): void {
    this.loadTickets();
  }

  // เปลี่ยนทีมแล้วคนที่เลือกไว้ไม่อยู่ทีมนั้น → ล้าง filter คน ไม่งั้นจะได้ list ว่างโดยไม่รู้สาเหตุ
  setTeamFilter(role: TicketRole | null): void {
    this.teamFilter.set(role);
    this.setPage(1);
    const person = this.personFilter();
    if (person && role && !this.assignees().some(assignee => assignee.id === person && assignee.role === role)) {
      this.personFilter.set(null);
    }
  }

  // input: ticket ที่ถูกติ๊ก, checkbox element — checkbox เปลี่ยนสถานะเองใน DOM ก่อน request จึงต้องคืนค่าเดิมถ้า backend ปฏิเสธ (binding [checked] ไม่เปลี่ยนเลยไม่รีเซ็ตให้)
  toggleTask(ticket: TicketCard, checkbox: HTMLInputElement): void {
    if (this.isTicketPending(ticket.id)) {
      checkbox.checked = ticket.isDone;
      return;
    }

    this.setTicketPending(ticket.id, true);
    this.ticketService.toggle(ticket.id).subscribe({
      next: () => this.loadTickets(() => this.setTicketPending(ticket.id, false)),
      error: err => {
        checkbox.checked = ticket.isDone;
        this.setTicketPending(ticket.id, false);
        this.notifyError('Update Failed', this.errorMessage(err, 'Unable to update ticket'));
      }
    });
  }

  // input: ticket ที่จะแก้, field ที่เปลี่ยน (undefined = ไม่แตะ, null = ล้างค่า) — ใช้ pendingTicketIds ชุดเดียวกับ toggle/delete กันแก้ซ้ำระหว่างรอ
  private applyTicketUpdate(ticket: TicketCard, patch: UpdateTicketPayload): void {
    if (this.isTicketPending(ticket.id)) return;

    this.setTicketPending(ticket.id, true);
    this.ticketService.update(ticket.id, patch).subscribe({
      next: () => this.loadTickets(() => this.setTicketPending(ticket.id, false)),
      error: err => {
        this.setTicketPending(ticket.id, false);
        this.notifyError('Update Failed', this.errorMessage(err, 'Unable to update ticket'));
      }
    });
  }

  // Status เท่านั้นที่ยัง save ทันทีตอนเปลี่ยน — เป็น badge dropdown คลิกได้เลยไม่ต้องกด Edit ก่อน (ต่างจาก 4 field ที่ผ่าน draft + Save)
  setTicketStatus(ticket: TicketCard, status: TicketStatus): void {
    this.applyTicketUpdate(ticket, { status });
  }

  // เลือกวันที่จาก p-datepicker แล้ว save ทันที (เหมือน Status) — คลิกช่องเปล่าแล้วเลือกได้เลยไม่ต้องกด Edit ก่อน
  // date เป็น null ตอนกดปุ่ม clear (onClear) — ต้องรับ null ได้ ไม่งั้นล้างค่าใน UI ได้แต่ไม่ save
  setTicketStartDate(ticket: TicketCard, date: Date | null): void {
    this.applyTicketUpdate(ticket, { start_date: this.toDateString(date) ?? null });
  }

  setTicketCloseDate(ticket: TicketCard, date: Date | null): void {
    this.applyTicketUpdate(ticket, { close_date: this.toDateString(date) ?? null });
  }

  // input: ticket — ก่อนล้างวันที่ทิ้งต้อง confirm ก่อนเสมอ กัน misclick ที่ช่อง datepicker เพราะกดปุ่ม clear ครั้งเดียวลบเลยไม่มีขั้นตอน Save
  // reject: ต้องลบ dateCache entry ของค่าเดิมทิ้งด้วย ไม่งั้น p-datepicker จะไม่รู้ว่าต้องเซ็ตค่ากลับ (reference เดิมเหมือนก่อน clear เลยไม่ trigger เขียนใหม่)
  confirmClearTicketStartDate(ticket: TicketCard): void {
    const previous = ticket.startDate;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Clear start date of "${ticket.title}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.setTicketStartDate(ticket, null),
      reject: () => { if (previous) this.dateCache.delete(previous); }
    });
  }

  confirmClearTicketCloseDate(ticket: TicketCard): void {
    const previous = ticket.closeDate;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Clear close date of "${ticket.title}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.setTicketCloseDate(ticket, null),
      reject: () => { if (previous) this.dateCache.delete(previous); }
    });
  }

  // input: event ของ input[type=number] — พิมพ์เสร็จแล้ว blur/Enter ถึง save (change event) ไม่ save ทุก keystroke, ลบค่าจนว่างเปล่า = null
  setTicketDaysAllotted(ticket: TicketCard, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.applyTicketUpdate(ticket, { days_allotted: value === '' ? null : Number(value) });
  }

  deleteTask(id: string): void {
    if (this.isTicketPending(id)) return;

    this.setTicketPending(id, true);
    this.ticketService.delete(id).subscribe({
      next: () => this.loadTickets(() => this.setTicketPending(id, false)),
      error: err => {
        this.setTicketPending(id, false);
        this.notifyError('Delete Failed', this.errorMessage(err, 'Unable to delete ticket'));
      }
    });
  }

  addTask(titleInput: HTMLInputElement, descriptionInput: HTMLTextAreaElement): void {
    const title = titleInput.value.trim();
    if (!title || this.isSubmitting()) return;

    if (!this.newAssigneeIds.length) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Select at least one assignee' });
      return;
    }
    const description = descriptionInput.value.trim();

    this.isSubmitting.set(true);
    this.ticketService.create({
      title,
      description: description || undefined,
      customer_id: this.newCustomerId ?? undefined,
      start_date: this.toDateString(this.newStartDate),
      days_allotted: this.newDaysAllotted ?? undefined,
      assignee_ids: this.newAssigneeIds
    }).subscribe({
      next: () => {
        this.loadTickets();
        titleInput.value = '';
        descriptionInput.value = '';
        this.newCustomerId = null;
        this.newStartDate = null;
        this.newDaysAllotted = null;
        this.newAssigneeIds = [];
        this.isSubmitting.set(false);
      },
      error: err => {
        this.notifyError('Add Failed', this.errorMessage(err, 'Unable to add ticket'));
        this.isSubmitting.set(false);
      }
    });
  }
}
