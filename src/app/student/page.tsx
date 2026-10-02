import StudentApp from '@/components/student/StudentApp';

/* The single-screen student app. The proxy has already checked the access
   cookie; every API call re-checks the session on the server. */
export default function StudentPage() {
  return <StudentApp />;
}
