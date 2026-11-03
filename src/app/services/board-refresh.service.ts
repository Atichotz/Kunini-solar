import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

// event bus ให้ board (todo/ticket) ที่ฝังอยู่หลายหน้าโหลดข้อมูลใหม่ เมื่อมีอีก instance (dialog "Task & Ticket" ใน header) แก้ข้อมูลไป
@Injectable({ providedIn: 'root' })
export class BoardRefreshService {
  private readonly refreshSubject = new Subject<void>();

  // emit ทุกครั้งที่ dialog Task & Ticket ปิด — board ที่ยังอยู่บนหน้าอื่นฟังแล้วโหลดสดใหม่
  readonly refresh$: Observable<void> = this.refreshSubject.asObservable();

  notify(): void {
    this.refreshSubject.next();
  }
}
