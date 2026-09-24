import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { TodoService } from '../../services/todo.service';
import { Customer, WORKFLOW_STATUS, WorkflowService } from '../../services/workflow.service';
import type { TodoAssignee } from '../../dto/todo.dto';
import { TodoBoardComponent } from '../../todo-board/todo-board.component';

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
  imports: [DecimalPipe, DatePipe, RouterLink, TodoBoardComponent],
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

  // ตัวเองใน allowed_users — role ตรงนี้ (ไม่ใช่ PermissionService) ใช้ตัดสินว่า Revenue KPI card แสดงไหม
  // (TodoBoardComponent โหลด me ของตัวเองแยกต่างหากสำหรับการ์ด To-Do — ยอมยิง API getMe() ซ้ำ 2 ครั้งแทนที่จะผูกกลับด้วย event)
  me = signal<TodoAssignee | null>(null);

  readonly isManager = computed<boolean>(() => {
    const role = this.me()?.role;
    return role === 'ceo' || role === 'admin';
  });

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

  // ใช้เฉพาะรู้ role ตัวเองสำหรับ Revenue KPI card — ไม่โหลด todos/assignees ต่อ (การ์ด To-Do ย้ายไป TodoBoardComponent แล้ว)
  private loadMe(): void {
    this.todoService.getMe().subscribe({
      next: me => this.me.set(me),
      error: err => console.error('[API] Failed to load To-Do profile:', err)
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
