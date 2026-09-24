import { Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import {
  EquipmentService,
  RoofTypeItem,
  SolarRackingItem,
  CreateRackingPayload,
  UpdateRackingPayload,
} from '../../../services/equipment.service';
import { PermissionService } from '../../../services/permission.service';
import { SaveOpts, SaveTask, runSaveAllBatch } from '../save-all-batch.util';

interface RackingRow {
  id: number | null;
  roofTypeId: number | null;
  part: string;
  description: string;
  costPrice: number | null;
  salePrice: number | null;
  saving: boolean;
  deleting?: boolean;
}

interface RoofTypeOption {
  label: string;
  value: number;
}

function toRackingRow(r: SolarRackingItem): RackingRow {
  return {
    id: r.id,
    roofTypeId: r.roofTypeId,
    part: r.part,
    description: r.description,
    costPrice: r.costPrice,
    salePrice: r.salePrice,
    saving: false,
  };
}

@Component({
  selector: 'app-setting-racking',
  imports: [FormsModule, SelectModule, ToastModule, ConfirmDialogModule, NgClass],
  templateUrl: './setting-racking.component.html',
  styleUrl: './setting-racking.component.scss',
  providers: [MessageService, ConfirmationService],
})
export class SettingRackingComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  readonly canManage = inject(PermissionService).canManageProducts;

  @Input() searchQuery = '';

  rows: RackingRow[] = [];
  roofTypeOptions: RoofTypeOption[] = [];
  newRoofTypeName = '';
  addingRoofType = false;
  showAddRoofTypeForm = false;
  showDeleteRoofTypeForm = false;
  roofTypeIdToDelete: number | null = null;
  deletingRoofType = false;

  isLoadingRoofTypes = true;
  isLoadingRows = true;

  // Add Row ต้องรอทั้งรายการ racking และ roof type (ใช้เป็นตัวเลือกใน dropdown ของแต่ละแถว)
  get isLoading(): boolean {
    return this.isLoadingRows || this.isLoadingRoofTypes;
  }

  get filteredRows(): RackingRow[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.rows;
    return this.rows.filter((r) => r.part.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }

  ngOnInit(): void {
    this.equipmentService.getRoofTypes()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => (this.isLoadingRoofTypes = false)))
      .subscribe({
        next: (roofTypes: RoofTypeItem[]) => (this.roofTypeOptions = roofTypes.map((r) => ({ label: r.name, value: r.id }))),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'Failed to load roof types' }),
      });

    this.equipmentService.getSolarRacking()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => (this.isLoadingRows = false)))
      .subscribe({
        next: (items) => (this.rows = items.map(toRackingRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'Failed to load solar racking' }),
      });
  }

  addRoofType(): void {
    if (!this.canManage()) return;
    const name = this.newRoofTypeName.trim();
    if (!name) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Please enter a Roof Type name before adding' });
      return;
    }

    this.addingRoofType = true;
    this.equipmentService.createRoofType({ name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (roofType) => {
          this.roofTypeOptions = [...this.roofTypeOptions, { label: roofType.name, value: roofType.id }];
          this.newRoofTypeName = '';
          this.addingRoofType = false;
          this.showAddRoofTypeForm = false;
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Roof Type "${roofType.name}" added successfully`, life: 2000 });
        },
        error: () => {
          this.addingRoofType = false;
          this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'Failed to add Roof Type. Please try again' });
        },
      });
  }

  cancelAddRoofType(): void {
    this.newRoofTypeName = '';
    this.showAddRoofTypeForm = false;
  }

  cancelDeleteRoofType(): void {
    this.roofTypeIdToDelete = null;
    this.showDeleteRoofTypeForm = false;
  }

  // ลบ roof type ที่เลือกจาก dropdown — backend ตอบ 409 ถ้ายังมี racking ผูกอยู่ จึงแสดงข้อความจาก backend ให้ผู้ใช้รู้ว่าต้องลบ row ก่อน
  removeRoofType(): void {
    if (!this.canManage()) return;
    const id = this.roofTypeIdToDelete;
    if (id === null || this.deletingRoofType) return;

    const roofTypeName = this.roofTypeOptions.find((option) => option.value === id)?.label ?? '';
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove Roof Type "${roofTypeName}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.deletingRoofType = true;
        this.equipmentService.deleteRoofType(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.roofTypeOptions = this.roofTypeOptions.filter((option) => option.value !== id);
              // row ที่ยังไม่ได้บันทึกและเลือก roof type นี้ไว้ ต้องเคลียร์ ไม่งั้น save แล้วจะอ้าง id ที่ถูกลบไปแล้ว
              this.rows.forEach((row) => {
                if (row.id === null && row.roofTypeId === id) row.roofTypeId = null;
              });
              this.deletingRoofType = false;
              this.cancelDeleteRoofType();
              this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `Roof Type "${roofTypeName}" removed`, life: 2000 });
            },
            error: (err: HttpErrorResponse) => {
              this.deletingRoofType = false;
              const isInUse = err.status === 409;
              this.messageService.add({
                severity: isInUse ? 'warn' : 'error',
                summary: 'Delete Failed',
                detail: isInUse ? 'This Roof Type still has Solar Racking items. Delete them first' : 'Failed to delete Roof Type. Please try again',
              });
            },
          });
      },
    });
  }

  addRow(): void {
    if (!this.canManage()) return;
    this.rows.push({ id: null, roofTypeId: null, part: '', description: '', costPrice: null, salePrice: null, saving: false });
  }

  saveRow(row: RackingRow, opts?: SaveOpts): void {
    if (!this.canManage()) return;
    if (row.roofTypeId === null || !row.part.trim() || !row.description.trim()) {
      if (!opts?.silent) {
        this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Please select a Roof Type and fill in Part and Description before saving' });
      }
      opts?.onDone?.(false);
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createSolarRacking(this.buildCreatePayload(row))
      : this.equipmentService.updateSolarRacking(row.id, this.buildUpdatePayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toRackingRow(saved));
        if (!opts?.silent) {
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: `${saved.part} saved successfully`, life: 2000 });
        }
        opts?.onDone?.(true);
      },
      error: () => {
        row.saving = false;
        if (!opts?.silent) {
          this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'Failed to save. Please try again' });
        }
        opts?.onDone?.(false);
      },
    });
  }

  // เซฟทุกแถวพร้อมกัน — ยิงแบบ silent แล้วรอครบทุกแถวค่อยขึ้น toast สรุปครั้งเดียว
  saveAllRows(): void {
    if (!this.canManage()) return;
    const tasks: SaveTask[] = [];
    for (const row of this.rows) {
      if (row.saving || row.deleting) continue;
      if (row.id === null && row.roofTypeId === null && !row.part.trim() && !row.description.trim()) continue;
      tasks.push((onDone) => this.saveRow(row, { silent: true, onDone }));
    }
    runSaveAllBatch(tasks, this.messageService);
  }

  removeRow(row: RackingRow): void {
    if (!this.canManage()) return;
    if (row.saving || row.deleting) return;
    if (row.id === null) {
      this.rows = this.rows.filter((r) => r !== row);
      return;
    }
    const id = row.id;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove ${row.part} - ${row.description} from the list?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        row.deleting = true;
        this.equipmentService.deleteSolarRacking(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            // filter ด้วย reference (ไม่ใช้ index) กันลบผิดแถวถ้า list เปลี่ยนระหว่างรอ confirm/response
            next: () => (this.rows = this.rows.filter((r) => r !== row)),
            error: () => {
              row.deleting = false;
              this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'Failed to delete. Please try again' });
            },
          });
      },
    });
  }

  private buildCreatePayload(row: RackingRow): CreateRackingPayload {
    const payload: CreateRackingPayload = { roofTypeId: row.roofTypeId as number, part: row.part, description: row.description };
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    if (row.salePrice !== null) payload.salePrice = row.salePrice;
    return payload;
  }

  private buildUpdatePayload(row: RackingRow): UpdateRackingPayload {
    return this.buildCreatePayload(row);
  }
}
