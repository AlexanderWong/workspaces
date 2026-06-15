const API_PREFIX = '/api/v1';
const POLL_INTERVAL_MS = 750;

const submitForm = document.getElementById('submit-form');
const lookupForm = document.getElementById('lookup-form');
const submitButton = document.getElementById('submit-button');
const submitMessage = document.getElementById('submit-message');
const refreshButton = document.getElementById('refresh-button');
const jobIdInput = document.getElementById('job-id-input');
const jobEmpty = document.getElementById('job-empty');
const jobDetail = document.getElementById('job-detail');
const recentJobs = document.getElementById('recent-jobs');
const healthIndicator = document.getElementById('health-indicator');

let activeJobId = null;
let pollTimer = null;
const sessionJobs = [];

function formatTimestamp(value) {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleString();
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function setMessage(element, text, tone = '') {
  element.textContent = text;
  element.className = tone ? `form-hint ${tone}` : 'form-hint';
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function statusClass(status) {
  return `status-badge ${status}`;
}

function renderRecentJobs() {
  if (sessionJobs.length === 0) {
    recentJobs.innerHTML = '<li class="empty-state">No jobs submitted this session.</li>';
    return;
  }

  recentJobs.innerHTML = sessionJobs
    .map(
      (job) => `
        <li class="recent-item">
          <button type="button" data-job-id="${job.id}">
            <span class="mono">${job.id}</span>
          </button>
          <span class="${statusClass(job.status)}">${job.status}</span>
        </li>
      `,
    )
    .join('');
}

function updateRecentJob(job) {
  const existingIndex = sessionJobs.findIndex((entry) => entry.id === job.id);
  const summary = { id: job.id, status: job.status };

  if (existingIndex >= 0) {
    sessionJobs[existingIndex] = summary;
  } else {
    sessionJobs.unshift(summary);
  }

  renderRecentJobs();
}

function renderJob(job) {
  activeJobId = job.id;
  jobIdInput.value = job.id;
  jobEmpty.hidden = true;
  jobDetail.hidden = false;
  refreshButton.hidden = false;

  document.getElementById('detail-id').textContent = job.id;
  const statusBadge = document.getElementById('detail-status');
  statusBadge.textContent = job.status;
  statusBadge.className = statusClass(job.status);

  document.getElementById('detail-retries').textContent = `${job.retryCount} / ${job.maxRetries}`;
  document.getElementById('detail-created').textContent = formatTimestamp(job.createdAt);
  document.getElementById('detail-started').textContent = formatTimestamp(job.startedAt);
  document.getElementById('detail-completed').textContent = formatTimestamp(job.completedAt);
  document.getElementById('detail-payload').textContent = formatJson(job.payload);

  const resultBlock = document.getElementById('result-block');
  const errorBlock = document.getElementById('error-block');

  if (job.result) {
    resultBlock.hidden = false;
    document.getElementById('detail-result').textContent = formatJson(job.result);
  } else {
    resultBlock.hidden = true;
  }

  if (job.error) {
    errorBlock.hidden = false;
    document.getElementById('detail-error').textContent = job.error;
  } else {
    errorBlock.hidden = true;
  }

  updateRecentJob(job);
}

async function fetchJob(jobId) {
  const response = await fetch(`${API_PREFIX}/jobs/${jobId}`);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.error?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const body = await response.json();
  return body.data;
}

async function refreshActiveJob() {
  if (!activeJobId) {
    return;
  }

  try {
    const job = await fetchJob(activeJobId);
    renderJob(job);

    if (job.status === 'completed' || job.status === 'failed') {
      stopPolling();
    }
  } catch (error) {
    setMessage(submitMessage, error.message, 'error');
    stopPolling();
  }
}

function startPolling(jobId) {
  stopPolling();
  activeJobId = jobId;
  void refreshActiveJob();
  pollTimer = setInterval(() => {
    void refreshActiveJob();
  }, POLL_INTERVAL_MS);
}

async function checkHealth() {
  try {
    const response = await fetch('/health');
    if (!response.ok) {
      throw new Error('unhealthy');
    }

    healthIndicator.className = 'health ok';
    healthIndicator.lastElementChild.textContent = 'API healthy';
  } catch {
    healthIndicator.className = 'health error';
    healthIndicator.lastElementChild.textContent = 'API unreachable';
  }
}

submitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(submitMessage, '');
  submitButton.disabled = true;

  const formData = new FormData(submitForm);
  const payload = {
    sleepMs: Number(formData.get('sleepMs')),
  };

  const dataRaw = String(formData.get('data') ?? '').trim();
  if (dataRaw) {
    try {
      payload.data = JSON.parse(dataRaw);
    } catch {
      setMessage(submitMessage, 'Payload data must be valid JSON.', 'error');
      submitButton.disabled = false;
      return;
    }
  }

  if (formData.get('shouldFail') === 'on') {
    payload.shouldFail = true;
  }

  const transientFailureCount = formData.get('transientFailureCount');
  if (transientFailureCount !== null && transientFailureCount !== '') {
    payload.transientFailureCount = Number(transientFailureCount);
  }

  try {
    const response = await fetch(`${API_PREFIX}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = body.error?.message ?? `Submission failed with status ${response.status}`;
      throw new Error(message);
    }

    const job = body.data;
    renderJob(job);
    setMessage(submitMessage, `Job ${job.id} queued.`, 'success');
    startPolling(job.id);
  } catch (error) {
    setMessage(submitMessage, error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(submitMessage, '');

  const jobId = jobIdInput.value.trim();
  if (!jobId) {
    setMessage(submitMessage, 'Enter a job ID to look up.', 'error');
    return;
  }

  try {
    const job = await fetchJob(jobId);
    renderJob(job);

    if (job.status === 'queued' || job.status === 'running') {
      startPolling(job.id);
    } else {
      stopPolling();
    }
  } catch (error) {
    setMessage(submitMessage, error.message, 'error');
  }
});

refreshButton.addEventListener('click', () => {
  void refreshActiveJob();
});

recentJobs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-job-id]');
  if (!button) {
    return;
  }

  jobIdInput.value = button.dataset.jobId;
  lookupForm.requestSubmit();
});

void checkHealth();
setInterval(() => {
  void checkHealth();
}, 30_000);
