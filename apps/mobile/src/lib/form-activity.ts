/**
 * "The user is editing a form" signal. Every text field announces its edits here, and a mutation that is
 * showing an error (see useAction in lib/refresh.ts) subscribes to clear it. So the red error from a failed
 * submit disappears as soon as the user starts correcting the form, instead of staying until the next submit.
 */
const listeners = new Set<() => void>();

export const notifyEdit = () => {
  listeners.forEach((l) => l());
};

export const onEdit = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
