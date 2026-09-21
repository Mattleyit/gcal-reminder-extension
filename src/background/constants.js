// Valori condivisi tra service worker, options page, popup e reminder.
// Unica fonte di verita': non duplicare queste stringhe altrove.

export const ALARM_POLL = 'gcal-poll';
export const ALARM_SNOOZE_PREFIX = 'gcal-snooze:';

export const STORAGE_KEYS = {
  settings: 'settings',
  authState: 'authState',
  scheduled: 'scheduledEvents',
  activeReminder: 'activeReminder',
  reminderWindowId: 'reminderWindowId',
  snoozed: 'snoozedEvents'
};

export const DEFAULT_SETTINGS = {
  minutesBefore: 5,
  soundEnabled: true,
  volume: 0.7,
  calendarIds: ['primary']
};

export const MESSAGES = {
  getStatus: 'get-status',
  signIn: 'sign-in',
  signOut: 'sign-out',
  testReminder: 'test-reminder',
  dismissReminder: 'dismiss-reminder',
  snoozeReminder: 'snooze-reminder'
};

export const SNOOZE_MINUTES = 5;
