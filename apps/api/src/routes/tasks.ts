import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'
import { enqueueTaskReminder, cancelTaskReminder } from '../workers/task-reminder-worker.js'

const router = Router()

// ── GET /api/tasks ───────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const contactId = typeof req.query['contact_id'] === 'string' ? req.query['contact_id'] : null
  const completed = req.query['completed'] === 'true'
  const dueBefore = typeof req.query['due_before'] === 'string' ? req.query['due_before'] : null
  const dueAfter = typeof req.query['due_after'] === 'string' ? req.query['due_after'] : null
  const assignedTo = req.query['assigned_to'] === 'me' ? authed.userId : null

  let query = supabase
    .from('tasks')
    .select(
      'id, tenant_id, contact_id, title, due_date, assigned_to_user_id, completed_at, status, priority, parent_task_id, depends_on_task_id, created_by_user_id, created_at, updated_at, contacts(full_name), assigned:users!tasks_assigned_to_user_id_fkey(full_name)'
    )
    .eq('tenant_id', authed.tenantId)

  if (contactId) query = query.eq('contact_id', contactId)
  if (completed) {
    query = query.not('completed_at', 'is', null)
  } else {
    query = query.is('completed_at', null)
  }
  if (dueBefore) query = query.lte('due_date', dueBefore)
  if (dueAfter) query = query.gte('due_date', dueAfter)
  if (assignedTo) query = query.eq('assigned_to_user_id', assignedTo)

  query = query.order('due_date', { ascending: true, nullsFirst: false })

  const { data, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ tasks: data ?? [] })
})

// ── POST /api/tasks ──────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const title = typeof b['title'] === 'string' ? b['title'].trim() : ''
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const priority = typeof b['priority'] === 'string' ? b['priority'] : 'medium'
  if (!['low', 'medium', 'high'].includes(priority)) {
    res.status(400).json({ error: 'priority must be low, medium, or high' })
    return
  }

  const dueDateStr = typeof b['due_date'] === 'string' ? b['due_date'] : null
  let dueDate: Date | null = null
  if (dueDateStr) {
    dueDate = new Date(dueDateStr)
    if (isNaN(dueDate.getTime())) {
      res.status(400).json({ error: 'invalid due_date' })
      return
    }
  }

  const contactId = typeof b['contact_id'] === 'string' ? b['contact_id'] || null : null
  const assignedToUserId =
    typeof b['assigned_to_user_id'] === 'string' ? b['assigned_to_user_id'] || null : null

  // FK-01: body-supplied foreign keys must belong to the caller's tenant.
  if (contactId) {
    const { data: contactCheck } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()
    if (!contactCheck) {
      res.status(400).json({ error: 'Invalid contact_id' })
      return
    }
  }
  if (assignedToUserId) {
    const { data: userCheck } = await supabase
      .from('users')
      .select('id')
      .eq('id', assignedToUserId)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()
    if (!userCheck) {
      res.status(400).json({ error: 'Invalid assigned_to_user_id' })
      return
    }
  }

  const parentTaskId = typeof b['parent_task_id'] === 'string' ? b['parent_task_id'] || null : null
  const dependsOnTaskId =
    typeof b['depends_on_task_id'] === 'string' ? b['depends_on_task_id'] || null : null
  for (const [field, value] of [
    ['parent_task_id', parentTaskId],
    ['depends_on_task_id', dependsOnTaskId],
  ] as const) {
    if (!value) continue
    const { data: taskCheck } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', value)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()
    if (!taskCheck) {
      res.status(400).json({ error: `Invalid ${field}` })
      return
    }
  }

  const insertPayload = {
    tenant_id: authed.tenantId,
    contact_id: contactId,
    title,
    due_date: dueDate?.toISOString() ?? null,
    assigned_to_user_id: assignedToUserId,
    priority,
    parent_task_id: parentTaskId,
    depends_on_task_id: dependsOnTaskId,
    created_by_user_id: authed.userId || null,
  }

  const { data: task, error } = await supabase.from('tasks').insert(insertPayload).select().single()

  if (error || !task) {
    res.status(500).json({ error: error?.message ?? 'Failed to create task' })
    return
  }

  // Enqueue BullMQ reminder if due_date provided
  if (dueDate) {
    try {
      const jobId = await enqueueTaskReminder(
        {
          taskId: task.id,
          tenantId: authed.tenantId,
          contactId: contactId ?? undefined,
          title,
          assignedUserId: assignedToUserId ?? undefined,
        },
        dueDate
      )
      if (jobId) {
        await supabase.from('tasks').update({ reminder_job_id: jobId }).eq('id', task.id)
        task.reminder_job_id = jobId
      }
    } catch (err) {
      console.error(
        '[tasks] failed to enqueue reminder — is REDIS_URL set?',
        err instanceof Error ? err.message : err
      )
    }
  }

  // Log activity if contact-linked
  if (contactId) {
    void logActivity({
      tenantId: authed.tenantId,
      contactId,
      type: 'task',
      body: `Task created: "${title}"`,
      metadata: { task_id: task.id, priority },
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.status(201).json(task)
})

// ── PUT /api/tasks/:id ───────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Task not found' })
    return
  }

  const updates: Record<string, unknown> = {}

  if (typeof b['title'] === 'string') updates['title'] = b['title'].trim()
  if (typeof b['contact_id'] === 'string') updates['contact_id'] = b['contact_id']
  if (b['contact_id'] === null) updates['contact_id'] = null
  if (typeof b['priority'] === 'string' && ['low', 'medium', 'high'].includes(b['priority'])) {
    updates['priority'] = b['priority']
  }
  if (typeof b['assigned_to_user_id'] === 'string')
    updates['assigned_to_user_id'] = b['assigned_to_user_id']
  if (b['assigned_to_user_id'] === null) updates['assigned_to_user_id'] = null

  // Handle due_date change
  let newDueDate: Date | null = null
  if (typeof b['due_date'] === 'string') {
    newDueDate = new Date(b['due_date'])
    if (isNaN(newDueDate.getTime())) {
      res.status(400).json({ error: 'invalid due_date' })
      return
    }
    updates['due_date'] = newDueDate.toISOString()
  } else if (b['due_date'] === null) {
    updates['due_date'] = null
  }

  // Handle completion — status is a cosmetic kanban-column mirror of
  // completed_at, which stays the single source of truth the dependency
  // check below reads from.
  const explicitStatus =
    typeof b['status'] === 'string' && ['open', 'in_progress', 'done'].includes(b['status'])
      ? (b['status'] as 'open' | 'in_progress' | 'done')
      : null

  const isCompleting =
    (typeof b['completed_at'] === 'string' && !existing.completed_at) ||
    (explicitStatus === 'done' && !existing.completed_at)

  if (isCompleting && existing.depends_on_task_id) {
    const { data: blocker } = await supabase
      .from('tasks')
      .select('title, completed_at')
      .eq('id', existing.depends_on_task_id)
      .maybeSingle()
    if (blocker && !blocker.completed_at) {
      res.status(409).json({
        error: `Blocked by an incomplete task: "${blocker.title as string}"`,
      })
      return
    }
  }

  if (typeof b['completed_at'] === 'string') {
    updates['completed_at'] = b['completed_at']
    updates['status'] = 'done'
  } else if (b['completed_at'] === null) {
    updates['completed_at'] = null
    if (!explicitStatus) updates['status'] = 'open'
  } else if (explicitStatus === 'done') {
    updates['completed_at'] = new Date().toISOString()
    updates['status'] = 'done'
  } else if (explicitStatus) {
    updates['status'] = explicitStatus
    if (existing.completed_at) updates['completed_at'] = null
  }

  const { data: updated, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Handle BullMQ job updates
  const dueDateChanged = 'due_date' in updates
  if (isCompleting || (dueDateChanged && updates['due_date'] === null)) {
    // Cancel existing reminder
    if (existing.reminder_job_id) {
      void cancelTaskReminder(existing.reminder_job_id)
      await supabase.from('tasks').update({ reminder_job_id: null }).eq('id', id)
    }
  } else if (dueDateChanged && newDueDate) {
    // Cancel old, enqueue new
    if (existing.reminder_job_id) {
      void cancelTaskReminder(existing.reminder_job_id)
    }
    try {
      const jobId = await enqueueTaskReminder(
        {
          taskId: id!,
          tenantId: authed.tenantId,
          contactId: (updated?.contact_id as string) ?? undefined,
          title: (updated?.title as string) ?? existing.title,
          assignedUserId: (updated?.assigned_to_user_id as string) ?? undefined,
        },
        newDueDate
      )
      if (jobId) {
        await supabase.from('tasks').update({ reminder_job_id: jobId }).eq('id', id)
      }
    } catch (err) {
      console.error('[tasks] failed to re-enqueue reminder:', err)
    }
  }

  // Log completion activity
  if (isCompleting && existing.contact_id) {
    void logActivity({
      tenantId: authed.tenantId,
      contactId: existing.contact_id,
      type: 'task',
      body: `Task completed: "${existing.title}"`,
      metadata: { task_id: id },
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.json(updated)
})

// ── DELETE /api/tasks/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { id } = req.params

  const { data: existing } = await supabase
    .from('tasks')
    .select('reminder_job_id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Task not found' })
    return
  }

  if (existing.reminder_job_id) {
    void cancelTaskReminder(existing.reminder_job_id)
  }

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ deleted: true })
})

export default router
