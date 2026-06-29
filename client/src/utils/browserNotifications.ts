import type { QueueJob } from "./jobGroups";

const TERMINAL_STATUSES = new Set(["Complete", "Failed"]);
const NOTIFIED_JOBS_STORAGE_KEY = "et-tool-notified-job-keys-v2";
const SUBMITTED_JOBS_STORAGE_KEY = "et-tool-submitted-job-keys";
const NOTIFICATION_ICON = "/favicon.svg";
const SERVICE_WORKER_PATH = "/notification-sw.js";

let permissionRequested = false;
let gestureListenerAttached = false;
let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
let serviceWorkerInitPromise: Promise<ServiceWorkerRegistration | null> | null = null;

function loadStoredKeys(storageKey: string): Set<string> {
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (!stored) {
      return new Set();
    }

    const parsed = JSON.parse(stored);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveStoredKeys(storageKey: string, keys: Set<string>) {
  sessionStorage.setItem(storageKey, JSON.stringify([...keys]));
}

const notifiedJobKeys = loadStoredKeys(NOTIFIED_JOBS_STORAGE_KEY);
const submittedJobKeys = loadStoredKeys(SUBMITTED_JOBS_STORAGE_KEY);

export function isBrowserNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

async function ensureNotificationPermission(fromUserGesture = false) {
  if (!isBrowserNotificationSupported()) {
    throw new Error("Browser notifications are not supported in this browser");
  }

  if (Notification.permission === "default") {
    const permission = await requestBrowserNotificationPermission(fromUserGesture);
    if (permission !== "granted") {
      throw new Error("Browser notification permission was not granted");
    }
    return;
  }

  if (Notification.permission !== "granted") {
    throw new Error("Browser notification permission is blocked for this site");
  }
}

export async function requestBrowserNotificationPermission(fromUserGesture = false) {
  if (!isBrowserNotificationSupported()) {
    return "denied" as NotificationPermission;
  }

  if (Notification.permission !== "default") {
    return Notification.permission;
  }

  if (permissionRequested && !fromUserGesture) {
    return Notification.permission;
  }

  permissionRequested = true;
  return Notification.requestPermission();
}

export async function initBrowserNotificationServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  if (serviceWorkerRegistration) {
    return serviceWorkerRegistration;
  }

  if (!serviceWorkerInitPromise) {
    serviceWorkerInitPromise = navigator.serviceWorker
      .register(SERVICE_WORKER_PATH, { scope: "/" })
      .then(async (registration) => {
        serviceWorkerRegistration = registration;
        await navigator.serviceWorker.ready;
        return registration;
      })
      .catch((error) => {
        console.warn("[notifications] Service worker registration failed", error);
        return null;
      });
  }

  return serviceWorkerInitPromise;
}

async function getServiceWorkerRegistration() {
  if (serviceWorkerRegistration) {
    return serviceWorkerRegistration;
  }

  if ("serviceWorker" in navigator) {
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return initBrowserNotificationServiceWorker();
    }
  }

  return null;
}

export function enableNotificationPermissionOnUserGesture() {
  if (!isBrowserNotificationSupported() || gestureListenerAttached || Notification.permission !== "default") {
    return;
  }

  gestureListenerAttached = true;

  const requestFromGesture = () => {
    void requestBrowserNotificationPermission(true);
  };

  document.addEventListener("pointerdown", requestFromGesture, { once: true });
  document.addEventListener("keydown", requestFromGesture, { once: true });
}

export function registerSubmittedJob(jobKey: string) {
  if (!jobKey) {
    return;
  }

  submittedJobKeys.add(jobKey);
  saveStoredKeys(SUBMITTED_JOBS_STORAGE_KEY, submittedJobKeys);
  void requestBrowserNotificationPermission(true);
}

function isUsersJob(job: QueueJob, currentUser: { sub?: string; email?: string }) {
  if (job.user?.sub && currentUser.sub) {
    return job.user.sub === currentUser.sub;
  }

  if (job.user?.email && currentUser.email) {
    return job.user.email.toLowerCase() === currentUser.email.toLowerCase();
  }

  return false;
}

function buildNotificationBody(job: QueueJob) {
  const years =
    job.start_year !== undefined && job.end_year !== undefined ? `${job.start_year}–${job.end_year}` : null;

  if (job.status === "Complete") {
    return years ? `Your ET report for ${years} is ready to view and download.` : "Your ET report is ready to view and download.";
  }

  if (job.status_msg) {
    return job.status_msg;
  }

  return years ? `Your ET report for ${years} finished with an error.` : "Your ET report finished with an error.";
}

type NotificationPayload = {
  title: string;
  body: string;
  tag: string;
};

export const JOB_COMPLETION_NOTIFICATION_EVENT = "et-tool-job-completion-notification";

function dispatchInAppJobNotification(title: string, body: string) {
  window.dispatchEvent(
    new CustomEvent(JOB_COMPLETION_NOTIFICATION_EVENT, {
      detail: { title, body },
    })
  );
}

async function displayNotification(payload: NotificationPayload) {
  await ensureNotificationPermission();

  const registration = await getServiceWorkerRegistration();
  if (registration) {
    await registration.showNotification(payload.title, {
      body: payload.body,
      icon: NOTIFICATION_ICON,
      tag: payload.tag,
      requireInteraction: true,
    });
    dispatchInAppJobNotification(payload.title, payload.body);
    return;
  }

  const notification = new Notification(payload.title, {
    body: payload.body,
    icon: NOTIFICATION_ICON,
    tag: payload.tag,
    requireInteraction: true,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  dispatchInAppJobNotification(payload.title, payload.body);
}

function showBrowserNotification(job: QueueJob) {
  if (!isBrowserNotificationSupported() || Notification.permission !== "granted") {
    return;
  }

  const title = job.status === "Complete" ? `Report ready: ${job.name}` : `Report failed: ${job.name}`;

  void displayNotification({
    title,
    body: buildNotificationBody(job),
    tag: `job-${job.key}`,
  }).catch((error) => {
    console.error("[notifications] Failed to show job notification", error);
  });
}

function shouldNotifyForTerminalJob(job: QueueJob, previousStatus: string | undefined) {
  if (!TERMINAL_STATUSES.has(job.status) || notifiedJobKeys.has(job.key)) {
    return false;
  }

  if (previousStatus !== undefined && previousStatus !== job.status) {
    return true;
  }

  return submittedJobKeys.has(job.key);
}

export function processJobNotificationCatchUp(
  jobs: QueueJob[],
  currentUser: { sub?: string; email?: string } | null | undefined
) {
  if (!currentUser?.sub && !currentUser?.email) {
    return;
  }

  for (const job of jobs) {
    if (!isUsersJob(job, currentUser)) {
      continue;
    }

    if (!shouldNotifyForTerminalJob(job, undefined)) {
      continue;
    }

    showBrowserNotification(job);
    notifiedJobKeys.add(job.key);
    saveStoredKeys(NOTIFIED_JOBS_STORAGE_KEY, notifiedJobKeys);
  }
}

export function processJobNotificationUpdates(
  previousJobs: QueueJob[],
  nextJobs: QueueJob[],
  currentUser: { sub?: string; email?: string } | null | undefined
) {
  if (!currentUser?.sub && !currentUser?.email) {
    return;
  }

  const previousStatusByKey = new Map(previousJobs.map((job) => [job.key, job.status]));

  for (const job of nextJobs) {
    if (!isUsersJob(job, currentUser)) {
      continue;
    }

    const previousStatus = previousStatusByKey.get(job.key);
    if (!shouldNotifyForTerminalJob(job, previousStatus)) {
      continue;
    }

    showBrowserNotification(job);
    notifiedJobKeys.add(job.key);
    saveStoredKeys(NOTIFIED_JOBS_STORAGE_KEY, notifiedJobKeys);
  }
}
