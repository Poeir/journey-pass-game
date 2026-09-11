# สรุป UX/UI ที่ปรับตั้งแต่ 5 พ.ค. 2026

## 6 พ.ค.
- **กำแพงความทรงจำ**: เพิ่ม slideshow + ปุ่ม navigate + backdrop effect

## 7 พ.ค.
- **Admin Portal**: เพิ่มหน้า admin ทั้งหมด + sidebar + design-system `Sheet`
- **Welcome**: ปรับ layout รองรับจอเตี้ย + ย้ายตำแหน่งปุ่ม CTA
- **Welcome**: เพิ่ม dev-login picker (เลือกพนักงานเพื่อ login ใน dev mode)
- **Polish ทั่วเกม**: ปรับ a11y + style บน Scanner, Success, FailPenalty, ProgressDock, TriviaCards, MissionSelect, TimeUp, Avatar
- **FailPenalty**: ให้ฝั่ง target ถูกพาเข้าหน้านี้อัตโนมัติ (ห้ามหนี penalty)

## 8 พ.ค.
- **LanguageToggle**: เพิ่มปุ่มสลับ TH/EN ที่หัว Welcome + Admin
- **i18n**: แปลทุกข้อความผ่าน `t()` ทั้งเกม (th default, en fallback)
- **ลบ NotificationCenter**: เอากระดิ่ง + ชีตแจ้งเตือนออก ใช้ auto-redirect ผ่าน `GameShell` แทน
- **TimeUpPage**: ปรับใหม่ให้เป็น landing เต็มจอเมื่อเกมจบ
- **ChatConfirm**: ต่อ flow ถ่ายรูปความทรงจำหลังตอบคำถามเสร็จ
- **SuccessPage**: รองรับ `?role=leader` แสดงคำที่แตกต่าง
- **Admin**:
  - หน้ารายละเอียดผู้เล่น — เพิ่ม Sheet override (ให้ตรา, เพิ่มเพื่อน, เปลี่ยนหัวหน้า)
  - เพิ่มหน้า `คำตอบจากแชท` พร้อม privacy mode + 2 มุมมอง
  - เพิ่มปุ่ม `สุ่มมอบหมายหัวหน้าใหม่`

## 11 พ.ค.
- **Admin**: ขัดเกลาคำแปลภาษาไทยให้สื่อความหมายชัดและสม่ำเสมอ
