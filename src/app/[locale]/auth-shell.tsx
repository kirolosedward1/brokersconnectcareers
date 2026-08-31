/** Centres a short auth form in the space the footer would have taken. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col justify-center py-12">{children}</main>
  );
}
