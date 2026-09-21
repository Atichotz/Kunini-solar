import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { finalize } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import { EquipmentService, DocumentationTypeItem } from '../../../services/equipment.service';
import { PermissionService } from '../../../services/permission.service';

interface DocumentationRow {
  id: number | null;
  name: string;
  unitRate: number | null;
  saving: boolean;
  deleting?: boolean;
}

function toDocumentationRow(item: DocumentationTypeItem): DocumentationRow {
  return { id: item.id, name: item.name, unitRate: item.unitRate, saving: false };
}

@Component({
  selector: 'app-setting-documentations',
  imports: [FormsModule, ToastModule, ConfirmDialogModule, NgClass],
  templateUrl: './setting-documentations.component.html',
  styleUrl: './setting-documentations.component.scss',
  providers: [MessageService, ConfirmationService],
})
export class SettingDocumentationsComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  readonly canManage = inject(PermissionService).canManage;

  rows: DocumentationRow[] = [];

  isLoadingRows = true;

  ngOnInit(): void {
    this.equipmentService.getDocumentationTypes()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => (this.isLoadingRows = false)))
      .subscribe({
        next: (items) => (this.rows = items.map(toDocumentationRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'Failed to load documentation types' }),
      });
  }

  addRow(): void {
    if (!this.canManage()) return;
    this.rows.push({ id: null, name: '', unitRate: null, saving: false });
  }

  // input: แถวที่กด save — สร้างใหม่ถ้ายังไม่มี id ไม่งั้นอัปเดต; unit rate ว่างถือเป็น 0 (แสดง "—" ในหน้า estimate)
  saveRow(row: DocumentationRow): void {
    if (!this.canManage() || row.saving || row.deleting) return;

    const name = row.name.trim();
    if (!name) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Please fill in Type before saving' });
      return;
    }
    const unitRate = row.unitRate ?? 0;
    if (unitRate < 0) {
      this.messageService.add({ severity: 'warn', summary: 'Invalid Unit Rate', detail: 'Unit Rate must not be negative' });
      return;
    }

    row.saving = true;
    const payload = { name, unitRate };
    const request$ = row.id === null
      ? this.equipmentService.createDocumentationType(payload)
      : this.equipmentService.updateDocumentationType(row.id, payload);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toDocumentationRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `${saved.name} saved successfully`, life: 2000 });
      },
      error: () => {
        row.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'Failed to save. Please try again' });
      },
    });
  }

  removeRow(row: DocumentationRow): void {
    if (!this.canManage()) return;
    if (row.saving || row.deleting) return;
    const id = row.id;
    if (id === null) {
      this.rows = this.rows.filter((r) => r !== row);
      return;
    }
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove "${row.name}" from the list?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        row.deleting = true;
        this.equipmentService.deleteDocumentationType(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            // filter ด้วย reference (ไม่ใช้ index) กันลบผิดแถวถ้า list เปลี่ยนระหว่างรอ confirm
            next: () => (this.rows = this.rows.filter((r) => r !== row)),
            error: () => {
              row.deleting = false;
              this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'Failed to delete. Please try again' });
            },
          });
      },
    });
  }
}
