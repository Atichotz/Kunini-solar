import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { CustomerService } from '../services/customer.service';
import type { CustomerListItem, StatusOption } from '../dto/customer.dto';

type LocationFilter = 'Pattaya' | 'Huahin' | 'Bangkok' | 'Up Country';
type CustomerTypeFilter = 'Residential' | 'Commercial' | 'Upgrade';
type SystemTypeFilter = 'On-Grid' | 'Off-Grid' | 'Hybrid';

@Component({
  selector: 'app-customer-list-drawer',
  standalone: true,
  imports: [DialogModule, ToastModule],
  templateUrl: './customer-list-drawer.component.html',
  styleUrl: './customer-list-drawer.component.scss',
  providers: [MessageService],
})
export class CustomerListDrawerComponent {
  private readonly customerService = inject(CustomerService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private loadSubscription: Subscription | null = null;

  readonly visible = signal(false);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly customers = signal<CustomerListItem[]>([]);
  readonly searchTerm = signal('');

  readonly filterPanelOpen = signal(false);
  readonly statusOptions = signal<StatusOption[]>([]);
  readonly selectedLocations = signal<LocationFilter[]>([]);
  readonly selectedCustomerTypes = signal<CustomerTypeFilter[]>([]);
  readonly selectedSystemTypes = signal<SystemTypeFilter[]>([]);
  readonly selectedStatusIds = signal<number[]>([]);

  readonly locationOptions: LocationFilter[] = ['Pattaya', 'Huahin', 'Bangkok', 'Up Country'];
  readonly customerTypeOptions: CustomerTypeFilter[] = ['Residential', 'Commercial', 'Upgrade'];
  readonly systemTypeOptions: SystemTypeFilter[] = ['On-Grid', 'Off-Grid', 'Hybrid'];

  // location -> BEM modifier class ที่ตรงกับ location color token (ดู design-system.md ข้อ 6)
  private readonly locationClassMap: Record<LocationFilter, string> = {
    Pattaya: 'Pattaya',
    Huahin: 'HuaHin',
    Bangkok: 'Bangkok',
    'Up Country': 'Up-Country',
  };

  // จำนวน pill ที่เลือกอยู่รวมทุก group (ไม่นับ search) — โชว์เป็น badge บนปุ่ม Filter
  readonly activeFilterCount = computed(() => {
    return (
      this.selectedLocations().length +
      this.selectedCustomerTypes().length +
      this.selectedSystemTypes().length +
      this.selectedStatusIds().length
    );
  });

  // input: คำค้นหา (ชื่อ/customer#/address/ชื่อผู้ติดต่อ) + filter ที่เลือก (location/type/system/status) — output: รายชื่อที่ match ทุก group (AND ข้าม group, OR ภายใน group เดียวกัน)
  readonly filteredCustomers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const locations = this.selectedLocations();
    const customerTypes = this.selectedCustomerTypes();
    const systemTypes = this.selectedSystemTypes();
    const statusIds = this.selectedStatusIds();

    return this.customers().filter((c) => {
      if (locations.length > 0 && !locations.includes(c.projectLocationName as LocationFilter)) return false;
      if (customerTypes.length > 0 && !customerTypes.includes(c.typeOfCustomerName as CustomerTypeFilter)) return false;
      if (systemTypes.length > 0 && !systemTypes.includes(c.typeOfSystemName as SystemTypeFilter)) return false;
      if (statusIds.length > 0 && (c.statusId === null || !statusIds.includes(c.statusId))) return false;

      if (!term) return true;
      const contactName = this.contactFullName(c.contact).toLowerCase();
      return (
        c.displayName.toLowerCase().includes(term) ||
        (c.customerNumber ?? '').toLowerCase().includes(term) ||
        (c.fullAddress ?? '').toLowerCase().includes(term) ||
        contactName.includes(term)
      );
    });
  });

  // input: ค่า location ("Pattaya"/"Huahin"/"Bangkok"/"Up Country") — output: modifier class สำหรับใส่สี pill ตาม branch
  locationClass(value: LocationFilter): string {
    return this.locationClassMap[value];
  }

  // เปิด drawer + โหลดข้อมูลใหม่ทุกครั้ง กันข้อมูลเก่าค้าง (เช่น มีลูกค้าใหม่ถูกเพิ่มระหว่างที่ปิดอยู่)
  open(): void {
    this.visible.set(true);
    this.load();
    this.loadStatuses();
  }

  onVisibleChange(value: boolean): void {
    this.visible.set(value);
    if (!value) {
      // ปิดก่อนโหลดเสร็จ → cancel request ค้าง กัน state update หลัง component ถูกซ่อน
      this.loadSubscription?.unsubscribe();
      this.searchTerm.set('');
      this.filterPanelOpen.set(false);
      this.clearFilters();
    }
  }

  retry(): void {
    this.load();
  }

  toggleFilterPanel(): void {
    this.filterPanelOpen.update((v) => !v);
  }

  // คลิกซ้ำ pill เดิม = เอาออกจาก selection, คลิก pill ใหม่ = เพิ่มเข้าไป — เลือกได้หลายอันพร้อมกันในกลุ่มเดียวกัน
  setLocation(value: LocationFilter): void {
    this.selectedLocations.update((current) => this.toggleInArray(current, value));
  }

  setCustomerType(value: CustomerTypeFilter): void {
    this.selectedCustomerTypes.update((current) => this.toggleInArray(current, value));
  }

  setSystemType(value: SystemTypeFilter): void {
    this.selectedSystemTypes.update((current) => this.toggleInArray(current, value));
  }

  setStatus(value: number): void {
    this.selectedStatusIds.update((current) => this.toggleInArray(current, value));
  }

  clearFilters(): void {
    this.selectedLocations.set([]);
    this.selectedCustomerTypes.set([]);
    this.selectedSystemTypes.set([]);
    this.selectedStatusIds.set([]);
  }

  private toggleInArray<T>(current: T[], value: T): T[] {
    return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  }

  // input: id ของ customer ที่กด — ปิด drawer แล้วพาไปหน้า customer detail
  goToDetail(customerId: string): void {
    this.onVisibleChange(false);
    this.router.navigate(['/detail', customerId]);
  }

  // input: ข้อความที่จะ copy (address/tel/email) — คัดลอกลง clipboard แล้วโชว์ toast ยืนยัน
  async copyToClipboard(value: string): Promise<void> {
    if (!value) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        this.legacyCopy(value);
      }
      this.messageService.add({ severity: 'success', summary: 'คัดลอกแล้ว', detail: value, life: 1500 });
    } catch (err: unknown) {
      console.error('[CustomerListDrawer] Copy failed:', err);
      this.messageService.add({ severity: 'error', summary: 'คัดลอกไม่สำเร็จ', life: 2500 });
    }
  }

  // fallback สำหรับ browser เก่า/insecure context ที่ navigator.clipboard ใช้ไม่ได้
  private legacyCopy(value: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  // input: contact ของลูกค้า (อาจเป็น null) — output: "ชื่อ นามสกุล" หรือ "—" ถ้าไม่มีข้อมูล
  contactFullName(contact: CustomerListItem['contact']): string {
    if (!contact) return '—';
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(' ').trim();
    return name || '—';
  }

  // โหลดครั้งแรกที่เปิด drawer เท่านั้น (status list เปลี่ยนไม่บ่อย ไม่ต้อง refetch ทุกครั้ง)
  private loadStatuses(): void {
    if (this.statusOptions().length > 0) return;

    this.customerService.getStatuses().subscribe({
      next: (statuses) => this.statusOptions.set(statuses),
      error: (err: unknown) => console.error('[CustomerListDrawer] Failed to load statuses:', err),
    });
  }

  private load(): void {
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(false);

    this.loadSubscription = this.customerService.listView().subscribe({
      next: (customers) => {
        this.customers.set(customers);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        console.error('[CustomerListDrawer] Failed to load customers:', err);
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }
}
