import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { EstimateService } from '../../services/estimate.service';
import type { EstimateDetail } from '../../dto/estimate.dto';

const BOS_CATEGORY_LABELS: Record<string, string> = {
  cables: 'Cables',
  switch_gears: 'Switch Gears',
  solar_equipment: 'Solar Equipment',
  conduit_junction_boxes: 'Conduit & Junction Boxes',
  accessories: 'Accessories',
};

const LABOUR_CATEGORY_LABELS: Record<string, string> = {
  in_house: 'In-House Labour',
  outsourced: 'Outsourced Labour',
  machinery: 'Machinery',
};

@Component({
  selector: 'app-estimate-history-page',
  imports: [CommonModule, RouterLink, ButtonModule],
  templateUrl: './estimate-history-page.component.html',
  styleUrl: './estimate-history-page.component.scss',
})
export class EstimateHistoryPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly estimateService = inject(EstimateService);

  detail: EstimateDetail | null = null;
  loading = true;
  notFound = false;

  // ปุ่ม X: กลับไปหน้าลูกค้าเดิมเสมอ — ใช้ route param ตรงๆ กันกรณี detail ยังโหลดไม่เสร็จ/error
  get backLink(): string[] {
    const id = this.route.snapshot.paramMap.get('id');
    return id ? ['/detail', id] : ['/dashboard'];
  }

  ngOnInit(): void {
    const estimateId = this.route.snapshot.paramMap.get('estimateId');
    if (!estimateId) {
      this.notFound = true;
      this.loading = false;
      return;
    }

    this.estimateService.getOne(estimateId).subscribe({
      next: (detail) => {
        // draft ยังแก้ไขได้ — ไม่ใช่หน้าที่นี่ พากลับไปหน้า estimate แทน
        if (detail.status === 'draft') {
          this.router.navigate(['/estimate'], {
            queryParams: { customerId: detail.customerId, estimateId: detail.id },
          });
          return;
        }
        this.detail = detail;
        this.loading = false;
      },
      error: (err) => {
        console.error('[API] Failed to load estimate:', err);
        this.notFound = true;
        this.loading = false;
      },
    });
  }

  bosCategoryLabel(category: string): string {
    return BOS_CATEGORY_LABELS[category] ?? category;
  }

  labourCategoryLabel(category: string): string {
    return LABOUR_CATEGORY_LABELS[category] ?? category;
  }

  labourItemsFor(category: string) {
    return this.detail?.labourItems.filter((i) => i.category === category) ?? [];
  }

  labourCategoryTotal(category: string): number {
    return this.labourItemsFor(category).reduce((sum, i) => sum + i.total, 0);
  }
}
