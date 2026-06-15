/**
 * Atomic Redis Lua scripts for queue claim and job state transitions.
 * KEYS/ARGV conventions are documented on each script constant.
 */

/** KEYS[1]=queue KEYS[2]=jobKeyPrefix (job:) KEYS[3]=inflight | ARGV[1]=visibilityDeadline */
export const CLAIM_JOB_SCRIPT = `
local jobId = redis.call('RPOP', KEYS[1])
if not jobId then
  return nil
end

local jobKey = KEYS[2] .. jobId
local raw = redis.call('GET', jobKey)
if not raw then
  return nil
end

local job = cjson.decode(raw)
if job.status ~= 'queued' then
  return nil
end

redis.call('ZADD', KEYS[3], ARGV[1], jobId)
return jobId
`;

/** KEYS[1]=jobKey KEYS[2]=inflight | ARGV[1]=now ARGV[2]=visibilityDeadline */
export const MARK_RUNNING_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return nil
end

local job = cjson.decode(raw)
if job.status ~= 'queued' then
  return nil
end

if redis.call('ZSCORE', KEYS[2], job.id) == false then
  return nil
end

job.status = 'running'
job.startedAt = ARGV[1]
job.updatedAt = ARGV[1]
redis.call('SET', KEYS[1], cjson.encode(job))
redis.call('ZADD', KEYS[2], ARGV[2], job.id)
return cjson.encode(job)
`;

/** KEYS[1]=jobKey KEYS[2]=inflight | ARGV[1]=resultJson ARGV[2]=now */
export const MARK_COMPLETED_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return nil
end

local job = cjson.decode(raw)
if job.status ~= 'running' then
  return nil
end

job.status = 'completed'
job.result = cjson.decode(ARGV[1])
job.error = cjson.null
job.completedAt = ARGV[2]
job.updatedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(job))
redis.call('ZREM', KEYS[2], job.id)
return cjson.encode(job)
`;

/** KEYS[1]=jobKey KEYS[2]=inflight KEYS[3]=dlq | ARGV[1]=error ARGV[2]=now */
export const MARK_FAILED_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return nil
end

local job = cjson.decode(raw)
if job.status ~= 'running' then
  return nil
end

job.status = 'failed'
job.error = ARGV[1]
job.completedAt = ARGV[2]
job.updatedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(job))
redis.call('ZREM', KEYS[2], job.id)
redis.call('LPUSH', KEYS[3], job.id)
return cjson.encode(job)
`;

/** KEYS[1]=jobKey KEYS[2]=inflight | ARGV[1]=error ARGV[2]=now */
export const REQUEUE_FOR_RETRY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return nil
end

local job = cjson.decode(raw)
if job.status ~= 'running' then
  return nil
end

local nextRetryCount = job.retryCount + 1
if nextRetryCount > job.maxRetries then
  return nil
end

job.status = 'queued'
job.error = ARGV[1]
job.retryCount = nextRetryCount
job.updatedAt = ARGV[2]
job.startedAt = cjson.null
redis.call('SET', KEYS[1], cjson.encode(job))
redis.call('ZREM', KEYS[2], job.id)
return cjson.encode(job)
`;

/** KEYS[1]=jobKey KEYS[2]=inflight KEYS[3]=queue | ARGV[1]=jobId ARGV[2]=now */
export const NACK_JOB_SCRIPT = `
local jobKey = KEYS[1]
local raw = redis.call('GET', jobKey)
if raw then
  local job = cjson.decode(raw)
  if job.status == 'running' then
    job.status = 'queued'
    job.startedAt = cjson.null
    job.updatedAt = ARGV[2]
    redis.call('SET', jobKey, cjson.encode(job))
    redis.call('LPUSH', KEYS[3], job.id)
  end
end

redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

/** KEYS[1]=inflight KEYS[2]=jobKeyPrefix KEYS[3]=queue | ARGV[1]=now ARGV[2]=timestamp */
export const REAP_EXPIRED_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local requeued = 0

for _, jobId in ipairs(expired) do
  local jobKey = KEYS[2] .. jobId
  local raw = redis.call('GET', jobKey)
  if raw then
    local job = cjson.decode(raw)
    if job.status == 'running' or job.status == 'queued' then
      job.status = 'queued'
      job.startedAt = cjson.null
      job.updatedAt = ARGV[2]
      redis.call('SET', jobKey, cjson.encode(job))
      redis.call('LPUSH', KEYS[3], jobId)
      requeued = requeued + 1
    end
  end
  redis.call('ZREM', KEYS[1], jobId)
end

return requeued
`;
