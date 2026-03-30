# Form Designer Plan

## 1. What This Feature Does

Form Designer is the configuration surface used to define how operational forms are built, who can access them, who approves them, and how they trigger downstream tasks.

It should support:

- [x] Creating and editing reusable forms
- [x] Assigning forms to one or more domain types (for example `Home`, `Young Person`, `Vehicle`)
- [x] Configuring confidentiality and approval access rules by users or roles
- [x] Building dynamic fields with a drag/drop-style field palette
- [x] Previewing the final form experience before publishing
- [x] Optionally triggering follow-up tasks/forms (configuration saved on form)
- [ ] Enforcing acknowledgement requirements (`no`, `optional`, `mandatory`)

---

## 2. UX Flow (from screenshots)

### Step 1: Details

Main controls:

- [x] `formName` (required)
- [x] `namingConvention` (slug/key; auto-generated but editable)
- [x] `formTypes[]` (multi-select)
- [x] `formGroup`
- [x] `keywords[]`
- [x] `description`
- [x] `instructions`
- [x] `defaultTaskSensitivity` (`sensitive` | `not_sensitive`)
- [x] `status` (`draft` | `released`)
- [x] `isOneOff` (boolean)
- [x] `usableInProcedure` (boolean)
- [x] `hidden` (boolean)
- [x] `requiresAcknowledgement` (`no` | `optional` | `mandatory`)
- [x] `forceDisplayOnTrigger` (boolean)
- [x] `notifications` by users or by roles
- [x] `triggerTask` config
- [x] `triggerTask.followUpFormId`
- [x] `triggerTask.allowUserChooseTriggerTime`
- [x] `triggerTask.alwaysTriggerSameProject`
- [x] `triggerTask.restrictProjectByAssociation`
- [x] `triggerTask.restrictProjectByPermission`
- [x] `triggerTask.allowCopyPreviousTaskData`

### Step 2: Access

Two separate rule sets:

- [x] Confidentiality: who can access this form/task
- [x] Approvers: who can approve submissions

Each set can be configured:

- [x] by users
- [x] by roles
- [ ] dual-list assign/remove interaction

### Step 3: Build

Visual form composer with field palette and ordered field list.

Field palette shown in screenshots includes:

- [x] Layout: `Field Group Heading`, `Multi Step Form Section`, `Table`
- [x] Text: `Numeric Input`, `Single Line Text Input`, `Multi Line Text Input`
- [x] Multi-choice: `True or False`, `Yes or No`, `CheckBox List`, `Dropdown Select List`, `Radio Buttons`, `System List`
- [x] Date/Time: `Date Input`, `Override Date Input`, `Time Input`
- [x] Files/links: `Inline Image`, `Signature Image`, `Image Editor`, `Related Tasks`, `Embed Files`

Per-field controls shown:

- [ ] settings/configure
- [ ] duplicate
- [ ] reorder/sort
- [ ] delete
- [ ] required toggle/check

### Step 4: Preview

- [x] Read-only preview of configured metadata + rendered field form
- [ ] Final `save` action from preview step
- [x] Preview must match runtime submission renderer

---

## 3. Data Model (recommended canonical shape)

```json
{
  "id": "cuid",
  "key": "absence-form",
  "name": "Absence Form",
  "description": "Record unauthorised absences",
  "instructions": "Complete immediately when resident is missing",
  "status": "draft",
  "visibility": "visible",
  "formTypes": ["young_person"],
  "formGroup": "Incidents",
  "keywords": ["absence", "missing", "safeguarding"],
  "defaultTaskSensitivity": "not_sensitive",
  "isOneOff": false,
  "usableInProcedure": true,
  "requiresAcknowledgement": "mandatory",
  "forceDisplayOnTrigger": false,
  "notifications": {
    "mode": "roles",
    "userIds": [],
    "roles": ["tenant_admin", "sub_admin"]
  },
  "access": {
    "confidentialityMode": "roles",
    "confidentialityUserIds": [],
    "confidentialityRoles": ["staff", "manager"],
    "approverMode": "users",
    "approverUserIds": ["user_1", "user_2"],
    "approverRoles": []
  },
  "triggerTask": {
    "enabled": true,
    "followUpFormId": "form_2",
    "allowUserChooseTriggerTime": false,
    "alwaysTriggerSameProject": true,
    "restrictProjectByAssociation": true,
    "restrictProjectByPermission": true,
    "allowCopyPreviousTaskData": true
  },
  "builder": {
    "version": 1,
    "sections": [],
    "fields": []
  },
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

---

## 4. Endpoints To Use Right Now (already in BE)

These endpoints exist today and can support parts of this flow:

### Uploads (for signature/images/files used by form builder and submissions)

- [x] `POST /api/v1/uploads/sessions`
- [x] `POST /api/v1/uploads/:id/complete`
- [x] `GET /api/v1/uploads/:id/download-url`

### Tasks (runtime execution storage for submitted forms/tasks)

- [x] `GET /api/v1/tasks`
- [x] `GET /api/v1/tasks/:id`
- [x] `POST /api/v1/tasks`
- [x] `PATCH /api/v1/tasks/:id`
- [x] `DELETE /api/v1/tasks/:id`

Useful fields already supported:

- [x] `formTemplateKey`
- [x] `formName`
- [x] `formGroup`
- [x] `submissionPayload`
- [x] `references[]` (entity/upload/internal/external/document links)
- [x] `signatureFileId`

### Approvals/Acknowledgements

- [x] `GET /api/v1/summary/tasks-to-approve`
- [x] `GET /api/v1/summary/tasks-to-approve/:id`
- [x] `POST /api/v1/summary/tasks-to-approve/:id/review-events`
- [x] `POST /api/v1/summary/tasks-to-approve/:id/approve`
- [x] `POST /api/v1/summary/tasks-to-approve/process-batch`

### Source lists for Access step

- [x] `GET /api/v1/employees` (user list for assignment/access UI)
- [x] `GET /api/v1/tenants/:id/memberships` (role + membership context)

---

## 5. Missing Endpoints Needed For Full Form Designer

There is currently **no dedicated `/forms` API module** exposed, even though `FormTemplate` exists in the database.

Recommended endpoints:

### Catalog & metadata

- [x] `GET /api/v1/forms/metadata` (returns available form types, groups, field palette, role options, status options)
- [x] `GET /api/v1/forms` (filters: `type`, `group`, `status`, `search`, `page`, `pageSize`)
- [x] `GET /api/v1/forms/:id`

### Authoring lifecycle

- [x] `POST /api/v1/forms`
- [x] `PATCH /api/v1/forms/:id`
- [x] `POST /api/v1/forms/:id/clone`
- [x] `POST /api/v1/forms/:id/publish`
- [x] `POST /api/v1/forms/:id/archive`

### Build/preview

- [x] `PATCH /api/v1/forms/:id/builder` (save field layout/schema incrementally)
- [x] `POST /api/v1/forms/:id/preview` (server-side validate + render contract)

### Access rules

- [x] `PATCH /api/v1/forms/:id/access` (confidentiality users/roles + approver users/roles)

### Trigger config

- [x] `PATCH /api/v1/forms/:id/trigger`

### Runtime submission

- [x] `POST /api/v1/forms/:id/submissions` (stores submission payload and creates/updates linked task workflow as configured)

---

## 6. UX Upgrade Recommendations

To make this significantly better than the legacy flow:

- [ ] Replace long dropdowns with searchable grouped pickers + recent selections
- [ ] Show live validation panel (missing required controls, access gaps, invalid trigger loops)
- [ ] Autosave draft every few seconds in Build step
- [ ] Add version history with compare/restore before publish
- [ ] Add reusable field blocks/templates (for repeated incident/contact sections)
- [ ] Provide role and user count chips in Access step so scope is obvious
- [ ] Add “test submission” mode in Preview to verify conditional logic and trigger behavior
- [ ] Add warning when publishing a form that will immediately gate access/acknowledgement

---

## 7. Build Order Decision (Form Designer vs Task Plan)

### Recommendation

- [ ] Implement **Form Designer first**, then Task Plan.

Reason:

- Task Plan depends on a canonical form catalog, trigger behavior, access rules, and acknowledgement settings.
- If Task Plan is implemented first, we will likely rework task payload contracts once Form Designer is introduced.

### If we need a fast interim path

- [ ] Keep using `POST /api/v1/tasks` with `formTemplateKey/formName/formGroup/submissionPayload`
- [ ] Treat it as transitional only
- [ ] Migrate to dedicated `/forms` endpoints

---

## 8. Notes

- This plan is aligned with the full screenshots shared for Details, Access, Build, and Preview.
- Existing DB support (`FormTemplate`) is present, but API surface is incomplete.
- This document is intentionally non-legacy and aligned with current product direction.
