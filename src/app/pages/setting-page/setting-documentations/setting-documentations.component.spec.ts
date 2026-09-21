import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingDocumentationsComponent } from './setting-documentations.component';

describe('SettingDocumentationsComponent', () => {
  let component: SettingDocumentationsComponent;
  let fixture: ComponentFixture<SettingDocumentationsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingDocumentationsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingDocumentationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
