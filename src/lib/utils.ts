import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/*
  Everything else that lived here is pure and moved where the mobile app can
  import it without Tailwind's class merger; re-exported so no web import
  changed.
*/
export * from './format';
export { uuid } from './uuid';
export { whatsappLink } from './whatsapp';
