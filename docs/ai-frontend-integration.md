# AI Assistant — Frontend Integration Guide

## Overview

The AI assistant is a **page-aware chatbot** that lives in a modal/drawer. It knows which page the user is on and tailors its responses accordingly. The BE handles all the intelligence — scoring priorities, detecting risks, building suggestions. The FE just needs to:

1. Send the right context for the current page
2. Render the clean response

---

## Endpoint

```
POST /api/v1/ai/ask
Authorization: Bearer <access_token>
```

Rate limit: **20 requests per minute** per user.

---

## Request Shape

```typescript
type AskAiRequest = {
  query: string;           // The user's message (3–1200 chars)
  page: AiPage;            // Which page the AI modal is open on
  displayMode?: 'auto' | 'standard' | 'minimal';  // Optional, defaults to 'auto'
  context?: {              // Page-specific context (see below)
    stats?: SummaryStats;
    todos?: SummaryItem[];
    tasksToApprove?: SummaryItem[];
    items?: PageItem[];
    filters?: Record<string, string>;
    meta?: PaginationMeta;
  };
};
```

### Supported Pages

```typescript
type AiPage =
  | 'summary'        // Dashboard / My Summary
  | 'tasks'          // Task Explorer
  | 'daily_logs'     // Daily Logs
  | 'care_groups'    // Care Groups
  | 'homes'          // Homes
  | 'young_people'   // Young People
  | 'employees'      // Employees
  | 'vehicles'       // Vehicles
  | 'form_designer'  // Form Designer
  | 'users'          // Users / Team
  | 'audit';         // Audit Log
```

---

## Response Shape

```typescript
type AskAiResponse = {
  success: true;
  data: {
    message: string;        // AI chat message — render as a chat bubble
    highlights: Highlight[]; // Priority cards (empty for casual messages)
    tip: string | null;      // Single insight/warning (null = don't show)
    actions: Action[];       // Quick-action buttons
    source: 'model' | 'fallback';
    generatedAt: string;     // ISO datetime
    meta: {                  // Debug only — DO NOT render
      model: string | null;
      page: string;
      strengthProfile: 'owner' | 'admin' | 'staff';
      responseMode: 'comprehensive' | 'balanced' | 'focused';
      statsSource: 'client' | 'server' | 'none';
      languageSafetyPassed: boolean;
    };
  };
};

type Highlight = {
  title: string;            // e.g. "Restraint Log Review — Physical Intervention"
  reason: string;           // e.g. "Overdue, high priority"
  urgency: 'low' | 'medium' | 'high' | 'critical';
  action: string;           // e.g. "Triage immediately and assign clear ownership now."
};

type Action = {
  label: string;            // Button text, e.g. "Review overdue tasks"
  action: string;           // Action key, e.g. "open_summary_todos_overdue"
};
```

---

## How to Render

```
┌──────────────────────────────────────────────┐
│  🤖 AI Assistant                          ✕  │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ USER: "What should I focus on?"      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ AI: "Focus on the Restraint Log      │    │
│  │ Review first — it's overdue and..."  │    │  ← data.message
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌─ HIGHLIGHTS ─────────────────────────┐    │
│  │ ⚠ Restraint Log Review    CRITICAL   │    │  ← data.highlights[]
│  │   Overdue, high priority             │    │
│  │   → Triage immediately              │    │
│  ├──────────────────────────────────────┤    │
│  │ ⚠ Vehicle Safety Inspect. CRITICAL   │    │
│  │   Marked high priority               │    │
│  │   → Triage immediately              │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌─ TIP ────────────────────────────────┐    │
│  │ 💡 Some items have no assignee —     │    │  ← data.tip (hide if null)
│  │    consider assigning this shift.    │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  [Review overdue] [Open approvals] [Due today] ← data.actions[]
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ Ask a question...                    │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### Rendering Rules

| Field | Render as | When to show |
|-------|-----------|--------------|
| `message` | Chat bubble | Always |
| `highlights` | Priority cards with urgency badge | When array is non-empty |
| `tip` | Info/warning banner | When not `null` |
| `actions` | Buttons at bottom of response | When array is non-empty |
| `meta` | **Never render** | Only for console.log/debugging |

### Urgency Badge Colors

| `urgency` | Color | Meaning |
|-----------|-------|---------|
| `critical` | Red | Overdue + high priority — act now |
| `high` | Orange | Due soon or rejected — act this shift |
| `medium` | Yellow | Needs attention today |
| `low` | Grey | Can wait, schedule for later |

---

## Page-by-Page Context Guide

### Summary Page (`page: 'summary'`)

**What to send:** The stats cards + to-do list + pending approvals visible on screen.

```typescript
const response = await fetch('/api/v1/ai/ask', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: userMessage,
    page: 'summary',
    context: {
      // Stats from the dashboard cards (optional — BE will fetch if not sent)
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
      // First 10 items from the To-Do List
      todos: [
        { title: 'South Home Daily Task 8', status: 'pending', priority: 'medium', dueDate: '2026-04-03' },
        { title: 'Night Fire Drill Report', status: 'pending', priority: 'high', dueDate: '2026-04-05' },
      ],
      // First 10 items from Pending Sign-Off
      tasksToApprove: [
        { title: 'Restraint Log Review — Physical Intervention', status: 'pending_approval', priority: 'high', dueDate: '2026-04-04' },
      ],
    },
  }),
});
```

**What the BE does:** Fetches a full platform snapshot (homes count, employees, open tasks, etc.) and combines it with your stats/todos. The AI gets a complete picture even if you only send partial data.

**If you send no context:** The BE fetches stats from the server. It works, but is slower.

---

### Tasks Page (`page: 'tasks'`)

**What to send:** The currently visible task rows + active filters.

```typescript
{
  query: "Which tasks need attention first?",
  page: "tasks",
  context: {
    items: taskRows.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,          // "pending", "in_progress", "completed"
      priority: task.priority,      // "low", "medium", "high", "urgent"
      category: task.category,      // "task_log", "incident", "daily_log", etc.
      dueDate: task.dueDate,        // ISO string or null
      assignee: task.assigneeName,  // Display name or null
      home: task.homeName,          // Home name or null
    })).slice(0, 25),
    filters: {
      status: "pending",
      priority: "high",
      homeId: "abc123",
    },
    meta: {
      total: pagination.total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: pagination.totalPages,
    },
  },
}
```

---

### Daily Logs Page (`page: 'daily_logs'`)

Same as tasks — daily logs are tasks with `category: 'daily_log'`.

```typescript
{
  query: "Any gaps in today's logs?",
  page: "daily_logs",
  context: {
    items: logs.map(log => ({
      id: log.id,
      title: log.title,
      status: log.approvalStatus,    // "pending_approval", "approved", "rejected"
      category: log.logCategory,     // "General", "Incident", "Medication", etc.
      dueDate: log.createdAt,
      assignee: log.submittedByName,
      home: log.homeName,
    })).slice(0, 25),
    filters: currentFilters,
    meta: paginationMeta,
  },
}
```

---

### Homes Page (`page: 'homes'`)

```typescript
{
  query: "Which homes are near capacity?",
  page: "homes",
  context: {
    items: homes.map(home => ({
      id: home.id,
      title: home.name,
      status: home.status,           // "current", "inactive"
      extra: {
        capacity: String(home.capacity),
        region: home.region ?? '',
        careGroup: home.careGroupName ?? '',
        youngPeopleCount: String(home.youngPeopleCount ?? 0),
      },
    })).slice(0, 25),
    filters: currentFilters,
    meta: paginationMeta,
  },
}
```

---

### Young People Page (`page: 'young_people'`)

```typescript
{
  query: "Any placement reviews due soon?",
  page: "young_people",
  context: {
    items: youngPeople.map(yp => ({
      id: yp.id,
      title: `${yp.firstName} ${yp.lastName}`,
      status: yp.status,             // "current", "discharged"
      home: yp.homeName,
      extra: {
        referenceNo: yp.referenceNo,
        keyWorker: yp.keyWorkerName ?? '',
        admissionDate: yp.admissionDate ?? '',
      },
    })).slice(0, 25),
    filters: currentFilters,
    meta: paginationMeta,
  },
}
```

---

### Employees Page (`page: 'employees'`)

```typescript
{
  query: "Who has expiring DBS checks?",
  page: "employees",
  context: {
    items: employees.map(emp => ({
      id: emp.id,
      title: `${emp.user.firstName} ${emp.user.lastName}`,
      status: emp.status,             // "current", "inactive"
      home: emp.homeName,
      extra: {
        role: emp.roleName ?? '',
        jobTitle: emp.jobTitle ?? '',
        contractType: emp.contractType ?? '',
        dbsDate: emp.dbsDate ?? '',
      },
    })).slice(0, 25),
    filters: currentFilters,
    meta: paginationMeta,
  },
}
```

---

### Vehicles Page (`page: 'vehicles'`)

```typescript
{
  query: "Any MOTs due this month?",
  page: "vehicles",
  context: {
    items: vehicles.map(v => ({
      id: v.id,
      title: `${v.make} ${v.model} — ${v.registration}`,
      status: v.status,
      home: v.homeName,
      extra: {
        motDue: v.motDue ?? '',
        nextServiceDue: v.nextServiceDue ?? '',
        insuranceDate: v.insuranceDate ?? '',
        fuelType: v.fuelType ?? '',
      },
    })).slice(0, 25),
    filters: currentFilters,
    meta: paginationMeta,
  },
}
```

---

### Care Groups Page (`page: 'care_groups'`)

```typescript
{
  query: "How are groups structured?",
  page: "care_groups",
  context: {
    items: groups.map(g => ({
      id: g.id,
      title: g.name,
      status: g.isActive ? 'active' : 'inactive',
      extra: {
        homesCount: String(g.homesCount ?? 0),
        description: g.description ?? '',
      },
    })).slice(0, 25),
  },
}
```

---

### Form Designer Page (`page: 'form_designer'`)

```typescript
{
  query: "What forms do we have for incidents?",
  page: "form_designer",
  context: {
    items: templates.map(t => ({
      id: t.id,
      title: t.name,
      status: t.isActive ? 'active' : 'inactive',
      category: t.group ?? '',
      extra: {
        key: t.key,
        description: t.description ?? '',
      },
    })).slice(0, 25),
    filters: currentFilters,
  },
}
```

---

### Audit Page (`page: 'audit'`)

```typescript
{
  query: "Any suspicious login activity?",
  page: "audit",
  context: {
    items: auditLogs.map(log => ({
      id: log.id,
      title: `${log.action} — ${log.entityType ?? 'system'}`,
      type: log.action,               // "login", "record_updated", etc.
      extra: {
        userId: log.userId ?? '',
        entityId: log.entityId ?? '',
        ipAddress: log.ipAddress ?? '',
        timestamp: log.createdAt,
      },
    })).slice(0, 25),
    filters: currentFilters,
    meta: paginationMeta,
  },
}
```

---

### Users Page (`page: 'users'`)

```typescript
{
  query: "Which users haven't logged in recently?",
  page: "users",
  context: {
    items: users.map(u => ({
      id: u.id,
      title: `${u.firstName} ${u.lastName}`,
      status: u.isActive ? 'active' : 'inactive',
      extra: {
        email: u.email,
        role: u.role,
        lastLoginAt: u.lastLoginAt ?? '',
      },
    })).slice(0, 25),
    filters: currentFilters,
  },
}
```

---

## Action Key Reference

The FE maps `action` strings from the response to navigation or filter actions:

### Summary Page Actions
| Action Key | FE Handler |
|-----------|------------|
| `open_summary_todos_overdue` | Navigate to tasks page, filter: overdue |
| `open_summary_pending_approvals` | Navigate to pending approvals |
| `open_summary_todos_due_today` | Navigate to tasks page, filter: due today |
| `open_summary_todos_all` | Navigate to tasks page |

### Tasks Page Actions
| Action Key | FE Handler |
|-----------|------------|
| `filter_tasks_overdue` | Apply overdue filter |
| `filter_tasks_pending_approval` | Apply pending approval filter |
| `create_task` | Open new task form |

### Daily Logs Actions
| Action Key | FE Handler |
|-----------|------------|
| `filter_daily_logs_submitted` | Filter by submitted status |
| `filter_daily_logs_rejected` | Filter by rejected status |
| `create_daily_log` | Open new daily log form |

### Entity Pages (Homes, Employees, Young People, Vehicles)
| Action Key | FE Handler |
|-----------|------------|
| `view_all_[entity]` | Clear filters, show all |
| `create_[entity]` | Open create form |
| `filter_vehicles_mot_due` | Filter vehicles by MOT due |
| `filter_vehicles_service_due` | Filter vehicles by service due |

### Other Pages
| Action Key | FE Handler |
|-----------|------------|
| `view_all_forms` / `create_form` | Form designer navigation |
| `view_all_users` / `invite_user` | User management navigation |
| `view_recent_audit` / `filter_audit_action` | Audit page navigation |

### Dynamic Actions (from highlights)
| Pattern | FE Handler |
|---------|------------|
| `explore_[page]_overdue_cluster` | Filter current page to overdue items |
| `explore_[page]_unassigned_items` | Filter to items without assignees |
| `explore_[page]_[theme]_trend` | Filter by the named theme (e.g. medication) |
| `explore_[page]_top_priority_evidence` | Navigate to the top priority item detail |

---

## Minimal FE Implementation

```typescript
// hooks/useAskAi.ts
import { useState } from 'react';

type AiMessage = {
  role: 'user' | 'assistant';
  content: string;
  highlights?: Highlight[];
  tip?: string | null;
  actions?: Action[];
};

export function useAskAi() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(false);

  async function ask(query: string, page: AiPage, context?: AiContext) {
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setLoading(true);

    try {
      const res = await api.post('/api/v1/ai/ask', { query, page, context });
      const data = res.data.data;

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message,
        highlights: data.highlights,
        tip: data.tip,
        actions: data.actions,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMessages([]);
  }

  return { messages, loading, ask, reset };
}
```

```tsx
// components/AskAiModal.tsx
function AskAiModal({ page, getPageContext, onAction }) {
  const { messages, loading, ask, reset } = useAskAi();
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    const context = getPageContext(); // Each page provides its own context builder
    ask(input.trim(), page, context);
    setInput('');
  };

  return (
    <Modal>
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {/* Chat bubble */}
            <p>{msg.content}</p>

            {/* Highlight cards */}
            {msg.highlights?.length > 0 && (
              <div className="highlights">
                {msg.highlights.map((h, j) => (
                  <HighlightCard key={j} {...h} />
                ))}
              </div>
            )}

            {/* Tip banner */}
            {msg.tip && <TipBanner text={msg.tip} />}

            {/* Action buttons */}
            {msg.actions?.length > 0 && (
              <div className="actions">
                {msg.actions.map((a, j) => (
                  <button key={j} onClick={() => onAction(a.action)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
        placeholder="Ask a question..."
        maxLength={1200}
      />
      <div className="footer">
        <button onClick={reset}>New Chat</button>
        <button onClick={handleSend} disabled={loading}>Ask AI</button>
      </div>
    </Modal>
  );
}
```

```tsx
// Usage on any page — just pass the page name and context builder
<AskAiModal
  page="tasks"
  getPageContext={() => ({
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
  onAction={handleAiAction}
/>
```

---

## Key Rules

1. **Always send `page`** — it determines which system prompt the AI uses
2. **Send `context.items` for non-summary pages** — without it the AI has no data and gives generic answers
3. **Max 25 items** in `context.items` — the BE truncates beyond this
4. **Max 10 items** in `todos` and `tasksToApprove`
5. **`context.stats` is optional on summary** — the BE will fetch from DB if you don't send it (but sending it is faster)
6. **Don't render `meta`** — it's for debugging only
7. **Map `action` strings to FE navigation** — the BE doesn't know your routes
8. **The `highlights` array is empty for casual messages** like "hello" — just show the message bubble
