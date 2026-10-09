import { Component, inject, signal } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { TabsModule } from 'primeng/tabs';
import { WorkflowService, Customer } from '../services/workflow.service';
import { BoardRefreshService } from '../services/board-refresh.service';
import { PermissionService } from '../services/permission.service';
import { TodoBoardComponent } from '../todo-board/todo-board.component';
import { TicketBoardComponent } from '../ticket-board/ticket-board.component';

@Component({
  selector: 'app-add-task-dialog',
  standalone: true,
  imports: [DialogModule, TabsModule, TodoBoardComponent, TicketBoardComponent],
  templateUrl: './add-task-dialog.component.html',
  styleUrl: './add-task-dialog.component.scss'
})
export class AddTaskDialogComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly boardRefresh = inject(BoardRefreshService);
  // technician เห็นเฉพาะงานของตัวเองและดู/comment ได้อย่างเดียว — ซ่อนปุ่ม Add และส่ง readOnly ให้ board (สิทธิ์จริงบังคับที่ backend)
  // sales เห็นเฉพาะแท็บ Task (แก้ได้เท่า engineer) ไม่เห็นแท็บ Ticket
  private readonly permission = inject(PermissionService);
  readonly canEditTodos = this.permission.canEditTodos;
  readonly canEditTickets = this.permission.canEditTickets;
  readonly canSeeTicketBoard = this.permission.canSeeTicketBoard;

  readonly visible = signal(false);
  readonly customers = signal<Customer[]>([]);

  // type ตาม model ของ p-tabs ([(value)]) — ใช้รู้ว่าปุ่ม Add ตอนนี้ควรสลับฟอร์มของแท็บไหน
  readonly activeTab = signal<string | number>('todo');
  // ฟอร์ม Add ซ่อนไว้ก่อนจนกดปุ่ม Add — แยก state ต่อแท็บ เพื่อให้ฟอร์มที่เปิดค้างไว้ยังอยู่เมื่อสลับแท็บกลับมา
  readonly showTaskForm = signal(false);
  readonly showTicketForm = signal(false);

  toggleAddForm(): void {
    const formSignal = this.activeTab() === 'ticket' ? this.showTicketForm : this.showTaskForm;
    formSignal.update(isOpen => !isOpen);
  }

  // เปิด dialog + โหลดรายชื่อลูกค้าใหม่ทุกครั้ง กันข้อมูลเก่าค้าง (เหมือน CustomerListDrawerComponent.open())
  open(): void {
    // board ถูกสร้างใหม่ทุกครั้งที่เปิด (ดู @if ใน template) จึง reset ฟอร์ม/แท็บให้กลับเป็นค่าเริ่มต้นด้วย ไม่ให้เปิดมาแล้วฟอร์มค้างจากรอบก่อน
    this.activeTab.set('todo');
    this.showTaskForm.set(false);
    this.showTicketForm.set(false);
    this.visible.set(true);
    this.workflowService.getCustomers().subscribe({
      next: list => this.customers.set(list),
      error: err => console.error('[AddTaskDialog] Failed to load customers:', err)
    });
  }

  // ปิดแล้วแจ้ง board ของหน้าอื่น (เช่น customer detail) ให้โหลดใหม่ — board ของ dialog นี้ถูกทำลายตอนปิด จึงไม่โหลดซ้ำใส่ตัวเอง
  onVisibleChange(value: boolean): void {
    this.visible.set(value);
    if (!value) this.boardRefresh.notify();
  }
}
