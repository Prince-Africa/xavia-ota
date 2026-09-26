import moment from 'moment';

export function formatUtcTimestamp(value: string | Date, format = 'MMM D, YYYY HH:mm'): string {
  return moment(value).utc().format(`${format} [UTC]`);
}
