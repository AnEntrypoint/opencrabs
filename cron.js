const activeJobs = new Map();

function parseCronInterval(schedule) {
  const s = schedule.trim().toLowerCase();
  const m = s.match(/^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$/);
  if (m) {
    const val = parseInt(m[1]);
    const unit = m[2].startsWith("h") ? 60 : 1;
    return val * unit * 60 * 1000;
  }
  const daily = s.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/);
  if (daily) {
    return { type: "daily", hour: parseInt(daily[1]), minute: parseInt(daily[2]) };
  }
  const mins = parseInt(s);
  if (!isNaN(mins) && mins > 0) return mins * 60 * 1000;
  return null;
}

function startJob(jobId, schedule, callback) {
  stopJob(jobId);
  const interval = parseCronInterval(schedule);
  if (!interval) return false;

  if (typeof interval === "number") {
    const timer = setInterval(callback, interval);
    activeJobs.set(jobId, { timer, type: "interval", schedule, nextRun: Date.now() + interval });
    return true;
  }

  if (interval.type === "daily") {
    const check = () => {
      const now = new Date();
      if (now.getHours() === interval.hour && now.getMinutes() === interval.minute) callback();
    };
    const timer = setInterval(check, 60000);
    activeJobs.set(jobId, { timer, type: "daily", schedule, nextRun: nextDailyRun(interval.hour, interval.minute) });
    return true;
  }
  return false;
}

function stopJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) { clearInterval(job.timer); activeJobs.delete(jobId); }
}

function getJobStatus(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return null;
  return { schedule: job.schedule, type: job.type, nextRun: job.nextRun, active: true };
}

function getAllJobs() {
  const result = [];
  activeJobs.forEach((job, id) => result.push({ id, ...job, timer: undefined }));
  return result;
}

function stopAll() { activeJobs.forEach((_, id) => stopJob(id)); }

function nextDailyRun(h, m) {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export { parseCronInterval, startJob, stopJob, getJobStatus, getAllJobs, stopAll };
