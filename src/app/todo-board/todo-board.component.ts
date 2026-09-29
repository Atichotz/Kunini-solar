import { Component, Input, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DialogModule } from 'primeng/dialog';
import { ImageModule } from 'primeng/image';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TodoService } from '../services/todo.service';
import { TodoCommentsComponent } from './todo-comments/todo-comments.component';
import { ATTACHMENT_ACCEPT, FilePreviewCache, mergeAttachmentFiles } from '../attachment-files.util';
import type { Customer } from '../services/workflow.service';
import type { TodoAttachment, TodoCard, TodoAssignee, TodoRole, TodoStatus, UpdateTodoPayload } from '../dto/todo.dto';

// การ์ด To-Do ที่ collapse ได้: manager เห็น 'all' ใบเดียว, role อื่นเห็น 'mine' + 'team'
type TodoCardKey = 'all' | 'mine' | 'team';

// field ที่แก้ไขแบบ inline ได้ทีละอัน (Status/startDate/daysAllotted/closeDate ไม่รวม เพราะคลิกแล้วเปลี่ยน/save ได้ทันทีอยู่แล้วเหมือน badge dropdown)
type EditableField = 'task' | 'customer' | 'assignees';

// ค่า draft ของโหมดแก้ไขใน drawer (ปุ่ม Edit ปุ่มเดียวแก้ทุก field พร้อมกัน แล้ว Save ครั้งเดียว)
interface DrawerDraft {
  description: string;
  customerId: string | null;
  startDate: Date | null;
  daysAllotted: number | null;
  closeDate: Date | null;
  assigneeIds: string[];
}

export interface AssigneeOption extends TodoAssignee {
  label: string;
}

// จำนวนงานต่อหน้าที่ให้เลือก และค่าเริ่มต้น
const PAGE_SIZE_OPTIONS = [5, 10, 20, 30] as const;
const DEFAULT_PAGE_SIZE = 10;

interface TodoCardView {
  key: TodoCardKey;
  title: string;
  // งานทั้งหมดหลังกรอง (ใช้แสดงจำนวนรวมที่หัวการ์ด) — visibleTodos คือเฉพาะหน้าปัจจุบัน
  todos: TodoCard[];
  visibleTodos: TodoCard[];
  currentPage: number;
  totalPages: number;
  showFilters: boolean;
}

const ROLE_LABELS: Record<TodoRole, string> = {
  ceo: 'CEO',
  admin: 'Admin',
  technician: 'Technician',
  purchasing: 'Purchasing'
};

// สีจุดหน้า Status dropdown ตาม reference (Notion)
const STATUS_META: Record<TodoStatus, { label: string; color: string }> = {
  todo: { label: 'Not started', color: 'var(--k-accent-orange)' },
  to_schedule: { label: 'To Schedule', color: 'var(--k-accent-blue)' },
  in_progress: { label: 'In Progress', color: 'var(--k-accent-blue)' },
  done: { label: 'Done', color: 'var(--k-accent-green)' }
};

// To-Do cards + Add Task ใช้ร่วมกันระหว่าง Dashboard (ทุกลูกค้า) และ Customer Detail (ลูกค้ารายเดียว)
// [customerId] ว่าง = โหมด dashboard เห็นทุกงาน, มีค่า = กรองเฉพาะงานของลูกค้านั้นและซ่อนคอลัมน์/ฟิลด์ Customer
// role ที่มองเห็น/จัดการ task ได้ทุกใบ — ใช้คำนวณว่าใครมองเห็น task ไหนได้บ้าง (ดู commentMentionOptions)
const PRIVILEGED_ROLES: readonly TodoRole[] = ['ceo', 'admin'];

@Component({
  selector: 'app-todo-board',
  imports: [RouterLink, FormsModule, SelectModule, MultiSelectModule, DatePickerModule, ProgressSpinnerModule, DialogModule, ImageModule, ConfirmDialogModule, ToastModule, TodoCommentsComponent],
  templateUrl: './todo-board.component.html',
  styleUrl: './todo-board.component.scss',
  providers: [ConfirmationService, MessageService]
})
export class TodoBoardComponent implements OnInit, OnDestroy {
  private readonly todoService = inject(TodoService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // ล็อกงานให้เป็นของลูกค้ารายนี้เมื่อฝังในหน้า customer detail
  @Input() customerId: string | null = null;

  // ตัวเลือกลูกค้าสำหรับ dropdown ผูก todo เรียงชื่อ ก-ฮ ไว้แล้ว (มีผลเฉพาะโหมดไม่ล็อก customerId)
  // ต้อง cache ผลลัพธ์ตอนรับ @Input แทนการ sort ใน getter ทุก change detection cycle — ไม่งั้น p-select ได้ [options]
  // เป็น reference ใหม่ทุกรอบ (อาการคล้าย dateCache ด้านล่างที่กันไว้สำหรับ p-datepicker)
  customerOptions: Customer[] = [];
  @Input() set customers(list: Customer[]) {
    this.customerOptions = [...list].sort((a, b) => a.name.localeCompare(b.name));
  }

  readonly teamOptions = (Object.keys(ROLE_LABELS) as TodoRole[]).map(role => ({ role, label: ROLE_LABELS[role] }));

  // ตัวเองใน allowed_users — role ตรงนี้ (ไม่ใช่ PermissionService) ใช้ตัดสินว่าแสดง 1 หรือ 2 การ์ด เพื่อให้ตรงกับที่ backend กรอง
  me = signal<TodoAssignee | null>(null);
  todos = signal<TodoCard[]>([]);
  assignees = signal<TodoAssignee[]>([]);
  isSubmitting = signal(false);
  // true จนกว่าโหลด me + รายการงานครั้งแรกเสร็จ (หรือพัง) — กันการ์ดว่างที่ดูเหมือน "ไม่มีงาน"
  todosLoading = signal(true);
  // จำนวนงานทั้งหมด (ไม่ผ่าน filter) — ใช้แสดง badge บน tab ของ dashboard
  readonly totalCount = computed<number>(() => this.todos().length);
  // id งานที่กำลัง toggle/ลบอยู่ — กันกดซ้ำระหว่างรอ request + refetch
  private readonly pendingTodoIds = signal<ReadonlySet<string>>(new Set());
  // field ที่กำลังแก้ไขอยู่ (แยกอิสระต่อ field ไม่ใช่ทั้งแถว) — แก้ได้ทีละ field ทั้งระบบ, null = ไม่มี field ไหนกำลังแก้
  private readonly activeEdit = signal<{ todoId: string; field: EditableField } | null>(null);
  // ค่า draft ระหว่างแก้ไข — ไม่ยิง API จนกว่าจะกด Save (saveEditField)
  editTitle = '';
  editDescription = '';
  editCustomerId: string | null = null;
  editAssigneeIds: string[] = [];
  collapsed = signal<Record<TodoCardKey, boolean>>({ all: false, mine: false, team: false });

  // id ของ task ที่เปิด drawer รายละเอียด/comment อยู่ (null = ปิด) — เก็บแค่ id แล้ว lookup จาก todos() สดทุกครั้ง
  // กัน object ค้างเก่าหลัง loadTodos() (เช่น commentCount/field อื่นเปลี่ยนระหว่างเปิด drawer อยู่)
  private readonly drawerTodoId = signal<string | null>(null);
  // ไฟล์แนบของ task ที่เปิด drawer อยู่ — โหลดตอนเปิดเท่านั้น (ไม่ฝังใน TodoCard เพราะต้อง sign URL ต่อไฟล์)
  readonly drawerAttachments = signal<TodoAttachment[]>([]);
  readonly drawerTodo = computed<TodoCard | null>(() => {
    const id = this.drawerTodoId();
    return id ? (this.todos().find(todo => todo.id === id) ?? null) : null;
  });

  // โหมดแก้ไขของ drawer — แยกจาก activeEdit/editXxx ของตารางโดยเจตนา: ตารางอยู่หลัง modal ถ้าใช้ state ร่วมกัน
  // การแก้ใน drawer จะเปิด edit-row หลังฉากด้วย และ draft ที่พิมพ์ค้างไว้ในตารางจะถูกทับเงียบๆ
  readonly drawerEditing = signal(false);
  drawerDraft: DrawerDraft = { description: '', customerId: null, startDate: null, daysAllotted: null, closeDate: null, assigneeIds: [] };

  // filter ของ ceo/admin (กรองฝั่ง client — backend ส่งทุกงานมาให้ ceo/admin อยู่แล้ว)
  teamFilter = signal<TodoRole | null>(null);
  personFilter = signal<string | null>(null);

  // ข้อความค้นหาแยกตามการ์ด (กรองฝั่ง client เหมือน filter ทีม/คน)
  searchText = signal<Record<TodoCardKey, string>>({ all: '', mine: '', team: '' });

  // แบ่งหน้าแยกตามการ์ด (แบ่งฝั่ง client เหมือน filter — backend ส่งทุกงานมาอยู่แล้ว)
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  pageSize = signal<Record<TodoCardKey, number>>({ all: DEFAULT_PAGE_SIZE, mine: DEFAULT_PAGE_SIZE, team: DEFAULT_PAGE_SIZE });
  page = signal<Record<TodoCardKey, number>>({ all: 1, mine: 1, team: 1 });

  // ฟอร์มเพิ่มงาน (ใช้ร่วมกันทุกการ์ด เพราะมีฟอร์มเดียวต่อหน้า)
  newCustomerId: string | null = null;
  newStartDate: Date | null = null;
  newDaysAllotted: number | null = null;
  newAssigneeIds: string[] = [];
  // ไฟล์ที่เลือกไว้รอแนบ — อัปโหลดเป็นไฟล์แนบของ task (แสดงใต้ Description ใน drawer) หลังสร้างสำเร็จ
  newFiles = signal<File[]>([]);
  readonly attachmentAccept = ATTACHMENT_ACCEPT;
  // thumbnail ของรูปที่เลือกไว้รอแนบ — PDF/ไฟล์อื่นไม่มี preview (urlFor คืน null)
  readonly filePreviews = new FilePreviewCache();

  readonly statusOptions = (Object.keys(STATUS_META) as TodoStatus[]).map(value => ({ value, ...STATUS_META[value] }));

  // จำนวนคอลัมน์ของตาราง — ล็อก customerId แล้วซ่อนคอลัมน์ Customer จึงเหลือ 9 (ใช้กับ colspan ของแถวพิเศษ)
  get columnCount(): number {
    return this.customerId ? 9 : 10;
  }

  readonly isManager = computed<boolean>(() => {
    const role = this.me()?.role;
    return role === 'ceo' || role === 'admin';
  });

  // งานที่มี assignee เป็นตัวเอง
  readonly myTodos = computed<TodoCard[]>(() => {
    const me = this.me();
    if (!me) return [];
    return this.todos().filter(todo => todo.assignees.some(assignee => assignee.id === me.id));
  });

  // manager: งานที่ผ่าน filter ทีม (มี assignee role นั้นอย่างน้อย 1 คน) และคน
  readonly filteredTodos = computed<TodoCard[]>(() => {
    const team = this.teamFilter();
    const person = this.personFilter();
    return this.todos().filter(todo =>
      (!team || todo.assignees.some(assignee => assignee.role === team)) &&
      (!person || todo.assignees.some(assignee => assignee.id === person))
    );
  });

  // manager เห็นหลาย role จึงต่อท้าย role ในชื่อเพื่อแยกคนชื่อซ้ำ; role อื่นเห็นทีมเดียวจึงใช้ชื่ออย่างเดียว
  readonly assigneeOptions = computed<AssigneeOption[]>(() =>
    this.assignees().map(assignee => ({
      ...assignee,
      label: this.isManager() ? `${assignee.name} · ${ROLE_LABELS[assignee.role]}` : assignee.name
    }))
  );

  // ตัวเลือก filter "คน" ตามทีมที่เลือกอยู่
  readonly personOptions = computed<AssigneeOption[]>(() => {
    const team = this.teamFilter();
    return team ? this.assigneeOptions().filter(option => option.role === team) : this.assigneeOptions();
  });

  // manager: การ์ดเดียวพร้อม filter | role อื่น: My To-Do (อ่าน/ติ๊กอย่างเดียว) + Team To-Do
  // งานที่ assign ให้ตัวเองจะอยู่ทั้งสองการ์ด เพราะ Team คือทุกงานของทีมรวมงานของเราด้วย
  readonly cards = computed<TodoCardView[]>(() =>
    this.isManager()
      ? [this.toCardView('all', 'Task', this.filteredTodos(), true)]
      : [
        this.toCardView('mine', 'My Task', this.myTodos(), false),
        this.toCardView('team', 'Team Task', this.todos(), false)
      ]
  );

  ngOnInit(): void {
    this.loadMe();
  }

  // ต้องรู้ role ก่อนถึงจะรู้ว่าแสดงกี่การ์ด จึงโหลด me ก่อนแล้วค่อยโหลดที่เหลือ
  private loadMe(): void {
    this.todoService.getMe().subscribe({
      next: me => {
        this.me.set(me);
        this.loadTodos();
        this.loadAssignees();
      },
      error: err => {
        this.notifyError('Load Failed', this.errorMessage(err, 'Unable to load your To-Do profile'));
        this.todosLoading.set(false);
      }
    });
  }

  // input: onSettled — เรียกเมื่อโหลดเสร็จไม่ว่าสำเร็จหรือพัง (ใช้ปลด pending ของ toggle/delete หลัง list อัปเดตแล้ว)
  private loadTodos(onSettled?: () => void): void {
    this.todoService.getAll().subscribe({
      next: list => {
        // getAll() ไม่มี param กรองตาม customer — ล็อก customerId แล้วกรองฝั่ง client เอา
        this.todos.set(this.customerId ? list.filter(todo => todo.customerId === this.customerId) : list);
        this.todosLoading.set(false);
        onSettled?.();
      },
      error: err => {
        this.notifyError('Load Failed', this.errorMessage(err, 'Unable to load tasks'));
        this.todosLoading.set(false);
        onSettled?.();
      }
    });
  }

  isTodoPending(id: string): boolean {
    return this.pendingTodoIds().has(id);
  }

  private setTodoPending(id: string, pending: boolean): void {
    this.pendingTodoIds.update(current => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  isEditingField(todoId: string, field: EditableField): boolean {
    const active = this.activeEdit();
    return !!active && active.todoId === todoId && active.field === field;
  }

  // เข้าโหมดแก้ไข field เดียว: คัดลอกค่าปัจจุบันมาเป็น draft ก่อน — เปลี่ยนแล้วไม่ยิง API ทันที ต้องกด Save เท่านั้น
  // แก้ได้ทีละ field ทั้งระบบ — เปิด field ใหม่ระหว่างที่อันเดิมยังไม่ได้กด Save จะทิ้ง draft เดิมไปเลย
  startEditField(todo: TodoCard, field: EditableField): void {
    this.activeEdit.set({ todoId: todo.id, field });
    switch (field) {
      case 'task':
        this.editTitle = todo.title;
        this.editDescription = todo.description ?? '';
        break;
      case 'customer':
        this.editCustomerId = todo.customerId;
        break;
      case 'assignees':
        this.editAssigneeIds = todo.assignees.map(assignee => assignee.id);
        break;
    }
  }

  // ปิดโหมดแก้ไขโดยไม่บันทึก — ทิ้ง draft ของ field นั้น
  cancelEditField(): void {
    this.activeEdit.set(null);
  }

  // input: todo ที่กำลังแก้, field ที่จะ save — output: ยิง PATCH เฉพาะ field นั้น สำเร็จแล้วค่อยกลับไปโหมดดู (plain text/badge)
  saveEditField(todo: TodoCard, field: EditableField): void {
    if (this.isTodoPending(todo.id)) return;

    const patch: UpdateTodoPayload = {};
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

    this.setTodoPending(todo.id, true);
    this.todoService.update(todo.id, patch).subscribe({
      next: () => this.loadTodos(() => {
        this.setTodoPending(todo.id, false);
        this.activeEdit.set(null);
      }),
      error: err => {
        this.setTodoPending(todo.id, false);
        this.notifyError('Update Failed', this.errorMessage(err, 'Unable to update task'));
      }
    });
  }

  private loadAssignees(): void {
    this.todoService.getAssignees().subscribe({
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

  assigneeNames(todo: TodoCard): string {
    return todo.assignees.map(assignee => assignee.name).join(', ');
  }

  // input: todo — output: จำนวนวัน overdue (>0) หรือ null ถ้าไม่มี startDate/daysAllotted หรือยังไม่เกินกำหนด
  // สูตร: (closeDate ?? วันนี้) − (startDate + daysAllotted) — ปิดงานแล้วหยุดนับที่ close date ไม่นับเพิ่มอีก
  daysOverdue(todo: TodoCard): number | null {
    if (!todo.startDate || todo.daysAllotted === null) return null;

    const deadline = this.parseDateString(todo.startDate);
    deadline.setDate(deadline.getDate() + todo.daysAllotted);

    const end = todo.closeDate ? this.parseDateString(todo.closeDate) : new Date();
    end.setHours(0, 0, 0, 0);
    deadline.setHours(0, 0, 0, 0);

    const diffDays = Math.round((end.getTime() - deadline.getTime()) / 86400000);
    return diffDays > 0 ? diffDays : null;
  }

  // input: todo — output: Date กำหนดส่ง (startDate + daysAllotted) หรือ null ถ้าข้อมูลไม่ครบ — ใช้แสดง "Due Date" ใน drawer
  dueDate(todo: TodoCard): Date | null {
    if (!todo.startDate || todo.daysAllotted === null) return null;
    const deadline = this.parseDateString(todo.startDate);
    deadline.setDate(deadline.getDate() + todo.daysAllotted);
    return deadline;
  }

  // input: todo — output: ป้ายนับถอยหลังกำหนดส่งสำหรับ drawer ("Due in N days" / "Due today" / "N days overdue"), null ถ้าไม่มีกำหนด
  // ต่างจาก daysOverdue() ที่คืนค่าเฉพาะตอนเลยกำหนดแล้ว — ตัวนี้ครอบคลุมทั้งก่อน/หลังกำหนด
  dueSummary(todo: TodoCard): { text: string; overdue: boolean } | null {
    const deadline = this.dueDate(todo);
    if (!deadline) return null;

    const end = todo.closeDate ? this.parseDateString(todo.closeDate) : new Date();
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

  // สมาชิกทีมเห็นงานเพื่อนร่วมทีมได้แต่แก้ไม่ได้ — backend บังคับเช่นเดียวกัน ตรงนี้แค่ซ่อนปุ่มไม่ให้กดแล้วเจอ 403
  canModify(todo: TodoCard): boolean {
    const me = this.me();
    return this.isManager() || (!!me && todo.assignees.some(assignee => assignee.id === me.id));
  }

  // input: การ์ด, งานที่ผ่าน filter อื่นแล้ว — output: งานที่ title / description / ชื่อผู้รับงาน มีข้อความค้นหา (ไม่สนตัวพิมพ์เล็กใหญ่)
  private searchTodos(key: TodoCardKey, todos: TodoCard[]): TodoCard[] {
    const query = this.searchText()[key].trim().toLowerCase();
    if (!query) return todos;

    return todos.filter(todo => {
      const haystack = [
        todo.title,
        todo.description ?? '',
        todo.customerName ?? '',
        ...todo.assignees.map(assignee => assignee.name)
      ];
      return haystack.some(text => text.toLowerCase().includes(query));
    });
  }

  // input: การ์ด, งานที่ผ่าน filter ทีม/คนแล้ว, flag แสดง filter — output: view ของการ์ดพร้อมค้นหาและแบ่งหน้า
  // หน้าปัจจุบันถูก clamp เพราะลบงาน/ค้นหาแล้วจำนวนหน้าอาจลดลง ไม่งั้นจะเจอหน้าว่าง
  private toCardView(key: TodoCardKey, title: string, source: TodoCard[], showFilters: boolean): TodoCardView {
    const todos = this.searchTodos(key, source);
    const size = this.pageSize()[key];
    const totalPages = Math.max(1, Math.ceil(todos.length / size));
    const currentPage = Math.min(this.page()[key], totalPages);
    const start = (currentPage - 1) * size;
    return { key, title, todos, visibleTodos: todos.slice(start, start + size), currentPage, totalPages, showFilters };
  }

  setPage(key: TodoCardKey, page: number): void {
    this.page.update(current => ({ ...current, [key]: Math.max(1, page) }));
  }

  // เปลี่ยนจำนวนต่อหน้าแล้วกลับหน้า 1 ไม่พยายามรักษาตำแหน่งเดิม
  setPageSize(key: TodoCardKey, size: number): void {
    this.pageSize.update(current => ({ ...current, [key]: size }));
    this.setPage(key, 1);
  }

  // ค้นหา/filter เปลี่ยนแล้วผลลัพธ์เปลี่ยนทั้งชุด จึงกลับหน้า 1 ทุกการ์ด
  private resetPages(): void {
    this.page.set({ all: 1, mine: 1, team: 1 });
  }

  setSearchText(key: TodoCardKey, value: string): void {
    this.searchText.update(current => ({ ...current, [key]: value }));
    this.setPage(key, 1);
  }

  setPersonFilter(id: string | null): void {
    this.personFilter.set(id);
    this.resetPages();
  }

  toggleCollapsed(key: TodoCardKey): void {
    this.collapsed.update(current => ({ ...current, [key]: !current[key] }));
  }

  // เปิด drawer รายละเอียด + comment ของ task นี้ (คลิกที่ title)
  openTaskDrawer(todo: TodoCard): void {
    this.cancelDrawerEdit();
    this.drawerTodoId.set(todo.id);
    this.loadDrawerAttachments(todo.id);
  }

  // input: todo UUID — ตอบกลับมาช้ากว่าที่ผู้ใช้ปิด/เปิดอีก task ต้องทิ้งผล ไม่งั้นรูปของtaskเก่าไปโผล่ใน drawer ใหม่
  private loadDrawerAttachments(id: string): void {
    this.drawerAttachments.set([]);
    this.todoService.getAttachments(id).subscribe({
      next: list => {
        if (this.drawerTodoId() === id) this.drawerAttachments.set(list);
      },
      error: err => {
        if (this.drawerTodoId() === id) this.notifyError('Load Failed', this.errorMessage(err, 'Unable to load attachments'));
      }
    });
  }

  closeTaskDrawer(): void {
    this.cancelDrawerEdit();
    this.drawerTodoId.set(null);
    this.drawerAttachments.set([]);
  }

  // เข้าโหมดแก้ไข: คัดลอกค่าปัจจุบันของทุก field มาเป็น draft — ไม่ยิง API จนกว่าจะกด Save (saveDrawerEdit)
  // วันที่ใช้ toDate() ที่มี cache เท่านั้น ไม่งั้น p-datepicker เห็น [ngModel] เปลี่ยนทุกรอบ CD แล้ววนลูปค้างหน้า
  startDrawerEdit(todo: TodoCard): void {
    this.drawerDraft = {
      description: todo.description ?? '',
      customerId: todo.customerId,
      startDate: this.toDate(todo.startDate),
      daysAllotted: todo.daysAllotted,
      closeDate: this.toDate(todo.closeDate),
      assigneeIds: todo.assignees.map(assignee => assignee.id)
    };
    this.drawerEditing.set(true);
  }

  // ทิ้ง draft — เรียกตอนกด Cancel และตอนเปิด/ปิด drawer กัน draft ของtaskเก่าค้างไปโผล่ตอนเปิดtaskถัดไป
  cancelDrawerEdit(): void {
    this.drawerEditing.set(false);
  }

  // input: taskใน drawer — output: ยิง PATCH ครั้งเดียวเฉพาะ field ที่เปลี่ยนจริง (ไม่เขียนทับ field ที่คนอื่นเพิ่งแก้)
  // ไม่มีอะไรเปลี่ยน = ออกจากโหมดแก้ไขเฉยๆ ไม่ยิง API, description ว่าง/มีแต่ช่องว่าง = null
  saveDrawerEdit(todo: TodoCard): void {
    if (this.isTodoPending(todo.id)) return;

    const draft = this.drawerDraft;
    if (!draft.assigneeIds.length) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Select at least one assignee' });
      return;
    }
    // backend รับเฉพาะจำนวนเต็ม >= 0 (@IsInt @Min(0)) — เช็กก่อนส่ง ไม่งั้นโดน 400 กลับมาทีหลัง
    const days = draft.daysAllotted;
    if (days !== null && (!Number.isInteger(days) || days < 0)) {
      this.messageService.add({ severity: 'warn', summary: 'Invalid value', detail: 'Days must be a whole number, 0 or more' });
      return;
    }

    const patch: UpdateTodoPayload = {};
    const description = draft.description.trim() || null;
    if (description !== (todo.description?.trim() || null)) patch.description = description;
    if (draft.customerId !== todo.customerId) patch.customer_id = draft.customerId;
    const startDate = this.toDateString(draft.startDate) ?? null;
    if (startDate !== todo.startDate) patch.start_date = startDate;
    if (days !== todo.daysAllotted) patch.days_allotted = days;
    const closeDate = this.toDateString(draft.closeDate) ?? null;
    if (closeDate !== todo.closeDate) patch.close_date = closeDate;
    const currentAssigneeIds = todo.assignees.map(assignee => assignee.id);
    const assigneesChanged = draft.assigneeIds.length !== currentAssigneeIds.length
      || draft.assigneeIds.some(id => !currentAssigneeIds.includes(id));
    if (assigneesChanged) patch.assignee_ids = draft.assigneeIds;

    if (!Object.keys(patch).length) {
      this.cancelDrawerEdit();
      return;
    }

    this.setTodoPending(todo.id, true);
    this.todoService.update(todo.id, patch).subscribe({
      next: () => this.loadTodos(() => {
        this.setTodoPending(todo.id, false);
        // ผู้ใช้อาจปิด/เปิดtaskอื่นระหว่างรอ — cancelDrawerEdit() ถูกเรียกตอนนั้นไปแล้ว ไม่ต้องล้างซ้ำ
        if (this.drawerTodoId() === todo.id) this.cancelDrawerEdit();
      }),
      error: err => {
        this.setTodoPending(todo.id, false);
        this.notifyError('Update Failed', this.errorMessage(err, 'Unable to update task'));
      }
    });
  }

  // ผูกกับ (visibleChange) ของ p-dialog — ปิดด้วย X/Esc/คลิก mask ก็ต้องเคลียร์ state เหมือนกด close เอง
  onDrawerVisibleChange(visible: boolean): void {
    if (!visible) this.closeTaskDrawer();
  }

  // input: TodoStatus — output: label + สีจุด ใช้แสดง badge สถานะใน drawer (ชุดเดียวกับ statusOptions ที่ผูกกับ p-select ในตาราง)
  statusMeta(status: TodoStatus): { label: string; color: string } {
    return STATUS_META[status];
  }

  // input: "YYYY-MM-DD"/Date/null — output: "dd/mm/yyyy" สำหรับแสดงผลอย่างเดียวใน drawer (ตารางยังใช้ p-datepicker ของมันเองแยกกัน)
  // รับได้ทั้ง string ดิบจาก TodoCard และ Date ที่คำนวณเอง (เช่น dueDate()) กันโค้ดซ้ำ
  formatDate(value: string | Date | null): string {
    if (!value) return '—';
    const date = typeof value === 'string' ? this.parseDateString(value) : value;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getFullYear()}`;
  }

  // คนที่ @mention ได้ในแผง comment ของ task นี้ — เฉพาะคนที่มองเห็น task นี้ได้ (privileged + assignee role เดียวกับ task)
  // เกณฑ์เดียวกับที่ backend ใช้กรอง getAll()/assertCanView — ดูเหตุผลใน todos.service.ts ฝั่ง backend
  commentMentionOptions(todo: TodoCard): AssigneeOption[] {
    return this.assigneeOptions().filter(option =>
      PRIVILEGED_ROLES.includes(option.role) || todo.assignees.some(assignee => assignee.role === option.role)
    );
  }

  // comment ถูกเพิ่ม/ลบใน child component — reload todos list ทั้งชุดเพื่ออัปเดต commentCount บน badge (เหมือน pattern อื่นในไฟล์นี้)
  onCommentsChanged(): void {
    this.loadTodos();
  }

  // เปลี่ยนทีมแล้วคนที่เลือกไว้ไม่อยู่ทีมนั้น → ล้าง filter คน ไม่งั้นจะได้ list ว่างโดยไม่รู้สาเหตุ
  setTeamFilter(role: TodoRole | null): void {
    this.teamFilter.set(role);
    this.resetPages();
    const person = this.personFilter();
    if (person && role && !this.assignees().some(assignee => assignee.id === person && assignee.role === role)) {
      this.personFilter.set(null);
    }
  }

  // input: งานที่ถูกติ๊ก, checkbox element — checkbox เปลี่ยนสถานะเองใน DOM ก่อน request จึงต้องคืนค่าเดิมถ้า backend ปฏิเสธ (binding [checked] ไม่เปลี่ยนเลยไม่รีเซ็ตให้)
  toggleTask(todo: TodoCard, checkbox: HTMLInputElement): void {
    if (this.isTodoPending(todo.id)) {
      checkbox.checked = todo.isDone;
      return;
    }

    this.setTodoPending(todo.id, true);
    this.todoService.toggle(todo.id).subscribe({
      next: () => this.loadTodos(() => this.setTodoPending(todo.id, false)),
      error: err => {
        checkbox.checked = todo.isDone;
        this.setTodoPending(todo.id, false);
        this.notifyError('Update Failed', this.errorMessage(err, 'Unable to update task'));
      }
    });
  }

  // input: todo ที่จะแก้, field ที่เปลี่ยน (undefined = ไม่แตะ, null = ล้างค่า) — ใช้ pendingTodoIds ชุดเดียวกับ toggle/delete กันแก้ซ้ำระหว่างรอ
  private applyTodoUpdate(todo: TodoCard, patch: UpdateTodoPayload): void {
    if (this.isTodoPending(todo.id)) return;

    this.setTodoPending(todo.id, true);
    this.todoService.update(todo.id, patch).subscribe({
      next: () => this.loadTodos(() => this.setTodoPending(todo.id, false)),
      error: err => {
        this.setTodoPending(todo.id, false);
        this.notifyError('Update Failed', this.errorMessage(err, 'Unable to update task'));
      }
    });
  }

  // Status เท่านั้นที่ยัง save ทันทีตอนเปลี่ยน — เป็น badge dropdown คลิกได้เลยไม่ต้องกด Edit ก่อน (ต่างจาก 4 field ที่ผ่าน draft + Save)
  setTodoStatus(todo: TodoCard, status: TodoStatus): void {
    this.applyTodoUpdate(todo, { status });
  }

  // เลือกวันที่จาก p-datepicker แล้ว save ทันที (เหมือน Status) — คลิกช่องเปล่าแล้วเลือกได้เลยไม่ต้องกด Edit ก่อน
  // date เป็น null ตอนกดปุ่ม clear (onClear) — ต้องรับ null ได้ ไม่งั้นล้างค่าใน UI ได้แต่ไม่ save
  setTodoStartDate(todo: TodoCard, date: Date | null): void {
    this.applyTodoUpdate(todo, { start_date: this.toDateString(date) ?? null });
  }

  setTodoCloseDate(todo: TodoCard, date: Date | null): void {
    this.applyTodoUpdate(todo, { close_date: this.toDateString(date) ?? null });
  }

  // input: todo — ก่อนล้างวันที่ทิ้งต้อง confirm ก่อนเสมอ กัน misclick ที่ช่อง datepicker เพราะกดปุ่ม clear ครั้งเดียวลบเลยไม่มีขั้นตอน Save
  // reject: ต้องลบ dateCache entry ของค่าเดิมทิ้งด้วย ไม่งั้น p-datepicker จะไม่รู้ว่าต้องเซ็ตค่ากลับ (reference เดิมเหมือนก่อน clear เลยไม่ trigger เขียนใหม่)
  confirmClearTodoStartDate(todo: TodoCard): void {
    const previous = todo.startDate;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Clear start date of "${todo.title}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.setTodoStartDate(todo, null),
      reject: () => { if (previous) this.dateCache.delete(previous); }
    });
  }

  confirmClearTodoCloseDate(todo: TodoCard): void {
    const previous = todo.closeDate;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Clear close date of "${todo.title}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => this.setTodoCloseDate(todo, null),
      reject: () => { if (previous) this.dateCache.delete(previous); }
    });
  }

  // input: event ของ input[type=number] — พิมพ์เสร็จแล้ว blur/Enter ถึง save (change event) ไม่ save ทุก keystroke, ลบค่าจนว่างเปล่า = null
  setTodoDaysAllotted(todo: TodoCard, event: Event): void {
    const input = event.target as HTMLInputElement;
    const days = input.value === '' ? null : Number(input.value);
    // backend รับเฉพาะจำนวนเต็ม >= 0 (@IsInt @Min(0)) — ถ้าส่งไปจะโดน 400 และ [value] binding ไม่เปลี่ยนเลยช่องจะค้างค่าผิดอยู่ จึงเช็กก่อนแล้วคืนค่าเดิม
    if (days !== null && (!Number.isInteger(days) || days < 0)) {
      this.messageService.add({ severity: 'warn', summary: 'Invalid value', detail: 'Days must be a whole number, 0 or more' });
      input.value = todo.daysAllotted === null ? '' : String(todo.daysAllotted);
      return;
    }
    this.applyTodoUpdate(todo, { days_allotted: days });
  }

  deleteTask(id: string): void {
    if (this.isTodoPending(id)) return;

    this.setTodoPending(id, true);
    this.todoService.delete(id).subscribe({
      next: () => this.loadTodos(() => this.setTodoPending(id, false)),
      error: err => {
        this.setTodoPending(id, false);
        this.notifyError('Delete Failed', this.errorMessage(err, 'Unable to delete task'));
      }
    });
  }

  onNewFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    // เคลียร์ค่าเสมอ ไม่งั้นเลือกไฟล์เดิมซ้ำหลังกดลบ chip แล้ว change event จะไม่ยิง
    input.value = '';
    if (!picked.length) return;

    const result = mergeAttachmentFiles(this.newFiles(), picked);
    if ('error' in result) {
      this.messageService.add({ severity: 'warn', summary: 'Invalid file', detail: result.error });
      return;
    }
    this.newFiles.set(result.files);
  }

  removeNewFile(index: number): void {
    const removed = this.newFiles()[index];
    if (removed) this.filePreviews.release(removed);
    this.newFiles.update(files => files.filter((_, i) => i !== index));
  }

  ngOnDestroy(): void {
    this.filePreviews.releaseAll();
  }

  // input: ช่อง title/description ของฟอร์ม Add (ล้างค่าหลัง task ถูกสร้างแล้ว ไม่ว่าไฟล์แนบจะอัปโหลดสำเร็จหรือไม่ — กันผู้ใช้กด Add ซ้ำจนได้ task ซ้ำ)
  private finishAdd(titleInput: HTMLInputElement, descriptionInput: HTMLTextAreaElement): void {
    this.loadTodos();
    titleInput.value = '';
    descriptionInput.value = '';
    this.newCustomerId = null;
    this.newStartDate = null;
    this.newDaysAllotted = null;
    this.newAssigneeIds = [];
    this.newFiles.set([]);
    this.filePreviews.releaseAll();
    this.isSubmitting.set(false);
  }

  addTask(titleInput: HTMLInputElement, descriptionInput: HTMLTextAreaElement): void {
    const title = titleInput.value.trim();
    if (!title || this.isSubmitting()) return;

    if (!this.newAssigneeIds.length) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Select at least one assignee' });
      return;
    }
    const description = descriptionInput.value.trim();
    const files = this.newFiles();

    this.isSubmitting.set(true);
    this.todoService.create({
      title,
      description: description || undefined,
      // ล็อก customerId (โหมด customer detail) ใช้ค่านั้นเสมอ ไม่พึ่ง newCustomerId ที่ถูกซ่อนอยู่ในฟอร์ม
      customer_id: this.customerId ?? this.newCustomerId ?? undefined,
      start_date: this.toDateString(this.newStartDate),
      days_allotted: this.newDaysAllotted ?? undefined,
      assignee_ids: this.newAssigneeIds
    }).subscribe({
      next: created => {
        if (!files.length) {
          this.finishAdd(titleInput, descriptionInput);
          return;
        }
        this.todoService.addAttachments(created.id, files).subscribe({
          next: () => this.finishAdd(titleInput, descriptionInput),
          error: err => {
            this.finishAdd(titleInput, descriptionInput);
            this.notifyError('Attachment Failed', `Task was added, but the files were not uploaded: ${this.errorMessage(err, 'Unable to upload files')}`);
          }
        });
      },
      error: err => {
        this.notifyError('Add Failed', this.errorMessage(err, 'Unable to add task'));
        this.isSubmitting.set(false);
      }
    });
  }
}
