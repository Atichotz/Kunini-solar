import { Component, inject, signal } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { TabsModule } from 'primeng/tabs';
import { WorkflowService, Customer } from '../services/workflow.service';
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

  readonly visible = signal(false);
  readonly customers = signal<Customer[]>([]);

  // เปิด dialog + โหลดรายชื่อลูกค้าใหม่ทุกครั้ง กันข้อมูลเก่าค้าง (เหมือน CustomerListDrawerComponent.open())
  open(): void {
    this.visible.set(true);
    this.workflowService.getCustomers().subscribe({
      next: list => this.customers.set(list),
      error: err => console.error('[AddTaskDialog] Failed to load customers:', err)
    });
  }

  onVisibleChange(value: boolean): void {
    this.visible.set(value);
  }
}
