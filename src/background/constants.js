// Valori condivisi tra service worker, options page e popup.
// Unica fonte di verita': non duplicare queste stringhe altrove.

export const ALARM_POLL = 'gcal-poll';

export const STORAGE_KEYS = {
  settings: 'settings',
  authState: 'authState',
  scheduled: 'scheduledEvents',
  activeReminder: 'activeReminder'
};

export const DEFAULT_SETTINGS = {
  minutesBefore: 5,
  soundEnabled: true,
  volume: 0.7,
  calendarIds: ['primary']
};

export const MESSAGES = {
  getStatus: 'get-status',
  testReminder: 'test-reminder',
  dismissReminder: 'dismiss-reminder',
  snoozeReminder: 'snooze-reminder'
};
