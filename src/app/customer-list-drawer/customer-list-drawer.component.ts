import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DrawerModule } from 'primeng/drawer';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { CustomerService } from '../services/customer.service';
import type { CustomerListItem } from '../dto/customer.dto';

@Component({
  selector: 'app-customer-list-drawer',
  standalone: true,
  imports: [DrawerModule, ToastModule],
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

  // input: คำค้นหา (ชื่อ/customer#/address/ชื่อผู้ติดต่อ) — output: รายชื่อที่ match แบบ case-insensitive
  readonly filteredCustomers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.customers();

    return this.customers().filter((c) => {
      const contactName = this.contactFullName(c.contact).toLowerCase();
      return (
        c.displayName.toLowerCase().includes(term) ||
        (c.customerNumber ?? '').toLowerCase().includes(term) ||
        (c.fullAddress ?? '').toLowerCase().includes(term) ||
        contactName.includes(term)
      );
    });
  });

  // เปิด drawer + โหลดข้อมูลใหม่ทุกครั้ง กันข้อมูลเก่าค้าง (เช่น มีลูกค้าใหม่ถูกเพิ่มระหว่างที่ปิดอยู่)
  open(): void {
    this.visible.set(true);
    this.load();
  }

  onVisibleChange(value: boolean): void {
    this.visible.set(value);
    if (!value) {
      // ปิดก่อนโหลดเสร็จ → cancel request ค้าง กัน state update หลัง component ถูกซ่อน
      this.loadSubscription?.unsubscribe();
      this.searchTerm.set('');
    }
  }

  retry(): void {
    this.load();
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
