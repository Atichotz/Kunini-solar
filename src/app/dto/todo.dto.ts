export type TodoCategory = 'technician' | 'admin';
export type TodoStatus = 'todo' | 'in_progress' | 'done';
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
  dueDate: string | null;
  assignees: TodoAssignee[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoPayload {
  title: string;
  description?: string;
  due_date?: string;
  assignee_ids: string[];
}
