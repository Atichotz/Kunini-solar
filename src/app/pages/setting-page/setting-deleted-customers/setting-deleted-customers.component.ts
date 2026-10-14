import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { catchError, forkJoin, of } from 'rxjs';
import { CustomerService } from '../../../services/customer.service';
import type { DeletedCustomer, StatusOption } from '../../../dto/customer.dto';

// section ใน Settings สำหรับ CEO เท่านั้น (sidebar ซ่อนด้วย isCeo + backend @Roles('ceo')) — ดูและกู้คืนลูกค้าที่ถูก soft delete
@Component({
  selector: 'app-setting-deleted-customers',
  imports: [DatePipe, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './setting-deleted-customers.component.html',
  styleUrl: './setting-deleted-customers.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingDeletedCustomersComponent implements OnInit {
  private readonly customerService = inject(CustomerService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly customers = signal<DeletedCustomer[]>([]);
  readonly isLoading = signal(true);
  readonly loadErrorMessage = signal('');
  readonly actionErrorMessage = signal('');
  // id ของลูกค้าที่กำลังกู้คืน — กันกดซ้ำ และให้ปุ่มของแถวอื่นยังกดได้
  readonly restoringId = signal<string | null>(null);

  private statusNameById = new Map<number, string>();

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.loadErrorMessage.set('');

    forkJoin({
      customers: this.customerService.listDeleted(),
      // ชื่อ status เป็นแค่ข้อมูลเสริม — โหลดไม่ได้ก็ยังแสดงรายการได้
      statuses: this.customerService.getStatuses().pipe(catchError(() => of<StatusOption[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ customers, statuses }) => {
          this.statusNameById = new Map(statuses.map((status) => [status.id, status.status_name]));
          this.customers.set(customers);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          console.error('[API] Failed to load deleted customers:', err);
          this.loadErrorMessage.set('Failed to load deleted customers. Please try again');
          this.isLoading.set(false);
        },
      });
  }

  // input: statusId ของลูกค้า — output: ชื่อ status หรือ '—' ถ้าไม่มี/ไม่รู้จัก
  statusName(statusId: number | null): string {
    return (statusId !== null && this.statusNameById.get(statusId)) || '—';
  }

  // input: ลูกค้าจากแถวในตาราง — ถามยืนยันก่อนกู้คืน
  onRestore(customer: DeletedCustomer): void {
    if (this.restoringId()) return;
    this.confirmationService.confirm({
      header: 'Restore customer',
      message: `Restore "${customer.displayName}"? They will appear again in Workflow and Customer List.`,
      icon: 'pi pi-question-circle',
      acceptLabel: 'Restore',
      rejectLabel: 'Cancel',
      accept: () => this.restore(customer),
    });
  }

  private restore(customer: DeletedCustomer): void {
    this.actionErrorMessage.set('');
    this.restoringId.set(customer.id);

    this.customerService.restore(customer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.restoringId.set(null);
          this.customers.update((rows) => rows.filter((row) => row.id !== customer.id));
        },
        error: (err: unknown) => {
          this.restoringId.set(null);
          const status = err instanceof HttpErrorResponse ? err.status : null;
          // 404 = ถูกกู้ไปแล้วจาก tab/คนอื่น — เอาออกจากลิสต์ให้ตรงกับความจริง
          if (status === 404) {
            this.customers.update((rows) => rows.filter((row) => row.id !== customer.id));
            return;
          }
          console.error('[API] Failed to restore customer:', err);
          this.actionErrorMessage.set(
            status === 409
              ? `Customer # "${customer.customerNumber}" is already used by another customer. Change that customer's number first, then restore`
              : 'Failed to restore the customer. Please try again',
          );
        },
      });
  }
}
