export type TodoCategory = 'technician' | 'admin';
export type TodoStatus = 'todo' | 'to_schedule' | 'in_progress' | 'done';
export type TodoRole = 'ceo' | 'purchasing' | 'admin' | 'technician';

// ผู้ใช้ใน allowed_users — role ตรงนี้คือแหล่งอ้างอิงเดียวของฟีเจอร์ To-Do (ไม่ใช่ role ใน UserProfile)
export interface TodoAssignee {
  id: string;
  name: string;
  role: TodoRole;
}

export interface TodoCard {
  id: string;
  title: string;
  description: string | null;
  isDone: boolean;
  status: TodoStatus;
  category: TodoCategory;
  customerId: string | null;
  customerName: string | null;
  startDate: string | null;
  daysAllotted: number | null;
  closeDate: string | null;
  assignees: TodoAssignee[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

// ไฟล์แนบของ task เอง (แนบตอน Add) — แสดงใต้ Description ใน drawer ต่างจาก TodoCommentAttachment ที่อยู่ใน comment
export interface TodoAttachment {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
}

export interface TodoCommentAttachment {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
}

export interface TodoComment {
  id: string;
  todoId: string;
  author: TodoAssignee;
  body: string;
  // allowed_users.id ของคนที่ถูก @mention — ใช้ highlight ฝั่ง UI เท่านั้น ไม่มี notification
  mentionedUserIds: string[];
  attachments: TodoCommentAttachment[];
  createdAt: string;
}

// input ตอนเพิ่ม comment — files ส่งเป็น multipart แยกจาก body/mentionedUserIds
export interface AddTodoCommentPayload {
  body?: string;
  mentionedUserIds?: string[];
  files?: File[];
}

export interface CreateTodoPayload {
  title: string;
  description?: string;
  customer_id?: string;
  start_date?: string;
  days_allotted?: number;
  assignee_ids: string[];
}

// undefined = ไม่แตะ field นั้น, null = ล้างค่า — ตรงกับ UpdateTodoDto ฝั่ง backend
// assignee_ids แทนที่ผู้รับงานทั้งชุด (ไม่รับ null — เคลียร์ผู้รับงานทั้งหมดไม่ได้ ต้องมีอย่างน้อย 1 คนเสมอ)
export interface UpdateTodoPayload {
  title?: string;
  description?: string | null;
  customer_id?: string | null;
  start_date?: string | null;
  days_allotted?: number | null;
  close_date?: string | null;
  status?: TodoStatus;
  assignee_ids?: string[];
}
