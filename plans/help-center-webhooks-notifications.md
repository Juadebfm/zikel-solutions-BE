# Help Center + Webhooks + Notifications — Implementation Checklist

> Status: **COMPLETE**
> Created: 2026-03-31

---

## Phase 1: Foundation

- [x] **1.1** Add new enums to `prisma/schema.prisma`
  - TicketStatus, TicketPriority, TicketCategory
  - NotificationLevel, NotificationCategory
- [x] **1.2** Add new models to `prisma/schema.prisma`
  - FaqArticle, SupportTicket, TicketComment
  - Notification, NotificationRecipient, NotificationPreference
  - WebhookEndpoint, WebhookDelivery
- [x] **1.3** Add relation fields to existing User and Tenant models
- [x] **1.4** Run Prisma migration (`20260331120000_help_center_notifications_webhooks`)
- [x] **1.5** Create `src/lib/webhook-dispatcher.ts` (generic dispatch, HMAC signing, retry with exponential backoff)
- [x] **1.6** Create `src/lib/notification-emitter.ts` (central `emitNotification()` function with preference filtering)
- [x] **1.7** Register new route prefixes in `src/routes/index.ts`
  - `/help-center`, `/notifications`, `/webhooks`
- [x] **1.8** Add OpenAPI tags: Help Center, Notifications, Webhooks
- [x] **1.9** Verify build passes

---

## Phase 2: Help Center — FAQs

- [x] **2.1** Create `src/modules/help-center/faqs.schema.ts`
  - CreateFaqBodySchema, UpdateFaqBodySchema, ListFaqsQuerySchema
  - JSON schema equivalents for OpenAPI
- [x] **2.2** Create `src/modules/help-center/faqs.service.ts`
  - listFaqs (search, filter by category, pagination)
  - getFaq
  - createFaq (super_admin/admin)
  - updateFaq (super_admin/admin)
  - deleteFaq (soft delete, super_admin/admin)
- [x] **2.3** Create FAQ routes in `src/modules/help-center/help-center.routes.ts`
  - GET /faqs, GET /faqs/:id, POST /faqs, PATCH /faqs/:id, DELETE /faqs/:id
- [x] **2.4** Verify build passes

---

## Phase 3: Help Center — Tickets

- [x] **3.1** Create `src/modules/help-center/tickets.schema.ts`
  - CreateTicketBodySchema, UpdateTicketBodySchema, ListTicketsQuerySchema
  - CreateTicketCommentBodySchema
  - JSON schema equivalents for OpenAPI
- [x] **3.2** Create `src/modules/help-center/tickets.service.ts`
  - createTicket (any authenticated user, fires webhook)
  - listTickets (own tickets or all tenant tickets for admins)
  - getTicket (with comments, filters internal notes for non-admins)
  - updateTicket (status/priority/category — admin, notifies ticket owner)
  - addComment (own ticket or admin, fires webhook, notifies other party)
  - closeTicket (admin, notifies ticket owner)
- [x] **3.3** Add ticket routes to `help-center.routes.ts`
  - POST /tickets, GET /tickets, GET /tickets/:id
  - PATCH /tickets/:id, POST /tickets/:id/comments, DELETE /tickets/:id
- [x] **3.4** Wire ticket events to webhook dispatcher
  - ticket_created, ticket_status_changed, ticket_comment_added
- [x] **3.5** Verify build passes

---

## Phase 4: Notification System

- [x] **4.1** Create `src/modules/notifications/notifications.schema.ts`
  - ListNotificationsQuerySchema (page, pageSize, status, level, category, since)
  - BroadcastNotificationBodySchema (title, body, category, tenantIds?, expiresAt?)
  - UpdatePreferencesBodySchema (array of { category, enabled })
  - JSON schema equivalents for OpenAPI
- [x] **4.2** Create `src/modules/notifications/notifications.service.ts`
  - listNotifications (with `since` for incremental polling, excludes expired)
  - getUnreadCount (lightweight COUNT query)
  - markRead (single)
  - markAllRead
  - getPreferences
  - updatePreferences (batch upsert)
  - broadcastPlatformNotification (super_admin only, to all users or specific tenants)
- [x] **4.3** Create `src/modules/notifications/notifications.routes.ts`
  - GET /notifications, GET /notifications/unread-count
  - POST /notifications/:id/read, POST /notifications/read-all
  - GET /notifications/preferences, PUT /notifications/preferences
  - POST /notifications/broadcast
- [x] **4.4** Verify build passes

---

## Phase 5: Event Wiring (Inter-Tenant Notifications)

- [x] **5.1** Tasks integration
  - `createTask()` → emit `task_assigned` to assignee
  - `runTaskAction('approve')` → emit `task_approved` to creator
  - `runTaskAction('reject')` → emit `task_rejected` to creator
  - `runTaskAction('reassign')` → emit `task_assigned` to new assignee
- [x] **5.2** Employees integration
  - `createEmployee()` → emit `employee_added` to tenant admins
- [x] **5.3** Announcements integration
  - `createAnnouncement()` → emit `announcement_posted` to tenant members
- [x] **5.4** Verify build passes

---

## Phase 6: Webhook Management

- [x] **6.1** Create `src/modules/webhooks/webhooks.schema.ts`
  - CreateWebhookBodySchema (url, secret, events[], description?)
  - UpdateWebhookBodySchema
  - ListWebhookDeliveriesQuerySchema
  - JSON schema equivalents for OpenAPI
- [x] **6.2** Create `src/modules/webhooks/webhooks.service.ts`
  - listWebhookEndpoints (tenant-scoped)
  - createWebhookEndpoint
  - updateWebhookEndpoint
  - deleteWebhookEndpoint
  - listDeliveries (per endpoint, paginated)
  - sendTestPayload
- [x] **6.3** Create `src/modules/webhooks/webhooks.routes.ts`
  - GET /webhooks, POST /webhooks, PATCH /webhooks/:id, DELETE /webhooks/:id
  - GET /webhooks/:id/deliveries, POST /webhooks/:id/test
- [x] **6.4** Verify build passes

---

## Phase 7: Hardening & Final Verification

- [x] **7.1** Retry mechanism with exponential backoff in webhook-dispatcher
  - Attempt 1: immediate, Attempt 2: 1m, Attempt 3: 5m, Attempt 4: 30m, Attempt 5: fail permanently
- [x] **7.2** Full typecheck (`npm run typecheck`) — passes
- [x] **7.3** Lint check (`npm run lint`) — passes
- [x] **7.4** Test suite — 125 passing, 5 pre-existing failures (unrelated to this feature)
- [ ] **7.5** Update README with new endpoints
