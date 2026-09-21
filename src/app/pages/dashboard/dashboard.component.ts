import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { TodoService } from '../../services/todo.service';
import { Customer, WORKFLOW_STATUS, WorkflowService } from '../../services/workflow.service';
import type { TodoCard, TodoAssignee, TodoRole } from '../../dto/todo.dto';

// การ์ด To-Do ที่ collapse ได้: manager เห็น 'all' ใบเดียว, role อื่นเห็น 'mine' + 'team'
type TodoCardKey = 'all' | 'mine' | 'team';

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

interface SystemTypeSlice {
  label: string;
  count: number;
  percent: number;
  color: string;
}

// ชื่อต้องตรงกับ customers.type_of_system_name ใน DB (เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่) — ชนิดอื่น/ไม่ระบุรวมเป็น Other
const SYSTEM_TYPE_DEFS = [
  { label: 'Hybrid', color: 'var(--k-accent-blue)' },
  { label: 'On-Grid', color: 'var(--k-accent-green)' },
  { label: 'Off-Grid', color: 'var(--k-red)' }
] as const;
const SYSTEM_TYPE_OTHER_COLOR = 'var(--k-mid-grey)';
const SYSTEM_TYPE_EMPTY_COLOR = 'var(--k-light-grey)';

interface QuoteRecord {
  id: string;
  clientName: string;
  address: string;
  systemSize: number;
  systemType: 'hybrid' | 'grid-tied';
  totalCost: number;
  monthlySavings: number;
  status: 'pending' | 'approved' | 'installed';
  date: Date;
  solarPanel: string;
  inverter: string;
  battery: string | null;
}

interface KpiCard {
  label: string;
  value: string;
  sub: string;
  icon: string;
  trend: 'up' | 'down' | 'neutral';
  trendText: string;
}

interface SizeBar {
  kw: number;
  count: number;
  pct: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe, DatePipe, RouterLink, FormsModule, SelectModule, MultiSelectModule, DatePickerModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private readonly todoService = inject(TodoService);
  private readonly workflowService = inject(WorkflowService);

  // KPI cards (Need Analysis / Waiting Install) นับจาก statusId ของ customer เดียวกับที่หน้า workflow ใช้
  customers = signal<Customer[]>([]);
  kpiLoading = signal(true);
  kpiError = signal<string | null>(null);

  readonly needAnalysisCount = computed<number>(() =>
    this.customers().filter(customer => customer.statusId === WORKFLOW_STATUS.NEED_ANALYSIS).length
  );
  readonly waitingInstallCount = computed<number>(() =>
    this.customers().filter(customer => customer.statusId === WORKFLOW_STATUS.TO_BE_INSTALLED).length
  );

  // นับเฉพาะที่ Installed และ installedAt อยู่ในปีปัจจุบัน (เวลาไทย) — installedAt เป็น null (ข้อมูลเก่า) จะไม่ถูกนับ
  readonly installedThisYearCount = computed<number>(() => {
    const currentYear = this.yearInBangkok(new Date());
    return this.customers().filter(customer =>
      customer.statusId === WORKFLOW_STATUS.INSTALLED &&
      customer.installedAt !== null &&
      this.yearInBangkok(new Date(customer.installedAt)) === currentYear
    ).length;
  });

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
  newDueDate: Date | null = null;
  newAssigneeIds: string[] = [];

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
  // ช่องค้นหาแสดงทุกการ์ด ส่วน showFilters คุมเฉพาะ filter ทีม/คน (ceo/admin เท่านั้น)
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
    this.loadKpi();
  }

  // ผลรวม estimate final ทุกใบ (รวมรอบติดตั้งที่ 2+) ของลูกค้าที่ไม่ใช่ Rejected — price เป็น null เมื่อ role ไม่ใช่ ceo/admin
  readonly totalEstRevenue = computed<number>(() =>
    this.customers()
      .filter(customer => customer.statusId !== WORKFLOW_STATUS.REJECTED)
      .reduce((sum, customer) => sum + (customer.price ?? 0), 0)
  );

  // output: ยอดแบบย่อ เช่น "฿ 651K", "฿ 1.2M", "฿ 0"
  readonly totalEstRevenueLabel = computed<string>(() =>
    '฿ ' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(this.totalEstRevenue())
  );

  // donut นับลูกค้าทุกช่วงเวลา ยกเว้นที่ Rejected (สอดคล้องกับ card Revenue)
  private readonly systemTypeCustomers = computed<Customer[]>(() =>
    this.customers().filter(customer => customer.statusId !== WORKFLOW_STATUS.REJECTED)
  );

  readonly systemTypeTotal = computed<number>(() => this.systemTypeCustomers().length);

  // output: slice ของ Hybrid/On-Grid/Off-Grid เสมอ (แม้ count = 0 เพื่อให้ legend คงที่) + Other เฉพาะเมื่อมี
  readonly systemTypeSlices = computed<SystemTypeSlice[]>(() => {
    const customers = this.systemTypeCustomers();
    const total = customers.length;
    const toPercent = (count: number): number => (total > 0 ? (count / total) * 100 : 0);

    const known: SystemTypeSlice[] = SYSTEM_TYPE_DEFS.map(def => {
      const count = customers.filter(
        customer => customer.tagsSystem[0]?.trim().toLowerCase() === def.label.toLowerCase()
      ).length;
      return { label: def.label, count, percent: toPercent(count), color: def.color };
    });

    const otherCount = total - known.reduce((sum, slice) => sum + slice.count, 0);
    return otherCount > 0
      ? [...known, { label: 'Other', count: otherCount, percent: toPercent(otherCount), color: SYSTEM_TYPE_OTHER_COLOR }]
      : known;
  });

  // output: ค่า CSS conic-gradient สะสมตามสัดส่วนจริง — ไม่มีข้อมูลหรือกำลังโหลด/error แสดงวงแหวนเทา
  readonly systemTypeGradient = computed<string>(() => {
    if (this.kpiLoading() || this.kpiError() || this.systemTypeTotal() === 0) {
      return `conic-gradient(${SYSTEM_TYPE_EMPTY_COLOR} 0% 100%)`;
    }
    let start = 0;
    const stops = this.systemTypeSlices()
      .filter(slice => slice.count > 0)
      .map(slice => {
        const end = start + slice.percent;
        const stop = `${slice.color} ${start}% ${end}%`;
        start = end;
        return stop;
      });
    return `conic-gradient(${stops.join(', ')})`;
  });

  // input: Date — output: ปี ค.ศ. ตามเวลา Asia/Bangkok (กันเพี้ยนช่วงข้ามปีที่ browser อยู่คนละ timezone)
  private yearInBangkok(date: Date): number {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(date));
  }

  // โหลดครั้งเดียวตอนเข้าหน้า (ไม่ realtime) — error แล้วแสดง '–' แทน 0 กันเลขหลอก
  private loadKpi(): void {
    this.workflowService.getCustomers().subscribe({
      next: list => {
        this.customers.set(list);
        this.kpiLoading.set(false);
      },
      error: err => {
        this.kpiError.set(this.errorMessage(err, 'Unable to load summary'));
        this.kpiLoading.set(false);
      }
    });
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
        this.todos.set(list);
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
  private toDueDateString(date: Date | null): string | undefined {
    if (!date) return undefined;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // input: due_date ("2026-07-10") — output: ข้อความสัมพัทธ์ ("Due Today"/"Due Tomorrow"/"Due Jul 10")
  private formatDueDate(dueDate: string): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

    if (diffDays === 0) return 'Due Today';
    if (diffDays === 1) return 'Due Tomorrow';
    if (diffDays < 0) return `Overdue since ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    return `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  // input: todo card — output: meta line ("Due Tomorrow • Assigned to Mark, Ann" / "Completed Jul 9")
  todoMeta(todo: TodoCard): string {
    if (todo.isDone) {
      const completed = new Date(todo.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `Completed ${completed}`;
    }

    const parts: string[] = [];
    if (todo.dueDate) parts.push(this.formatDueDate(todo.dueDate));
    if (todo.assignees.length) parts.push(`Assigned to ${todo.assignees.map(assignee => assignee.name).join(', ')}`);
    return parts.join(' • ');
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
      const haystack = [todo.title, todo.description ?? '', ...todo.assignees.map(assignee => assignee.name)];
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
      due_date: this.toDueDateString(this.newDueDate),
      assignee_ids: this.newAssigneeIds
    }).subscribe({
      next: () => {
        this.loadTodos();
        titleInput.value = '';
        descriptionInput.value = '';
        this.newDueDate = null;
        this.newAssigneeIds = [];
        this.isSubmitting.set(false);
      },
      error: err => {
        this.todoError.set(this.errorMessage(err, 'Unable to add task'));
        this.isSubmitting.set(false);
      }
    });
  }

  readonly recentQuotes: QuoteRecord[] = [
    {
      id: 'Q-2025-041',
      clientName: 'Maria Santos',
      address: 'Brgy. Poblacion, Quezon City',
      systemSize: 5,
      systemType: 'hybrid',
      totalCost: 277365,
      monthlySavings: 6632,
      status: 'installed',
      date: new Date('2025-04-20'),
      solarPanel: 'Seraphim 550W',
      inverter: 'Deye 5kW',
      battery: 'Pylontech US2000C'
    },
    {
      id: 'Q-2025-040',
      clientName: 'Roberto Lim',
      address: 'Brgy. San Antonio, Makati',
      systemSize: 10,
      systemType: 'grid-tied',
      totalCost: 445000,
      monthlySavings: 13288,
      status: 'approved',
      date: new Date('2025-04-18'),
      solarPanel: 'Jinko 545W Tiger Neo',
      inverter: 'Deye 10kW',
      battery: null
    },
    {
      id: 'Q-2025-039',
      clientName: 'Ana Reyes',
      address: 'Brgy. Malabanias, Angeles, Pampanga',
      systemSize: 8,
      systemType: 'hybrid',
      totalCost: 427000,
      monthlySavings: 10623,
      status: 'approved',
      date: new Date('2025-04-15'),
      solarPanel: 'Canadian Solar 550W HiKu6',
      inverter: 'Deye 8kW',
      battery: 'LVFU LFRX51200-01'
    },
    {
      id: 'Q-2025-038',
      clientName: 'Jose Dela Cruz',
      address: 'Brgy. Sto. Niño, Pasig City',
      systemSize: 3,
      systemType: 'grid-tied',
      totalCost: 135000,
      monthlySavings: 3979,
      status: 'pending',
      date: new Date('2025-04-14'),
      solarPanel: 'Seraphim 550W',
      inverter: 'Solis 5kW',
      battery: null
    },
    {
      id: 'Q-2025-037',
      clientName: 'Carla Mendoza',
      address: 'Brgy. San Isidro, Cainta, Rizal',
      systemSize: 6,
      systemType: 'hybrid',
      totalCost: 347000,
      monthlySavings: 7963,
      status: 'installed',
      date: new Date('2025-04-10'),
      solarPanel: 'Longi 560W Hi-MO5',
      inverter: 'LuxPower 5kW',
      battery: 'LVFU LFRX51200-01'
    },
    {
      id: 'Q-2025-036',
      clientName: 'Eduardo Torres',
      address: 'Brgy. Poblacion, Dasmariñas, Cavite',
      systemSize: 12,
      systemType: 'hybrid',
      totalCost: 630000,
      monthlySavings: 15935,
      status: 'pending',
      date: new Date('2025-04-08'),
      solarPanel: 'Canadian Solar 550W HiKu6',
      inverter: 'Deye 10kW',
      battery: 'LvTopSun 51.2V 300Ah'
    }
  ];

  readonly kpiCards: KpiCard[] = [
    {
      label: 'Total Quotes (April)',
      value: '12',
      sub: 'quotes this month',
      icon: '📋',
      trend: 'up',
      trendText: '+4 vs March'
    },
    {
      label: 'Total Est. Revenue',
      value: '₱3.26M',
      sub: 'from 12 quotes',
      icon: '💰',
      trend: 'up',
      trendText: '+₱820K vs March'
    },
    {
      label: 'Avg System Size',
      value: '6.8 kW',
      sub: 'per installation',
      icon: '⚡',
      trend: 'up',
      trendText: '+1.2 kW vs March'
    },
    {
      label: 'CO₂ Offset / Yr',
      value: '18,450 kg',
      sub: 'total impact potential',
      icon: '🌱',
      trend: 'up',
      trendText: 'Equivalent to 738 trees'
    }
  ];

  readonly monthlyData = [
    { month: 'Nov', quotes: 5, revenue: 1.1 },
    { month: 'Dec', quotes: 7, revenue: 1.6 },
    { month: 'Jan', quotes: 6, revenue: 1.4 },
    { month: 'Feb', quotes: 9, revenue: 2.1 },
    { month: 'Mar', quotes: 8, revenue: 2.4 },
    { month: 'Apr', quotes: 13, revenue: 5 }
  ];

  readonly maxQuotes = Math.max(...this.monthlyData.map(m => m.quotes));

  readonly sizeBars: SizeBar[] = [
    { kw: 5, count: 4, pct: 100 },
    { kw: 8, count: 3, pct: 75 },
    { kw: 10, count: 2, pct: 50 },
    { kw: 6, count: 2, pct: 50 },
    { kw: 12, count: 1, pct: 25 }
  ];

  readonly hybridCount = this.recentQuotes.filter(q => q.systemType === 'hybrid').length;
  readonly gridTiedCount = this.recentQuotes.filter(q => q.systemType === 'grid-tied').length;
  readonly hybridPct = Math.round((this.hybridCount / this.recentQuotes.length) * 100);

  readonly installedCount = this.recentQuotes.filter(q => q.status === 'installed').length;
  readonly approvedCount = this.recentQuotes.filter(q => q.status === 'approved').length;
  readonly pendingCount = this.recentQuotes.filter(q => q.status === 'pending').length;

  barHeight(count: number): number {
    return Math.round((count / this.maxQuotes) * 100);
  }

  statusClass(status: QuoteRecord['status']): string {
    return {
      installed: 'badge-installed',
      approved: 'badge-approved',
      pending: 'badge-pending'
    }[status];
  }

  statusLabel(status: QuoteRecord['status']): string {
    return { installed: '✅ Installed', approved: '🟡 Approved', pending: '⏳ Pending' }[status];
  }
}
