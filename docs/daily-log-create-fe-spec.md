# Create Daily Log — FE Implementation Spec

> **Last updated:** 2026-04-05 — matches deployed BE.

## 3 Changes Required

1. **"Relates To" supports 4 entity types** — not just Young Person
2. **"Trigger Task" auto-loads form fields** when a template is selected
3. **Dynamic placeholder text** on the note textarea based on selected category

---

## 1. "Relates To" — Multi-Entity Picker

### What changed on the BE

`relatesTo.type` now accepts: `young_person`, `vehicle`, `employee`, `home_event`

### How the FE should implement

**Step 1: Show an entity type selector first**

```
┌─ Relates To ────────────────────────────┐
│  [Young Person ▾]  [Ava Morris ▾]       │
└─────────────────────────────────────────┘
```

The first dropdown picks the entity type. The second dropdown loads the relevant entities.

**Step 2: Fetch entities based on type**

| Type selected | API call | Display field |
|---|---|---|
| Young Person | `GET /api/v1/young-people?homeId={homeId}&pageSize=100` | `firstName lastName` |
| Vehicle | `GET /api/v1/vehicles?homeId={homeId}&pageSize=100` | `make model — registration` |
| Employee | `GET /api/v1/employees?homeId={homeId}&pageSize=100` | `user.firstName user.lastName` |
| Event | `GET /api/v1/calendar/events?homeId={homeId}&pageSize=100` | `title` |

Filter by the selected `homeId` — a daily log must select a home first, so use that to scope the entity list.

**Step 3: Build the request body**

```typescript
// If user picked "Employee" → "Kemi Adeyemi" (id: "clx_emp_123")
relatesTo: {
  type: "employee",
  id: "clx_emp_123"
}

// If user picked "None" or cleared the selection
relatesTo: null
```

### Entity type labels for the dropdown

| Value | Label |
|---|---|
| `young_person` | Young Person |
| `vehicle` | Vehicle |
| `employee` | Staff Member |
| `home_event` | Event |

### "None" option

Always include a "None" option at the top that clears `relatesTo`. The field is optional.

---

## 2. "Trigger Task" — Auto-Load Form Fields

When the user selects a form template from the "Trigger Task" dropdown, the FE should fetch that template's schema and render its fields dynamically.

### Step 1: Populate the dropdown

The dropdown already loads form templates. The template list comes from:

```
GET /api/v1/forms?pageSize=100&isActive=true
```

Each template has: `id`, `key`, `name`, `group`

Display: `name` (e.g. "Medication Error Follow-up")
Send: `key` as `triggerTaskFormKey` (e.g. "medication_error_follow_up")

### Step 2: When a template is selected, fetch its schema

```
GET /api/v1/forms/{id}
```

Response includes `schemaJson` with this structure:

```typescript
{
  schemaJson: {
    version: 1,
    renderer: "dynamic",
    sections: [
      { id: "sec-general", key: "general", title: "General", order: 0 },
      { id: "sec-details", key: "details", title: "Details", order: 1 },
      { id: "sec-sign_off", key: "sign_off", title: "Sign-off", order: 2 },
    ],
    fields: [
      {
        id: "f-date",
        key: "date",
        type: "date_input",
        label: "Date",
        section: "sec-general",
        required: true,
        placeholder: "Select date"
      },
      {
        id: "f-incident-type",
        key: "incident_type",
        type: "dropdown_select_list",
        label: "Incident Type",
        section: "sec-general",
        required: true,
        options: ["Physical", "Verbal", "Self-harm", "Abscond", "Property damage", "Other"]
      },
      // ... more fields
    ],
    designer: { ... }  // Metadata — not needed for rendering fields
  }
}
```

### Step 3: Render form fields below the trigger task dropdown

Group fields by `section`. For each field, render the appropriate input based on `type`:

| `field.type` | Render as |
|---|---|
| `date_input` | Date picker |
| `time_input` | Time picker |
| `single_line_text_input` | `<input type="text">` |
| `multi_line_text_input` | `<textarea>` |
| `numeric_input` | `<input type="number">` |
| `dropdown_select_list` | `<select>` with `field.options` |
| `radio_buttons` | Radio button group with `field.options` |
| `yes_or_no` | Toggle or Yes/No radio |
| `checkbox_list` | Checkbox group with `field.options` |
| `signature_image` | Signature pad component |
| `embed_files` | File upload |
| `system_list` | Entity selector (like "Relates To" picker) |
| `currency` | Currency input |
| `table` | Table input |

### Step 4: Include field values in submissionPayload

When the form is submitted, collect all trigger task field values and include them in the request:

```typescript
{
  homeId: "clx...",
  noteDate: "2026-04-05T12:36:00.000Z",
  category: "Medication",
  note: "The medication was...",
  triggerTaskFormKey: "medication_error_follow_up",   // The template key
  relatesTo: { type: "young_person", id: "clx..." },
  // The form field values go in the parent task's submissionPayload
  // via the tasks API — the daily log service handles this mapping
}
```

The trigger task form data gets stored automatically in the task's `submissionPayload` via the `formTemplateKey` association.

### Step 5: When "None" is selected

If the user selects "None" for Trigger Task, hide all dynamic form fields and send `triggerTaskFormKey: undefined` (or omit it).

---

## 3. Dynamic Placeholder Text

The "Daily Log" textarea placeholder should change based on the selected category.

### Category → Placeholder Mapping

| Category | Placeholder |
|---|---|
| **General** | `What happened during this shift? Note any key observations, activities, or conversations.` |
| **Incident** | `What happened? When and where did it occur? Who was involved? What immediate actions were taken? Were any injuries sustained?` |
| **Medication** | `Which medication was involved? Was it administered, refused, or an error? What was the dosage? What follow-up actions were taken?` |
| **Behaviour** | `What behaviour was observed? What might the child have been communicating? How did you respond with empathy? What de-escalation was used?` |
| **Education** | `What educational activities took place? How did the young person engage? Any achievements, concerns, or follow-up needed?` |
| **Personal Care** | `What personal care was provided or supported? How did the young person respond? Any dignity or preference considerations?` |
| **Contact** | `Who was the contact with (family, social worker, professional)? What was discussed? Were any decisions or actions agreed?` |
| **Safeguarding** | `What safeguarding concern was identified? What did you observe? Who was informed? What immediate protective actions were taken? Note: do not include names of other children.` |

### Implementation

```tsx
const CATEGORY_PLACEHOLDERS: Record<string, string> = {
  General:
    'What happened during this shift? Note any key observations, activities, or conversations.',
  Incident:
    'What happened? When and where did it occur? Who was involved? What immediate actions were taken? Were any injuries sustained?',
  Medication:
    'Which medication was involved? Was it administered, refused, or an error? What was the dosage? What follow-up actions were taken?',
  Behaviour:
    'What behaviour was observed? What might the child have been communicating? How did you respond with empathy? What de-escalation was used?',
  Education:
    'What educational activities took place? How did the young person engage? Any achievements, concerns, or follow-up needed?',
  'Personal Care':
    'What personal care was provided or supported? How did the young person respond? Any dignity or preference considerations?',
  Contact:
    'Who was the contact with (family, social worker, professional)? What was discussed? Were any decisions or actions agreed?',
  Safeguarding:
    'What safeguarding concern was identified? What did you observe? Who was informed? What immediate protective actions were taken? Note: do not include names of other children.',
};

const DEFAULT_PLACEHOLDER =
  'What did you observe? What might the child have been communicating? How did you respond with empathy?';

// In the component:
<textarea
  placeholder={CATEGORY_PLACEHOLDERS[selectedCategory] ?? DEFAULT_PLACEHOLDER}
  value={note}
  onChange={e => setNote(e.target.value)}
  maxLength={10000}
/>
```

---

## Full Create Daily Log Request

```typescript
// POST /api/v1/daily-logs
{
  homeId: "clx_home_id",                              // Required
  relatesTo: {                                         // Optional
    type: "young_person",                              // or "vehicle", "employee", "home_event"
    id: "clx_entity_id"
  },
  noteDate: "2026-04-05T12:36:00.000Z",              // Required — ISO datetime
  category: "Medication",                              // Required — one of the 8 categories
  triggerTaskFormKey: "medication_error_follow_up",    // Optional — form template key
  note: "Medication was refused at 14:00...",          // Required — 1-10000 chars
}
```

### Response (201)

```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "title": "Daily Log — Oakview House — 05 Apr 2026",
    "description": "Medication was refused at 14:00...",
    "status": "pending",
    "approvalStatus": "not_required",
    "category": "daily_log",
    "priority": "medium",
    "dueDate": null,
    "homeId": "clx_home_id",
    "youngPersonId": "clx_entity_id",
    "vehicleId": null,
    "formTemplateKey": "medication_error_follow_up",
    "submissionPayload": {
      "dailyLogCategory": "Medication",
      "noteDate": "2026-04-05T12:36:00.000Z",
      "relatesTo": { "type": "young_person", "id": "clx_entity_id" }
    },
    "submittedAt": "2026-04-05T12:36:00.000Z",
    "createdAt": "2026-04-05T12:36:00.000Z",
    "updatedAt": "2026-04-05T12:36:00.000Z"
  }
}
```

---

## Daily Log Categories

These are the 8 supported categories. Send as the `category` field value:

```typescript
const DAILY_LOG_CATEGORIES = [
  'General',
  'Incident',
  'Medication',
  'Behaviour',
  'Education',
  'Personal Care',
  'Contact',
  'Safeguarding',
] as const;
```

---

## UI Flow Summary

```
1. User clicks "+ Create Log"
2. Modal opens with:
   - Home dropdown (required) ← populated from GET /api/v1/homes
   - Relates To: [Entity Type ▾] [Entity ▾] ← type picker + entity picker
   - Date & Time picker (required) ← defaults to now
   - Category dropdown (required) ← the 8 categories above
   - Trigger Task: [Form Template ▾] ← from GET /api/v1/forms
     └─ If template selected: render dynamic fields from schemaJson
   - Daily Log textarea (required) ← placeholder changes with category
3. User fills in and clicks "Create Log"
4. FE sends POST /api/v1/daily-logs
5. On success: close modal, refresh list, show toast
```
