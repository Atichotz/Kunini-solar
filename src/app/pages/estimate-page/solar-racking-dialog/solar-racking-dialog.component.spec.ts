import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SolarRackingDialogComponent } from './solar-racking-dialog.component';

describe('SolarRackingDialogComponent', () => {
  let component: SolarRackingDialogComponent;
  let fixture: ComponentFixture<SolarRackingDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SolarRackingDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SolarRackingDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
