import { redirect } from 'next/navigation';

/* The bare domain opens the staff app, as the old /systemdemo/ did. */
export default function Home() {
  redirect('/staff');
}
