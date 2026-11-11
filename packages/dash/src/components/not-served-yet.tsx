/** A page whose root the mind does not serve yet (lib/served.ts): its title and one plain line. */
export function NotServedYet({ title, what }: { title: string; what: string }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="font-readme text-sm text-muted-foreground">
        This mind does not have {what} yet.
      </p>
    </div>
  );
}
