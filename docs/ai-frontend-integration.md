# AI Assistant — Frontend Integration Guide

> **Last updated:** 2026-04-04 — matches the deployed BE response shape.

## Overview

The AI assistant is a page-aware chatbot that lives in a modal/drawer. It knows which page the user is on and tailors responses accordingly. The BE handles all intelligence (priority scoring, risk detection, language safety). The FE sends context and renders 4 fields.

---

## Endpoint

```
POST /api/v1/ai/ask
Authorization: Bearer <access_token>
Content-Type: application/json
```

Rate limit: 20 requests/minute per user.

---

## Request

```typescript
{
  query: string;                    // User's message (3–1200 chars)
  page: AiPage;                    // Which page the modal is open on
  displayMode?: 'auto' | 'standard' | 'minimal';  // Default: 'auto'
  context?: {
    // Summary page only
    stats?: {
      overdue?: number;
      dueToday?: number;
      pendingApproval?: number;
      rejected?: number;
      draft?: number;
      future?: number;
      comments?: number;
      rewards?: number;
    };
    todos?: SummaryItem[];          // Max 10
    tasksToApprove?: SummaryItem[]; // Max 10

    // All other pages
    items?: PageItem[];             // Max 25 — the visible rows on screen
    filters?: Record<string, string>;
    meta?: {
      total?: number;
      page?: number;
      pageSize?: number;
      totalPages?: number;
    };
  };
}

type SummaryItem = {
  title: string;                    // 1–200 chars
  status?: string;
  priority?: string;
  dueDate?: string | null;
};

type PageItem = {
  id?: string;
  title: string;                    // 1–300 chars
  status?: string;
  priority?: string;
  category?: string;
  type?: string;
  dueDate?: string | null;
  assignee?: string;
  home?: string;
  extra?: Record<string, string>;   // Arbitrary key-value metadata
};

type AiPage =
  | 'summary' | 'tasks' | 'daily_logs' | 'care_groups'
  | 'homes' | 'young_people' | 'employees' | 'vehicles'
  | 'form_designer' | 'users' | 'audit';
```

---

## Response

```typescript
{
  success: true;
  data: {
    message: string;              // Chat text — always render this
    highlights: Highlight[];      // Priority cards — empty for casual messages
    tip: string | null;           // Single insight — null means don't show
    actions: Action[];            // Quick-action buttons
    source: 'model' | 'fallback';
    generatedAt: string;          // ISO datetime
    meta: {                       // DO NOT RENDER — debug/logging only
      model: string | null;
      page: string;
      strengthProfile: 'owner' | 'admin' | 'staff';
      responseMode: 'comprehensive' | 'balanced' | 'focused';
      statsSource: 'client' | 'server' | 'none';
      languageSafetyPassed: boolean;
    };
  };
}

type Highlight = {
  title: string;                  // "Restraint Log Review — Physical Intervention"
  reason: string;                 // "Overdue, high priority"
  urgency: 'low' | 'medium' | 'high' | 'critical';
  action: string;                 // "Triage immediately and assign clear ownership now."
};

type Action = {
  label: string;                  // "Review overdue tasks"
  action: string;                 // "open_summary_todos_overdue"
};
```

---

## How to Render

```
┌─────────────────────────────────────────┐
│  Ask AI                              ✕  │
│                                         │
│         ┌─────────────────────┐         │
│         │ USER: "hello"       │         │
│         └─────────────────────┘         │
│  ┌─────────────────────────────┐        │
│  │ AI: "Hello! You have 2     │        │
│  │ overdue tasks — let me     │        │  ← message
│  │ know if you'd like help."  │        │
│  └─────────────────────────────┘        │
│                                         │
│         ┌─────────────────────┐         │
│         │ USER: "what should  │         │
│         │ I focus on today?"  │         │
│         └─────────────────────┘         │
│  ┌─────────────────────────────┐        │
│  │ AI: "Focus on the          │        │
│  │ Restraint Log Review..."   │        │  ← message
│  ├─────────────────────────────┤        │
│  │ ⚠ Restraint Log Review     │ CRIT   │
│  │   Overdue, high priority   │        │  ← highlights[]
│  │   → Triage immediately     │        │
│  ├─────────────────────────────┤        │
│  │ ⚠ Vehicle Safety Inspect.  │ CRIT   │
│  │   Marked high priority     │        │  ← highlights[]
│  │   → Triage immediately     │        │
│  ├─────────────────────────────┤        │
│  │ 💡 Some items have no      │        │
│  │    assignee.               │        │  ← tip
│  ├─────────────────────────────┤        │
│  │ [Review overdue] [Approvals]│       │  ← actions[]
│  └─────────────────────────────┘        │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Ask a question...               │    │
│  └─────────────────────────────────┘    │
│  [New Chat]  [Close]  [Ask AI]          │
└─────────────────────────────────────────┘
```

### What to render

| Field | Render as | Show when |
|-------|-----------|-----------|
| `message` | Chat bubble | **Always** |
| `highlights` | Cards with urgency badge + recommended action | Array is non-empty |
| `tip` | Info banner (light yellow/blue) | Not `null` |
| `actions` | Buttons below the response | Array is non-empty |
| `meta` | **Never** | Debug only (console.log if needed) |

### Urgency badge colors

| Value | Color | Meaning |
|-------|-------|---------|
| `critical` | Red | Overdue + high priority — act now |
| `high` | Orange | Due soon or rejected — act this shift |
| `medium` | Yellow | Needs attention today |
| `low` | Grey | Can wait |

---

## Page Context — What to Send

### How it works

- **Summary page:** BE fetches data from DB. FE can optionally send `stats`, `todos`, `tasksToApprove` from the dashboard to skip the server fetch (faster).
- **All other pages:** FE **must** send `items` (the visible rows on screen). Without it, the AI gives generic answers.

---

### Summary (`page: 'summary'`)

```typescript
{
  query: "What should I focus on today?",
  page: "summary",
  context: {
    stats: {
      overdue: 2,
      dueToday: 5,
      pendingApproval: 15,
      rejected: 3,
      draft: 1,
      future: 20,
      comments: 0,
      rewards: 0,
    },
    todos: [
      { title: "South Home Daily Task 8", status: "pending", priority: "medium", dueDate: "2026-04-03" },
      { title: "Night Fire Drill Report", status: "pending", priority: "high", dueDate: "2026-04-05" },
    ],
    tasksToApprove: [
      { title: "Restraint Log Review", status: "pending_approval", priority: "high", dueDate: "2026-04-04" },
    ],
  },
}
```

---

### Tasks (`page: 'tasks'`)

```typescript
{
  query: "Which tasks need attention first?",
  page: "tasks",
  context: {
    items: visibleTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category,
      dueDate: t.dueDate,
      assignee: t.assigneeName ?? undefined,
      home: t.homeName ?? undefined,
    })),
    filters: { status: "pending", priority: "high" },
    meta: { total: 42, page: 1, pageSize: 20, totalPages: 3 },
  },
}
```

---

### Daily Logs (`page: 'daily_logs'`)

```typescript
{
  query: "Any gaps in today's logs?",
  page: "daily_logs",
  context: {
    items: logs.map(log => ({
      id: log.id,
      title: log.title,
      status: log.approvalStatus,
      category: log.logCategory,
      dueDate: log.createdAt,
      assignee: log.submittedByName ?? undefined,
      home: log.homeName ?? undefined,
    })),
    filters: activeFilters,
    meta: paginationMeta,
  },
}
```

---

### Homes (`page: 'homes'`)

```typescript
{
  query: "Which homes are near capacity?",
  page: "homes",
  context: {
    items: homes.map(h => ({
      id: h.id,
      title: h.name,
      status: h.status,
      extra: {
        capacity: String(h.capacity),
        region: h.region ?? '',
        careGroup: h.careGroupName ?? '',
      },
    })),
    filters: activeFilters,
    meta: paginationMeta,
  },
}
```

---

### Young People (`page: 'young_people'`)

```typescript
{
  query: "Any placement reviews due?",
  page: "young_people",
  context: {
    items: youngPeople.map(yp => ({
      id: yp.id,
      title: `${yp.firstName} ${yp.lastName}`,
      status: yp.status,
      home: yp.homeName ?? undefined,
      extra: {
        referenceNo: yp.referenceNo ?? '',
        keyWorker: yp.keyWorkerName ?? '',
      },
    })),
    filters: activeFilters,
    meta: paginationMeta,
  },
}
```

---

### Employees (`page: 'employees'`)

```typescript
{
  query: "Who has expiring DBS?",
  page: "employees",
  context: {
    items: employees.map(e => ({
      id: e.id,
      title: `${e.user.firstName} ${e.user.lastName}`,
      status: e.status,
      home: e.homeName ?? undefined,
      extra: {
        role: e.roleName ?? '',
        jobTitle: e.jobTitle ?? '',
        dbsDate: e.dbsDate ?? '',
      },
    })),
    filters: activeFilters,
    meta: paginationMeta,
  },
}
```

---

### Vehicles (`page: 'vehicles'`)

```typescript
{
  query: "Any MOTs due this month?",
  page: "vehicles",
  context: {
    items: vehicles.map(v => ({
      id: v.id,
      title: `${v.make} ${v.model} — ${v.registration}`,
      status: v.status,
      home: v.homeName ?? undefined,
      extra: {
        motDue: v.motDue ?? '',
        nextServiceDue: v.nextServiceDue ?? '',
        insuranceDate: v.insuranceDate ?? '',
      },
    })),
    filters: activeFilters,
    meta: paginationMeta,
  },
}
```

---

### Care Groups (`page: 'care_groups'`)

```typescript
{
  query: "How are groups structured?",
  page: "care_groups",
  context: {
    items: groups.map(g => ({
      id: g.id,
      title: g.name,
      status: g.isActive ? 'active' : 'inactive',
      extra: { description: g.description ?? '' },
    })),
  },
}
```

---

### Form Designer (`page: 'form_designer'`)

```typescript
{
  query: "What forms do we have for incidents?",
  page: "form_designer",
  context: {
    items: templates.map(t => ({
      id: t.id,
      title: t.name,
      status: t.isActive ? 'active' : 'inactive',
      category: t.group ?? undefined,
      extra: { key: t.key, description: t.description ?? '' },
    })),
  },
}
```

---

### Users (`page: 'users'`)

```typescript
{
  query: "Who hasn't logged in recently?",
  page: "users",
  context: {
    items: users.map(u => ({
      id: u.id,
      title: `${u.firstName} ${u.lastName}`,
      status: u.isActive ? 'active' : 'inactive',
      extra: { email: u.email, role: u.role, lastLoginAt: u.lastLoginAt ?? '' },
    })),
  },
}
```

---

### Audit (`page: 'audit'`)

```typescript
{
  query: "Any suspicious login activity?",
  page: "audit",
  context: {
    items: logs.map(l => ({
      id: l.id,
      title: `${l.action} — ${l.entityType ?? 'system'}`,
      type: l.action,
      extra: { userId: l.userId ?? '', ipAddress: l.ipAddress ?? '', timestamp: l.createdAt },
    })),
    filters: activeFilters,
    meta: paginationMeta,
  },
}
```

---

## Action Keys

The `actions[].action` and highlight `action` strings are identifiers the FE maps to navigation or filter operations:

### Summary
| Action | FE handler |
|--------|------------|
| `open_summary_todos_overdue` | Navigate to tasks, filter overdue |
| `open_summary_pending_approvals` | Navigate to pending approvals |
| `open_summary_todos_due_today` | Navigate to tasks, filter due today |
| `open_summary_todos_all` | Navigate to tasks (no filter) |

### Tasks
| Action | FE handler |
|--------|------------|
| `filter_tasks_overdue` | Apply overdue filter |
| `filter_tasks_pending_approval` | Apply pending approval filter |
| `create_task` | Open new task form |

### Daily Logs
| Action | FE handler |
|--------|------------|
| `filter_daily_logs_submitted` | Filter by submitted |
| `filter_daily_logs_rejected` | Filter by rejected |
| `create_daily_log` | Open new daily log form |

### Entity Pages
| Action | FE handler |
|--------|------------|
| `view_all_[entity]` | Clear filters |
| `create_[entity]` | Open create form |
| `filter_vehicles_mot_due` | Filter by MOT due |
| `filter_vehicles_service_due` | Filter by service due |

### Other
| Action | FE handler |
|--------|------------|
| `view_all_forms` / `create_form` | Form designer actions |
| `view_all_users` / `invite_user` | User management actions |
| `view_recent_audit` / `filter_audit_action` | Audit page actions |

---

## React Implementation

```typescript
// hooks/useAskAi.ts
import { useState } from 'react';

type AiMessage = {
  role: 'user' | 'assistant';
  content: string;
  highlights?: Array<{ title: string; reason: string; urgency: string; action: string }>;
  tip?: string | null;
  actions?: Array<{ label: string; action: string }>;
};

export function useAskAi() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(false);

  async function ask(query: string, page: string, context?: Record<string, unknown>) {
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setLoading(true);

    try {
      const res = await api.post('/api/v1/ai/ask', { query, page, context });
      const d = res.data.data;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: d.message,
        highlights: d.highlights,
        tip: d.tip,
        actions: d.actions,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  return { messages, loading, ask, reset: () => setMessages([]) };
}
```

```tsx
// components/AskAiModal.tsx
function AskAiModal({ page, getContext, onAction, onClose }) {
  const { messages, loading, ask, reset } = useAskAi();
  const [input, setInput] = useState('');

  const send = () => {
    if (!input.trim() || loading) return;
    ask(input.trim(), page, getContext());
    setInput('');
  };

  return (
    <Modal onClose={onClose}>
      <h2>Ask AI</h2>

      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role}>
            <p>{msg.content}</p>

            {msg.highlights?.length > 0 && (
              <div className="highlights">
                {msg.highlights.map((h, j) => (
                  <div key={j} className={`highlight ${h.urgency}`}>
                    <strong>{h.title}</strong>
                    <span className="badge">{h.urgency}</span>
                    <p className="reason">{h.reason}</p>
                    <p className="action">{h.action}</p>
                  </div>
                ))}
              </div>
            )}

            {msg.tip && <div className="tip">{msg.tip}</div>}

            {msg.actions?.length > 0 && (
              <div className="actions">
                {msg.actions.map((a, j) => (
                  <button key={j} onClick={() => onAction(a.action)}>{a.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="loading">Thinking...</div>}
      </div>

      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
        placeholder="Ask a question..."
        maxLength={1200}
      />
      <footer>
        <button onClick={reset}>New Chat</button>
        <button onClick={onClose}>Close</button>
        <button onClick={send} disabled={loading}>Ask AI</button>
      </footer>
    </Modal>
  );
}
```

```tsx
// Usage on any page
<AskAiModal
  page="tasks"
  getContext={() => ({
    items: visibleTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category,
      dueDate: t.dueDate,
      assignee: t.assigneeName,
      home: t.homeName,
    })),
    filters: activeFilters,
    meta: pagination,
  })}
  onAction={handleAction}
  onClose={() => setShowAi(false)}
/>
```

---

## Rules

1. **Always send `page`** — determines the AI system prompt
2. **Send `context.items` for non-summary pages** — without it the AI has nothing to analyze
3. **Max 25 items, max 10 todos/approvals** — BE truncates beyond this
4. **`context.stats` is optional on summary** — BE fetches from DB if missing (but sending is faster)
5. **Don't render `meta`** — it's for debugging only
6. **Map `action` strings to FE navigation** — the BE doesn't know your routes
7. **`highlights` is empty for casual messages** ("hello", "thanks") — just show the message bubble
8. **`tip` is `null` when there's nothing to flag** — hide the tip banner entirely
