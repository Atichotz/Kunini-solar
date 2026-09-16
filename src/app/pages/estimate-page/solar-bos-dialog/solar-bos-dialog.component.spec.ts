import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SolarBOSDialogComponent } from './solar-bos-dialog.component';

describe('SolarBOSDialogComponent', () => {
  let component: SolarBOSDialogComponent;
  let fixture: ComponentFixture<SolarBOSDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SolarBOSDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SolarBOSDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
