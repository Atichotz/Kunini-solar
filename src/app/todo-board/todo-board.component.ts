import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TodoService } from '../services/todo.service';
import type { Customer } from '../services/workflow.service';
import type { TodoCard, TodoAssignee, TodoRole, TodoStatus, UpdateTodoPayload } from '../dto/todo.dto';

// การ์ด To-Do ที่ collapse ได้: manager เห็น 'all' ใบเดียว, role อื่นเห็น 'mine' + 'team'
type TodoCardKey = 'all' | 'mine' | 'team';

// field ที่แก้ไขแบบ inline ได้ทีละอัน (Status/startDate/daysAllotted/closeDate ไม่รวม เพราะคลิกแล้วเปลี่ยน/save ได้ทันทีอยู่แล้วเหมือน badge dropdown)
type EditableField = 'customer' | 'assignees';

interface AssigneeOption extends TodoAssignee {
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
  showForm: boolean;
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
@Component({
  selector: 'app-todo-board',
  imports: [RouterLink, FormsModule, SelectModule, MultiSelectModule, DatePickerModule, ProgressSpinnerModule],
  templateUrl: './todo-board.component.html',
  styleUrl: './todo-board.component.scss'
})
export class TodoBoardComponent implements OnInit {
  private readonly todoService = inject(TodoService);

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
  todoError = signal<string | null>(null);
  isSubmitting = signal(false);
  // true จนกว่าโหลด me + รายการงานครั้งแรกเสร็จ (หรือพัง) — กันการ์ดว่างที่ดูเหมือน "ไม่มีงาน"
  todosLoading = signal(true);
  // id งานที่กำลัง toggle/ลบอยู่ — กันกดซ้ำระหว่างรอ request + refetch
  private readonly pendingTodoIds = signal<ReadonlySet<string>>(new Set());
  // field ที่กำลังแก้ไขอยู่ (แยกอิสระต่อ field ไม่ใช่ทั้งแถว) — แก้ได้ทีละ field ทั้งระบบ, null = ไม่มี field ไหนกำลังแก้
  private readonly activeEdit = signal<{ todoId: string; field: EditableField } | null>(null);
  // ค่า draft ระหว่างแก้ไข — ไม่ยิง API จนกว่าจะกด Save (saveEditField)
  editCustomerId: string | null = null;
  editAssigneeIds: string[] = [];
  collapsed = signal<Record<TodoCardKey, boolean>>({ all: false, mine: false, team: false });

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

  // manager: การ์ดเดียวพร้อม filter | role อื่น: My To-Do (อ่าน/ติ๊กอย่างเดียว) + Team To-Do (มีฟอร์มเพิ่มงาน)
  // งานที่ assign ให้ตัวเองจะอยู่ทั้งสองการ์ด เพราะ Team คือทุกงานของทีมรวมงานของเราด้วย
  readonly cards = computed<TodoCardView[]>(() =>
    this.isManager()
      ? [this.toCardView('all', 'To-Do', this.filteredTodos(), true, true)]
      : [
        this.toCardView('mine', 'My To-Do', this.myTodos(), false, false),
        this.toCardView('team', 'Team To-Do', this.todos(), false, true)
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
        this.todoError.set(this.errorMessage(err, 'Unable to load your To-Do profile'));
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
        this.todoError.set(null);
        this.todosLoading.set(false);
        onSettled?.();
      },
      error: err => {
        this.todoError.set(this.errorMessage(err, 'Unable to load tasks'));
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
      case 'customer':
        patch.customer_id = this.editCustomerId;
        break;
      case 'assignees':
        if (!this.editAssigneeIds.length) {
          this.todoError.set('Select at least one assignee');
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
        this.todoError.set(this.errorMessage(err, 'Unable to update task'));
      }
    });
  }

  private loadAssignees(): void {
    this.todoService.getAssignees().subscribe({
      next: list => this.assignees.set(list),
      error: err => this.todoError.set(this.errorMessage(err, 'Unable to load assignees'))
    });
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

  // input: การ์ด, งานที่ผ่าน filter ทีม/คนแล้ว, flag แสดง filter/ฟอร์ม — output: view ของการ์ดพร้อมค้นหาและแบ่งหน้า
  // หน้าปัจจุบันถูก clamp เพราะลบงาน/ค้นหาแล้วจำนวนหน้าอาจลดลง ไม่งั้นจะเจอหน้าว่าง
  private toCardView(key: TodoCardKey, title: string, source: TodoCard[], showFilters: boolean, showForm: boolean): TodoCardView {
    const todos = this.searchTodos(key, source);
    const size = this.pageSize()[key];
    const totalPages = Math.max(1, Math.ceil(todos.length / size));
    const currentPage = Math.min(this.page()[key], totalPages);
    const start = (currentPage - 1) * size;
    return { key, title, todos, visibleTodos: todos.slice(start, start + size), currentPage, totalPages, showFilters, showForm };
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
        this.todoError.set(this.errorMessage(err, 'Unable to update task'));
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
        this.todoError.set(this.errorMessage(err, 'Unable to update task'));
      }
    });
  }

  // Status เท่านั้นที่ยัง save ทันทีตอนเปลี่ยน — เป็น badge dropdown คลิกได้เลยไม่ต้องกด Edit ก่อน (ต่างจาก 4 field ที่ผ่าน draft + Save)
  setTodoStatus(todo: TodoCard, status: TodoStatus): void {
    this.applyTodoUpdate(todo, { status });
  }

  // เลือกวันที่จาก p-datepicker แล้ว save ทันที (เหมือน Status) — คลิกช่องเปล่าแล้วเลือกได้เลยไม่ต้องกด Edit ก่อน
  setTodoStartDate(todo: TodoCard, date: Date): void {
    this.applyTodoUpdate(todo, { start_date: this.toDateString(date) ?? null });
  }

  setTodoCloseDate(todo: TodoCard, date: Date): void {
    this.applyTodoUpdate(todo, { close_date: this.toDateString(date) ?? null });
  }

  // input: event ของ input[type=number] — พิมพ์เสร็จแล้ว blur/Enter ถึง save (change event) ไม่ save ทุก keystroke, ลบค่าจนว่างเปล่า = null
  setTodoDaysAllotted(todo: TodoCard, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.applyTodoUpdate(todo, { days_allotted: value === '' ? null : Number(value) });
  }

  deleteTask(id: string): void {
    if (this.isTodoPending(id)) return;

    this.setTodoPending(id, true);
    this.todoService.delete(id).subscribe({
      next: () => this.loadTodos(() => this.setTodoPending(id, false)),
      error: err => {
        this.setTodoPending(id, false);
        this.todoError.set(this.errorMessage(err, 'Unable to delete task'));
      }
    });
  }

  addTask(titleInput: HTMLInputElement, descriptionInput: HTMLTextAreaElement): void {
    const title = titleInput.value.trim();
    if (!title || this.isSubmitting()) return;

    if (!this.newAssigneeIds.length) {
      this.todoError.set('Select at least one assignee');
      return;
    }
    const description = descriptionInput.value.trim();

    this.isSubmitting.set(true);
    this.todoError.set(null);
    this.todoService.create({
      title,
      description: description || undefined,
      // ล็อก customerId (โหมด customer detail) ใช้ค่านั้นเสมอ ไม่พึ่ง newCustomerId ที่ถูกซ่อนอยู่ในฟอร์ม
      customer_id: this.customerId ?? this.newCustomerId ?? undefined,
      start_date: this.toDateString(this.newStartDate),
      days_allotted: this.newDaysAllotted ?? undefined,
      assignee_ids: this.newAssigneeIds
    }).subscribe({
      next: () => {
        this.loadTodos();
        titleInput.value = '';
        descriptionInput.value = '';
        this.newCustomerId = null;
        this.newStartDate = null;
        this.newDaysAllotted = null;
        this.newAssigneeIds = [];
        this.isSubmitting.set(false);
      },
      error: err => {
        this.todoError.set(this.errorMessage(err, 'Unable to add task'));
        this.isSubmitting.set(false);
      }
    });
  }
}
