import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { sendPushNotification } from '../lib/push-client.js'
import { logActivity } from '../lib/activity.js'

const QUEUE_NAME = 'task-reminder'

let _queue: Queue | null = null

/** Lazily create and return the shared task-reminder queue. */
export function getTaskReminderQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: createBullMQConnection() })
  }
  return _queue
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export interface TaskReminderJob {
  taskId: string
  tenantId: string
  contactId?: string
  title: string
  assignedUserId?: string
}

async function processReminder(data: TaskReminderJob): Promise<void> {
  const { taskId, tenantId, contactId, title } = data
  const supabase = getSupabase()

  // Check if task still exists and is not completed
  const { data: task } = await supabase
    .from('tasks')
    .select('id, completed_at')
    .eq('id', taskId)
    .single()

  if (!task || task.completed_at) {
    console.info(`[task-reminder] skipped — task ${taskId} not found or already completed`)
    return
  }

  // Send push notification
  void sendPushNotification(tenantId, {
    title: `Task due: ${title}`,
    body: contactId ? `Contact task reminder` : 'Task reminder',
    url: '/tasks',
  })

  // Log activity if contact-linked
  if (contactId) {
    void logActivity({
      tenantId,
      contactId,
      type: 'system',
      body: `Task reminder sent: "${title}"`,
      metadata: { task_id: taskId },
      actorType: 'system',
    })
  }

  console.info(`[task-reminder] sent reminder for task=${taskId} title="${title}"`)
}

/** Enqueue a task reminder with delay. Returns job ID or null if already overdue. */
export async function enqueueTaskReminder(
  job: TaskReminderJob,
  dueDate: Date
): Promise<string | null> {
  const delay = dueDate.getTime() - Date.now()
  if (delay <= 0) return null // already overdue

  const queue = getTaskReminderQueue()
  const added = await queue.add('reminder', job, {
    delay,
    removeOnComplete: true,
    removeOnFail: true,
  })

  return added.id ?? null
}

/** Cancel a pending task reminder by job ID. */
export async function cancelTaskReminder(jobId: string): Promise<void> {
  try {
    const queue = getTaskReminderQueue()
    const job = await queue.getJob(jobId)
    if (job && !(await job.isCompleted())) {
      await job.remove()
    }
  } catch (err) {
    console.error(`[task-reminder] failed to cancel job ${jobId}:`, err)
  }
}

export function createTaskReminderWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  _queue = queue

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processReminder(job.data as TaskReminderJob)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[task-reminder] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
