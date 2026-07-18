export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas-soft px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-on-primary text-[15px] font-semibold tracking-tight">
          M
        </div>
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.3px] leading-tight text-ink">Merna Control Center</p>
          <p className="text-[12px] text-mute leading-tight">Merna Medical Company</p>
        </div>
      </div>
      {children}
      <p className="mt-10 max-w-sm text-center text-[11px] leading-relaxed text-mute">
        Confidential management system of Merna Medical Company. Authorized personnel only.
        All activity is logged.
      </p>
    </main>
  );
}
