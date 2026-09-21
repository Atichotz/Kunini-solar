import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface Customer {
  id: string;
  name: string;
  price: number | null; // ผลรวม estimate final ทุกใบ — null ถ้า role ไม่ใช่ ceo/admin
  systemSize: string;
  date: string;
  statusId: number;
  installedAt: string | null;
  tagsLocation: string[];
  tagsCustomer: string[];
  tagsSystem: string[];
  tagsTotal: string[];
}

// ตรงกับ status.id ในตาราง status ของ DB — ใช้ร่วมกันระหว่าง workflow-page และ dashboard
export const WORKFLOW_STATUS = {
  NEED_ANALYSIS: 1,
  PROPOSED: 2,
  ON_GOING: 3,
  ON_HOLD_REVIEW: 4,
  TO_BE_INSTALLED: 5,
  INSTALLED: 6,
  REJECTED: 7,
} as const;

export interface CustomerStatusUpdate {
  id: string;
  statusId: number;
}

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly baseUrl = `${environment.apiUrl}/customers`;

  // output: customers ทั้งหมดพร้อม tags และ statusId สำหรับ Kanban
  getCustomers(): Observable<Customer[]> {
    return this.http.get<Customer[]>(this.baseUrl);
  }

  // input: customer id (UUID) + statusId ใหม่ (number ของ status.id เช่น 3)
  updateCustomerStatus(update: CustomerStatusUpdate): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/${update.id}/status`, {
      statusId: update.statusId,
    });
  }

  // input: array ของ {id, sortOrder} ทุก card ใน column ที่ถูก drag
  reorderCustomers(updates: { id: string; sortOrder: number }[]): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/reorder`, { updates });
  }

  // output: stream ของ {id, statusId} ทุกครั้งที่ tab อื่น update status ของ customer
  listenToStatusChanges(): Observable<{ id: string; statusId: number }> {
    const client = this.authService.supabaseClient;
    if (!client) return EMPTY;

    return new Observable(observer => {
      // Force JWT ก่อน subscribe — ป้องกัน channel subscribe แบบ anonymous ในช่วง session restore
      const token = this.authService.getAccessToken();
      if (token) client.realtime.setAuth(token);

      const channel = client
        .channel('customers-status-changes')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'customers' },
          (payload) => {
            const record = payload.new as { id: string; status_id: number };
            if (record.id && record.status_id != null) {
              observer.next({ id: record.id, statusId: record.status_id });
            }
          }
        )
        .subscribe((status, err) => {
          if (err) observer.error(err);
        });

      return () => {
        client.removeChannel(channel);
      };
    });
  }
}
