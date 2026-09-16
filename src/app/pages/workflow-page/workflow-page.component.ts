import { Component, OnInit, OnDestroy, inject, signal, computed, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { CdkDragDrop, CdkDropList, CdkDrag, CdkDragPreview, CdkDragPlaceholder, CdkDropListGroup, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Customer, WorkflowService } from '../../services/workflow.service';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { Router } from '@angular/router';
import { NewCustomerPageComponent } from '../new-customer-page/new-customer-page.component';
import { NewCustomerSuccessPopupComponent } from '../../popups/new-customer-success-popup/new-customer-success-popup.component';
import { KLoadingComponent } from '../../k-loading/k-loading.component';
interface WorkflowColumn {
  id: number;
  name: string;
  color: string;
  headerColor: string;
  cards: Customer[];
}

/** กำหนด column แต่ละขั้นตอน — เก็บแค่ layout ไม่มีข้อมูล customer */
const COLUMN_DEFS: Omit<WorkflowColumn, 'cards'>[] = [
  { id: 1, name: 'Need Analysis', color: '#e8f4fd', headerColor: '#414142' },
  { id: 2, name: 'Proposed', color: '#fef9e7', headerColor: '#414142' },
  { id: 3, name: 'On going', color: '#f3e5f5', headerColor: '#414142' },
  { id: 4, name: 'On hold / Review', color: '#e8f5e9', headerColor: '#414142' },
  { id: 5, name: 'To be Installed', color: '#fff3e0', headerColor: '#414142' },
  { id: 6, name: 'Installed', color: '#e0f7fa', headerColor: '#414142' },
  { id: 7, name: 'Rejected', color: '#f1f8e9', headerColor: '#414142' },
];

@Component({
  selector: 'app-workflow-page',
  imports: [CommonModule, FormsModule, CdkDropList, CdkDrag, CdkDragPreview, CdkDragPlaceholder, CdkDropListGroup, CdkScrollable, TooltipModule, ButtonModule, NewCustomerPageComponent, NewCustomerSuccessPopupComponent, KLoadingComponent],
  templateUrl: './workflow-page.component.html',
  styleUrl: './workflow-page.component.scss'
})
export class WorkflowPageComponent implements OnInit, OnDestroy {
  constructor(private router: Router) { }

  showNewCustomerDialog = signal(false);
  showSuccessPopup = false;
  private recentlyDraggedId: string | null = null;
  private realtimeSubscription: Subscription | null = null;
  private isOwnReorder = false;
  private ownReorderTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  openNewCustomerDialog(): void {
    this.showNewCustomerDialog.set(true);
  }
  newCustomerData: any;
  onCustomerSaved(newCustomerData: any): void {
    this.showNewCustomerDialog.set(false);
    this.showSuccessPopup = true;
    this.newCustomerData = newCustomerData;
    this.loadCustomers();
  }

  onCustomerCancelled(): void {
    this.showNewCustomerDialog.set(false);
  }

  private loadCustomers(): void {
    this.workflowService.getCustomers().subscribe({
      next: (customers) => {
        this.sourceColumns.set(COLUMN_DEFS.map(def => ({
          ...def,
          cards: customers
            .filter(c => c.statusId === def.id)
            .map(c => ({ ...c, tagsTotal: [...c.tagsCustomer, ...c.tagsSystem] })),
        })));
      },
      error: (err) => console.error('[API] Failed to reload customers:', err),
    });
  }
  private workflowService = inject(WorkflowService);
  private ngZone = inject(NgZone);

  private sourceColumns = signal<WorkflowColumn[]>(
    COLUMN_DEFS.map(def => ({ ...def, cards: [] }))
  );

  selectedTags = signal<Set<string>>(new Set());

  /** รวม tag ทั้งหมดที่มีในทุก card ไม่ซ้ำกัน เพื่อแสดงใน filter bar */
  allTags = computed<string[]>(() => {
    const tags = new Set<string>();
    this.sourceColumns().forEach(col =>
      col.cards.forEach(card =>
        card.tagsTotal.forEach(tag => tags.add(tag))
      )
    );
    return [...tags].sort();
  });

  /** view ที่กรองแล้ว — ถ้ายังไม่เลือก tag ใด แสดงทั้งหมด, ถ้าเลือกแล้ว แสดงเฉพาะ card ที่มี tag ตรงกัน */
  columns = computed<WorkflowColumn[]>(() => {
    const selected = this.selectedTags();
    if (selected.size === 0) return this.sourceColumns();
    return this.sourceColumns().map(col => ({
      ...col,
      cards: col.cards.filter(card =>
        card.tagsTotal.some(tag => selected.has(tag))
      ),
    }));
  });

  isLoading = signal(true);

  ngOnInit(): void {
    this.workflowService.getCustomers().subscribe({
      next: (customers) => {
        console.log('customers', customers);

        this.sourceColumns.set(COLUMN_DEFS.map(def => ({
          ...def,
          cards: customers
            .filter(c => c.statusId === def.id)
            .map(c => ({ ...c, tagsTotal: [...c.tagsCustomer, ...c.tagsSystem] })),
        })));
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('[API] Failed to load customers:', err);
        this.isLoading.set(false);
      }
    });

    this.realtimeSubscription = this.workflowService.listenToStatusChanges().subscribe(({ id, statusId }) => {
      this.ngZone.run(() => {
        if (id === this.recentlyDraggedId) return;

        const cols = this.sourceColumns();
        let movedCard: Customer | undefined;
        let fromColIndex = -1;

        for (let i = 0; i < cols.length; i++) {
          const idx = cols[i].cards.findIndex(c => c.id === id);
          if (idx !== -1) {
            movedCard = cols[i].cards[idx];
            fromColIndex = i;
            break;
          }
        }

        if (!movedCard) return;

        const toColIndex = cols.findIndex(c => c.id === statusId);
        if (toColIndex === -1) return;
        if (fromColIndex === toColIndex) {
          // sort_order เปลี่ยน (same-column reorder จาก tab อื่น) → debounce reload
          if (!this.isOwnReorder) {
            if (this.reloadDebounceTimer) clearTimeout(this.reloadDebounceTimer);
            this.reloadDebounceTimer = setTimeout(() => this.loadCustomers(), 300);
          }
          return;
        }

        const updated = cols.map(c => ({ ...c, cards: [...c.cards] }));
        updated[fromColIndex].cards = updated[fromColIndex].cards.filter(c => c.id !== id);
        updated[toColIndex].cards.push({ ...movedCard, statusId });
        this.sourceColumns.set(updated);
      });
    });
  }

  ngOnDestroy(): void {
    this.realtimeSubscription?.unsubscribe();
    if (this.ownReorderTimer) clearTimeout(this.ownReorderTimer);
    if (this.reloadDebounceTimer) clearTimeout(this.reloadDebounceTimer);
  }

  get columnIds(): string[] {
    return this.columns().map(c => String(c.id));
  }

  get isFiltering(): boolean {
    return this.selectedTags().size > 0;
  }

  isTagSelected(tag: string): boolean {
    return this.selectedTags().has(tag);
  }

  toggleTag(tag: string, checked: boolean): void {
    const next = new Set(this.selectedTags());
    checked ? next.add(tag) : next.delete(tag);
    this.selectedTags.set(next);
  }

  drop(event: CdkDragDrop<Customer[]>, targetColumnId: number): void {
    this.isOwnReorder = true;
    if (this.ownReorderTimer) clearTimeout(this.ownReorderTimer);
    this.ownReorderTimer = setTimeout(() => { this.isOwnReorder = false; }, 3000);

    const cols = this.sourceColumns();
    const targetIndex = cols.findIndex(c => c.id === targetColumnId);
    const updated = cols.map(c => ({ ...c, cards: [...c.cards] }));

    // previousIndex / currentIndex คือ index ใน filtered array (ที่กรองแล้ว)
    // ถ้ากำลัง filter อยู่ ต้องแปลงกลับเป็น index จริงใน sourceColumns ก่อน
    if (event.previousContainer === event.container) { //ถ้า drop ใน column เดิม แต่เปลี่ยนตำแหน่งการ์ด
      if (this.isFiltering) {
        const actualCards = updated[targetIndex].cards;
        const draggedCard = event.previousContainer.data[event.previousIndex];
        const actualPrevIdx = actualCards.findIndex(c => c.id === draggedCard.id);

        actualCards.splice(actualPrevIdx, 1);
        const selected = this.selectedTags();
        const filteredAfter = actualCards.filter(c =>
          c.tagsTotal.some(t => selected.has(t))
        );
        const insertIdx =
          filteredAfter.length === 0 || event.currentIndex >= filteredAfter.length
            ? filteredAfter.length === 0
              ? actualCards.length
              : actualCards.findIndex(c => c.id === filteredAfter[filteredAfter.length - 1].id) + 1
            : actualCards.findIndex(c => c.id === filteredAfter[event.currentIndex].id);
        actualCards.splice(insertIdx, 0, draggedCard);
      } else {
        // mutate in-place — ให้ CDK ยังชี้ array เดิม ไม่ reset animation
        this.sourceColumns.update(currentCols => {
          moveItemInArray(currentCols[targetIndex].cards, event.previousIndex, event.currentIndex);
          return currentCols.map((col, i) => i === targetIndex ? { ...col } : col);
        });
        this.workflowService.reorderCustomers(
          this.sourceColumns()[targetIndex].cards.map((c, i) => ({ id: c.id, sortOrder: i }))
        ).subscribe({ error: (err) => console.error('[API] Failed to reorder:', err) });
        return;
      }
      this.sourceColumns.set(updated);
      this.workflowService.reorderCustomers(
        updated[targetIndex].cards.map((c, i) => ({ id: c.id, sortOrder: i }))
      ).subscribe({ error: (err) => console.error('[API] Failed to reorder:', err) });
      return;
    }

    const sourceId = Number(event.previousContainer.id);
    const sourceIndex = cols.findIndex(c => c.id === sourceId);
    if (sourceIndex === -1) return;

    // previousContainer.data คือ filtered array — index ถูกต้องสำหรับ filtered view
    const draggedCard = event.previousContainer.data[event.previousIndex];

    if (this.isFiltering) {
      const actualPrevIdx = updated[sourceIndex].cards.findIndex(c => c.id === draggedCard.id);
      updated[sourceIndex].cards.splice(actualPrevIdx, 1);

      // container.data คือ filtered cards ของ column ปลายทาง (snapshot ก่อน drop)
      const filteredTarget: Customer[] = event.container.data;
      let actualCurrIdx: number;
      if (filteredTarget.length === 0) {
        actualCurrIdx = updated[targetIndex].cards.length;
      } else if (event.currentIndex >= filteredTarget.length) {
        actualCurrIdx = updated[targetIndex].cards.findIndex(
          c => c.id === filteredTarget[filteredTarget.length - 1].id
        ) + 1;
      } else {
        actualCurrIdx = updated[targetIndex].cards.findIndex(
          c => c.id === filteredTarget[event.currentIndex].id
        );
      }
      updated[targetIndex].cards.splice(actualCurrIdx, 0, { ...draggedCard, statusId: targetColumnId });
    } else {
      transferArrayItem(
        updated[sourceIndex].cards,
        updated[targetIndex].cards,
        event.previousIndex,
        event.currentIndex
      );
      updated[targetIndex].cards[event.currentIndex] = {
        ...updated[targetIndex].cards[event.currentIndex],
        statusId: targetColumnId,
      };
    }

    this.sourceColumns.set(updated);
    this.recentlyDraggedId = draggedCard.id;

    this.workflowService.updateCustomerStatus({
      id: draggedCard.id,
      statusId: targetColumnId,
    }).subscribe({
      next: () => { this.recentlyDraggedId = null; },
      error: (err) => {
        console.error('[API] Failed to update customer status:', err);
        this.recentlyDraggedId = null;
      },
    });

    this.workflowService.reorderCustomers([
      ...updated[sourceIndex].cards.map((c, i) => ({ id: c.id, sortOrder: i })),
      ...updated[targetIndex].cards.map((c, i) => ({ id: c.id, sortOrder: i })),
    ]).subscribe({ error: (err) => console.error('[API] Failed to reorder:', err) });
  }

  readonly VISIBLE_TAG_LIMIT = 2;

  visibleTags(tags: string[]): string[] {
    return tags?.slice(0, this.VISIBLE_TAG_LIMIT) ?? [];
  }

  hiddenTagCount(tags: string[]): number {
    return Math.max(0, (tags?.length ?? 0) - this.VISIBLE_TAG_LIMIT);
  }

  formatPrice(price: number): string {
    return '฿' + price.toLocaleString('th-TH');
  }

  avatarLetter(customer: Customer): string {
    return customer.name.toUpperCase();
  }

  cardCount(col: WorkflowColumn): number {
    return col.cards.length;
  }

  openDetail(card: any) {
    console.log(card);
    this.router.navigate(['/detail', card.id]); // เปลี่ยนเป็น id จริงของ customer ที่ต้องการแสดงรายละเอียด
  }
}
